-- Shared hides and the source filter (specs: shared catalog, S3).
-- A hide becomes one household state per listing, recording the member and time of the latest hide. Existing per-member
-- hides merge, so each member's current hides now apply to the whole household. Any member can hide or unhide.
-- Saved criteria may select sources (sourceIds, absent means every source); a listing from a source outside the list
-- fails a hard rule. The snapshot emits the household's `hides` instead of the caller's `hiddenListingIds`, and
-- `sourceId` on catalog listings. The app ships first and parses both shapes.

-- One row per household and listing: the latest hide wins, ties broken by member id.
delete from hs.hidden_listings h using hs.hidden_listings newer
 where newer.household_id=h.household_id and coalesce(newer.listing_id,newer.manual_listing_id)=coalesce(h.listing_id,h.manual_listing_id)
  and (newer.hidden_at,newer.user_id)>(h.hidden_at,h.user_id);
drop index hs.hidden_listings_member_listing;
create unique index hidden_listings_household_listing on hs.hidden_listings(household_id,coalesce(listing_id,manual_listing_id));
drop policy own_read on hs.hidden_listings;
create policy active_household_read on hs.hidden_listings for select to authenticated using(hs.is_member(household_id));

-- Criteria may carry sourceIds: 1 to 20 source ids. The earlier checks apply to the rest.
alter function hs.valid_criteria(jsonb) rename to valid_criteria_base;
create function hs.valid_criteria(c jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,hs as $$ begin
 return coalesce(hs.valid_criteria_base(c-'sourceIds') and (not(c ? 'sourceIds') or (jsonb_typeof(c->'sourceIds')='array' and jsonb_array_length(c->'sourceIds') between 1 and 20
  and not exists(select 1 from jsonb_array_elements(c->'sourceIds') s where jsonb_typeof(s)<>'string' or s#>>'{}' !~ '^[a-z0-9-]{1,60}$'))),false);
exception when others then return false; end; $$;

-- The hard rules with the listing's source: a known source the criteria do not select fails. A manual listing has none.
create function hs.fails_hard_rule(f jsonb,x jsonb,c jsonb,s text) returns boolean language sql immutable set search_path=pg_catalog,hs as $$
 select (s is not null and c ? 'sourceIds' and not(c->'sourceIds' ? s)) or hs.fails_hard_rule(f,x,c);
$$;

create or replace function hs.snapshot_base(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare visible jsonb; edition jsonb; people jsonb; profiles jsonb; favorites jsonb;
begin
 perform hs.require_member(p_household_id);
 select jsonb_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition from hs.editions order by published_at desc,id desc limit 1;
 select coalesce(jsonb_agg(item order by observed_at desc,id),'[]'::jsonb) into visible from (
 select l.id,l.observed_at,jsonb_build_object(
 'id',l.id,'householdId',p_household_id,'origin','source','sourceId',l.source_id,'title',l.value->>'title',
 'sourceUrls',jsonb_build_array(l.value->>'sourceUrl'),
 'facts',v.facts,
 'conflicts',v.conflicts,
 'coordinates',case when (l.value->'coordinates'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) and (l.value->'coordinates'->>'observedAt')::timestamptz<=now()+interval '5 minutes' then l.value->'coordinates' else 'null'::jsonb end,
 'evidence',coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where p.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl')) and (e->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)),'[]'::jsonb),
 'photo',case when hs.policy_current(p.policy) and coalesce((p.policy->>'imageDisplay')::boolean,false) and coalesce((p.policy->>'imageHotlink')::boolean,false) and p.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') and (l.value->'photo'->>'expiresAt')::timestamptz>now() and (l.value->'photo'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.value->'photo' else 'null'::jsonb end,
 'previousAskingPriceSek',case when p.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') and l.previous_price_observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.previous_asking_price else null end,
 'observedAt',l.observed_at,'addedBy',null,'userTags','[]'::jsonb
 ) item from hs.listings l join hs.source_policies p on p.source_id=l.source_id,
 lateral (select hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb) facts,
  coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb) conflicts) v
 where hs.listing_interacted(p_household_id,l.id) or (hs.policy_current(p.policy) and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl') and l.observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)
  and (exists(select 1 from hs.hidden_listings h where h.household_id=p_household_id and h.listing_id=l.id)
   or exists(select 1 from hs.profiles pr where pr.household_id=p_household_id and pr.enabled and not hs.fails_hard_rule(v.facts,v.conflicts,pr.criteria,l.source_id))))
 union all
 select m.id,m.observed_at,jsonb_build_object(
 'id',m.id,'householdId',m.household_id,'origin','manual','title',m.value->>'title','sourceUrls',m.value->'sourceUrls',
 'facts',hs.empty_facts(),'conflicts','[]'::jsonb,'coordinates','null'::jsonb,'evidence','[]'::jsonb,'photo','null'::jsonb,
 'previousAskingPriceSek',null,'observedAt',m.observed_at,'addedBy',m.added_by,'userTags',m.value->'userTags'
 ) from hs.manual_listings m where m.household_id=p_household_id
 ) permitted;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',household_id,'userId',user_id,'displayName',display_name,'role',role) order by user_id),'[]'::jsonb) into people from hs.members where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'householdId',household_id,'revision',revision,'name',name,'enabled',enabled,'criteria',criteria,'editedBy',edited_by,'editedAt',edited_at) order by id),'[]'::jsonb) into profiles from hs.profiles where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',f.household_id,'listingId',coalesce(f.listing_id,f.manual_listing_id),'userId',f.user_id,'savedAt',saved_at) order by saved_at),'[]'::jsonb) into favorites from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id where f.household_id=p_household_id and exists(select 1 from jsonb_array_elements(visible) v where v->>'id'=coalesce(f.listing_id,f.manual_listing_id)::text);
 if jsonb_array_length(visible)>1500 or jsonb_array_length(people)>10 or jsonb_array_length(profiles)>20 or jsonb_array_length(favorites)>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return jsonb_build_object('contractVersion',1,'householdId',p_household_id,'edition',edition,'listings',visible,'members',people,'profiles',profiles,'favorites',favorites);
end; $$;

-- The household's hides, each with its latest member and time, limited to listings the snapshot shows and sorted so an
-- unchanged refresh compares equal. Left out when there are none.
create or replace function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; hides jsonb; shared jsonb;
begin
 base:=hs.with_viewings(hs.snapshot_base(p_household_id),p_household_id);
 select jsonb_agg(jsonb_build_object('listingId',coalesce(h.listing_id,h.manual_listing_id),'userId',h.user_id,'hiddenAt',h.hidden_at) order by coalesce(h.listing_id,h.manual_listing_id)) into hides from hs.hidden_listings h
  where h.household_id=p_household_id and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=coalesce(h.listing_id,h.manual_listing_id)::text);
 select jsonb_agg(jsonb_build_object('listingId',coalesce(n.listing_id,n.manual_listing_id),'userId',n.user_id,'body',n.body,'revision',n.revision,'editedAt',n.edited_at) order by coalesce(n.listing_id,n.manual_listing_id),n.user_id) into shared from hs.notes n
  where n.household_id=p_household_id and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=coalesce(n.listing_id,n.manual_listing_id)::text);
 return base||case when hides is null then '{}'::jsonb else jsonb_build_object('hides',hides) end||case when shared is null then '{}'::jsonb else jsonb_build_object('notes',shared) end;
end; $$;

-- Any member hides for the household, becoming its latest hider, or unhides for everyone. Every id must be a catalog
-- listing or one of the household's manual listings.
create or replace function public.hs_set_hidden(p_household_id uuid,p_listing_ids uuid[],p_hidden boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare ids uuid[];
begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_hidden is null or p_listing_ids is null or cardinality(p_listing_ids) not between 1 and 500 or array_position(p_listing_ids,null) is not null then raise exception 'Invalid hide request'; end if;
 select array_agg(distinct x) into ids from unnest(p_listing_ids) x;
 if (select count(*) from unnest(ids) x where exists(select 1 from hs.listings where id=x) or exists(select 1 from hs.manual_listings where id=x and household_id=p_household_id))<>cardinality(ids) then raise exception 'Listing unavailable'; end if;
 if p_hidden then
  insert into hs.hidden_listings(household_id,listing_id,manual_listing_id,user_id)
   select p_household_id,case when m.id is null then x end,m.id,auth.uid() from unnest(ids) x left join hs.manual_listings m on m.id=x and m.household_id=p_household_id
   on conflict(household_id,(coalesce(listing_id,manual_listing_id))) do update set user_id=excluded.user_id,hidden_at=now();
 else delete from hs.hidden_listings where household_id=p_household_id and coalesce(listing_id,manual_listing_id)=any(ids); end if;
 return jsonb_build_object('ok',true);
end; $$;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;

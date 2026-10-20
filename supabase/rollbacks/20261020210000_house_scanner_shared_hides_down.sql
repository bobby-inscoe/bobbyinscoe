-- Reverses 20261020210000_house_scanner_shared_hides.sql. Each merged hide stays with the member who hid it last; hides
-- the merge removed are not restored. Saved source selections are removed, because the earlier criteria check and an app
-- built before S3 reject the key. The definitions below are the ones 20261020180000_house_scanner_criteria_filter.sql
-- (snapshot_base) and 20261020150000_house_scanner_catalog.sql (hs_snapshot, hs_set_hidden) installed.
begin;
drop function hs.fails_hard_rule(jsonb,jsonb,jsonb,text);
update hs.profiles set criteria=criteria-'sourceIds' where criteria ? 'sourceIds';
drop function hs.valid_criteria(jsonb);
alter function hs.valid_criteria_base(jsonb) rename to valid_criteria;
drop policy active_household_read on hs.hidden_listings;
create policy own_read on hs.hidden_listings for select to authenticated using(hs.is_member(household_id) and user_id=auth.uid());
drop index hs.hidden_listings_household_listing;
create unique index hidden_listings_member_listing on hs.hidden_listings(household_id,user_id,coalesce(listing_id,manual_listing_id));
create or replace function hs.snapshot_base(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare visible jsonb; edition jsonb; people jsonb; profiles jsonb; favorites jsonb;
begin
 perform hs.require_member(p_household_id);
 select jsonb_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition from hs.editions order by published_at desc,id desc limit 1;
 select coalesce(jsonb_agg(item order by observed_at desc,id),'[]'::jsonb) into visible from (
 select l.id,l.observed_at,jsonb_build_object(
 'id',l.id,'householdId',p_household_id,'origin','source','title',l.value->>'title',
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
   or exists(select 1 from hs.profiles pr where pr.household_id=p_household_id and pr.enabled and not hs.fails_hard_rule(v.facts,v.conflicts,pr.criteria))))
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

create or replace function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; ids jsonb; shared jsonb;
begin
 base:=hs.with_viewings(hs.snapshot_base(p_household_id),p_household_id);
 select jsonb_agg(coalesce(h.listing_id,h.manual_listing_id) order by coalesce(h.listing_id,h.manual_listing_id)) into ids from hs.hidden_listings h
  where h.household_id=p_household_id and h.user_id=auth.uid() and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=coalesce(h.listing_id,h.manual_listing_id)::text);
 select jsonb_agg(jsonb_build_object('listingId',coalesce(n.listing_id,n.manual_listing_id),'userId',n.user_id,'body',n.body,'revision',n.revision,'editedAt',n.edited_at) order by coalesce(n.listing_id,n.manual_listing_id),n.user_id) into shared from hs.notes n
  where n.household_id=p_household_id and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=coalesce(n.listing_id,n.manual_listing_id)::text);
 return base||case when ids is null then '{}'::jsonb else jsonb_build_object('hiddenListingIds',ids) end||case when shared is null then '{}'::jsonb else jsonb_build_object('notes',shared) end;
end; $$;

-- Hides stay per member until S3. Every id must be a catalog listing or one of the household's manual listings.
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
   on conflict do nothing;
 else delete from hs.hidden_listings where household_id=p_household_id and user_id=auth.uid() and coalesce(listing_id,manual_listing_id)=any(ids); end if;
 return jsonb_build_object('ok',true);
end; $$;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
commit;

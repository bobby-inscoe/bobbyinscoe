-- The snapshot returns the catalog listings a household's saved criteria can use (specs: shared catalog, S2).
-- A live catalog listing is returned when at least one enabled profile does not exclude it on a hard rule, or when
-- a member of the household hid it, so the hidden view still works. Favorited and noted listings and manual
-- listings are returned as before. The rules are the client matcher's exclusions on known, undisputed facts:
-- not for purchase, rental, home type, living area, rooms, stretch budget, sold or withdrawn. Geography and the
-- apartment rules stay in the client matcher, so the database returns a superset of what it shows. Both sides are
-- tested against src/features/house-scanner/utils/hard-rule-cases.ts. The snapshot shape is unchanged.

-- True when a known, undisputed fact breaks a hard rule of the criteria. Facts are the policy-filtered facts the
-- snapshot shows, so a field the source may not show is unknown here as it is in the client.
create function hs.fails_hard_rule(f jsonb,x jsonb,c jsonb) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(
  (f->'purchase'='false'::jsonb and not(x ? 'purchase'))
  or (f->>'tenure'='rental' and not(x ? 'tenure'))
  or (jsonb_typeof(f->'propertyType')='string' and not(x ? 'propertyType') and not(c->'propertyTypes' ? (f->>'propertyType')))
  or (jsonb_typeof(f->'livingAreaM2')='number' and not(x ? 'livingAreaM2') and ((f->>'livingAreaM2')::numeric<(c->>'minAreaM2')::numeric
   or (jsonb_typeof(c->'maxAreaM2')='number' and (f->>'livingAreaM2')::numeric>(c->>'maxAreaM2')::numeric)))
  or (jsonb_typeof(f->'rooms')='number' and not(x ? 'rooms') and (f->>'rooms')::numeric<(c->>'minRooms')::numeric)
  or (jsonb_typeof(f->'askingPriceSek')='number' and not(x ? 'askingPriceSek') and (f->>'askingPriceSek')::numeric>(c->>'stretchPriceSek')::numeric)
  or (f->>'status' in ('sold','withdrawn') and not(x ? 'status')),false);
$$;

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

revoke all on all functions in schema hs from public,anon,authenticated,service_role;

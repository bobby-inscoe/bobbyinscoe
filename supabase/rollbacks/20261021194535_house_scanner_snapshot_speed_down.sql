-- Reverses 20261021194535_house_scanner_snapshot_speed.sql. The definitions below are the ones
-- 20261020121634_house_scanner_criteria_filter.sql and 20261020133201_house_scanner_shared_hides.sql (hard rules),
-- 20261021075417_house_scanner_manual_photo.sql (snapshot_base) and 20261020111540_house_scanner_catalog.sql
-- (with_viewings) installed. No data changes.
begin;
create or replace function hs.fails_hard_rule(f jsonb,x jsonb,c jsonb) returns boolean language sql immutable set search_path=pg_catalog as $$
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

create or replace function hs.fails_hard_rule(f jsonb,x jsonb,c jsonb,s text) returns boolean language sql immutable set search_path=pg_catalog,hs as $$
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
 )||case when l.delisted_at is null then '{}'::jsonb else jsonb_build_object('delistedAt',l.delisted_at) end item
 from hs.listings l join hs.source_policies p on p.source_id=l.source_id,
 lateral (select hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb) facts,
  coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb) conflicts) v
 where hs.listing_interacted(p_household_id,l.id) or (hs.policy_current(p.policy) and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl') and l.observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)
  and (exists(select 1 from hs.hidden_listings h where h.household_id=p_household_id and h.listing_id=l.id)
   or (l.delisted_at is null and exists(select 1 from hs.profiles pr where pr.household_id=p_household_id and pr.enabled and not hs.fails_hard_rule(v.facts,v.conflicts,pr.criteria,l.source_id)))))
 union all
 select m.id,m.observed_at,jsonb_build_object(
 'id',m.id,'householdId',m.household_id,'origin','manual','title',m.value->>'title','sourceUrls',m.value->'sourceUrls',
 'facts',hs.empty_facts()||coalesce(m.value->'facts','{}'::jsonb),'conflicts','[]'::jsonb,'coordinates','null'::jsonb,'evidence','[]'::jsonb,'photo',case when m.value ? 'imageUrls' then (select p from jsonb_array_elements(m.value->'imageUrls') with ordinality u(url,n),lateral (select jsonb_build_object('url',u.url#>>'{}','attribution','Added by a household member','rightsBasis','Linked by a household member, not stored.','expiresAt',m.observed_at+interval '1 year','observedAt',m.observed_at,'displayAllowed',true,'hotlinkAllowed',true) p) x order by n limit 1) else 'null'::jsonb end,
 'photos',case when m.value ? 'imageUrls' then (select jsonb_agg(jsonb_build_object('url',u.url#>>'{}','attribution','Added by a household member','rightsBasis','Linked by a household member, not stored.','expiresAt',m.observed_at+interval '1 year','observedAt',m.observed_at,'displayAllowed',true,'hotlinkAllowed',true) order by n) from jsonb_array_elements(m.value->'imageUrls') with ordinality u(url,n)) else '[]'::jsonb end,
 'previousAskingPriceSek',null,'observedAt',m.observed_at,'addedBy',m.added_by,'userTags',m.value->'userTags'
 ) from hs.manual_listings m where m.household_id=p_household_id
 ) permitted;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',household_id,'userId',user_id,'displayName',display_name,'role',role) order by user_id),'[]'::jsonb) into people from hs.members where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'householdId',household_id,'revision',revision,'name',name,'enabled',enabled,'criteria',criteria,'editedBy',edited_by,'editedAt',edited_at) order by id),'[]'::jsonb) into profiles from hs.profiles where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',f.household_id,'listingId',coalesce(f.listing_id,f.manual_listing_id),'userId',f.user_id,'savedAt',saved_at) order by saved_at),'[]'::jsonb) into favorites from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id where f.household_id=p_household_id and exists(select 1 from jsonb_array_elements(visible) v where v->>'id'=coalesce(f.listing_id,f.manual_listing_id)::text);
 if jsonb_array_length(visible)>1500 or jsonb_array_length(people)>10 or jsonb_array_length(profiles)>20 or jsonb_array_length(favorites)>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return jsonb_build_object('contractVersion',1,'householdId',p_household_id,'edition',edition,'listings',visible,'members',people,'profiles',profiles,'favorites',favorites);
end; $$;

create or replace function hs.with_viewings(base jsonb,p_household_id uuid) returns jsonb language sql stable set search_path=pg_catalog,hs as $$
 select jsonb_set(base,'{listings}',coalesce((
  select jsonb_agg(case when v.list is null then e.item else e.item||jsonb_build_object('viewings',v.list) end order by e.ord)
  from jsonb_array_elements(base->'listings') with ordinality e(item,ord)
  left join lateral (
   select jsonb_agg(x order by x->>'startsAt') list
   from hs.listings l
   join hs.source_policies p on p.source_id=l.source_id,
   jsonb_array_elements(case when jsonb_typeof(l.value->'viewings')='array' then l.value->'viewings' else '[]'::jsonb end) x
   where l.id=(e.item->>'id')::uuid and p.policy->'viewings'='true'::jsonb and hs.policy_current(p.policy)
    and (x->>'startsAt')::timestamptz>now()
  ) v on true),'[]'::jsonb));
$$;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
commit;

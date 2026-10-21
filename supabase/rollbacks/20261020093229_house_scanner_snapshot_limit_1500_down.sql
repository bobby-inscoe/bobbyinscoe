-- Reverses 20261020093229_house_scanner_snapshot_limit_1500.sql: the ceiling goes back to 1000 listings. Run it only
-- when fewer than 1000 listings are visible, or the snapshot raises again.
begin;
CREATE OR REPLACE FUNCTION hs.snapshot_base(p_household_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
declare visible jsonb; edition jsonb; people jsonb; profiles jsonb; favorites jsonb;
begin
 perform hs.require_member(p_household_id);
 select jsonb_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition from hs.editions where household_id=p_household_id order by published_at desc,id desc limit 1;
 select coalesce(jsonb_agg(item order by observed_at desc,id),'[]'::jsonb) into visible from (
 select l.id,l.observed_at,jsonb_build_object(
 'id',l.id,'householdId',l.household_id,'origin',l.origin,'title',l.value->>'title',
 'sourceUrls',case when l.origin='manual' then l.value->'sourceUrls' else jsonb_build_array(l.value->>'sourceUrl') end,
 'facts',case when l.origin='manual' then hs.empty_facts() else hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb) end,
 'conflicts',case when l.origin='manual' then '[]'::jsonb else coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb) end,
 'coordinates',case when l.origin='source' and (l.value->'coordinates'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) and (l.value->'coordinates'->>'observedAt')::timestamptz<=now()+interval '5 minutes' then l.value->'coordinates' else 'null'::jsonb end,
 'evidence',case when l.origin='manual' then '[]'::jsonb else coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where p.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl')) and (e->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)),'[]'::jsonb) end,
 'photo',case when l.origin='source' and hs.policy_current(p.policy) and coalesce((p.policy->>'imageDisplay')::boolean,false) and coalesce((p.policy->>'imageHotlink')::boolean,false) and p.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') and (l.value->'photo'->>'expiresAt')::timestamptz>now() and (l.value->'photo'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.value->'photo' else 'null'::jsonb end,
 'previousAskingPriceSek',case when p.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') and l.previous_price_observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.previous_asking_price else null end,
 'observedAt',l.observed_at,'addedBy',l.added_by,'userTags',case when l.origin='manual' then l.value->'userTags' else '[]'::jsonb end
 ) item from hs.listings l left join hs.source_policies p on p.household_id=l.household_id and p.source_id=l.source_id
 where l.household_id=p_household_id and (l.origin='manual' or hs.listing_interacted(l.household_id,l.id) or (hs.policy_current(p.policy) and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl') and l.observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)))
 ) permitted;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',household_id,'userId',user_id,'displayName',display_name,'role',role) order by user_id),'[]'::jsonb) into people from hs.members where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'householdId',household_id,'revision',revision,'name',name,'enabled',enabled,'criteria',criteria,'editedBy',edited_by,'editedAt',edited_at) order by id),'[]'::jsonb) into profiles from hs.profiles where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',f.household_id,'listingId',listing_id,'userId',f.user_id,'savedAt',saved_at) order by saved_at),'[]'::jsonb) into favorites from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id where f.household_id=p_household_id and exists(select 1 from jsonb_array_elements(visible) v where v->>'id'=f.listing_id::text);
 if jsonb_array_length(visible)>1000 or jsonb_array_length(people)>10 or jsonb_array_length(profiles)>20 or jsonb_array_length(favorites)>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return jsonb_build_object('contractVersion',1,'householdId',p_household_id,'edition',edition,'listings',visible,'members',people,'profiles',profiles,'favorites',favorites);
end; $function$;
commit;

-- Restores the old household read path as it stood before 20261022143306_house_scanner_drop_old_snapshot: each
-- function as its latest migration left it (snapshot_base and with_viewings from snapshot_speed, hs_snapshot from
-- shared_hides, hs_snapshot_neighborhoods from write_path, hs_notes from catalog), with the same grants.
create function hs.snapshot_base(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare visible jsonb; edition jsonb; people jsonb; profiles jsonb; favorites jsonb;
begin
 perform hs.require_member(p_household_id);
 select jsonb_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition from hs.editions order by published_at desc,id desc limit 1;
 -- Policies are stored out of line; ||'{}' reads each once, where the bare column is read again at every reference.
 with p as materialized (select source_id,policy||'{}'::jsonb policy,hs.policy_current(policy) live,now()-make_interval(days=>(policy->>'retentionDays')::int) cutoff from hs.source_policies),
 touched as materialized (select listing_id id from hs.favorites where household_id=p_household_id and listing_id is not null
  union select listing_id from hs.notes where household_id=p_household_id and listing_id is not null and body ~ '\S'),
 hidden as materialized (select listing_id id from hs.hidden_listings where household_id=p_household_id and listing_id is not null),
 rules as materialized (select criteria from hs.profiles where household_id=p_household_id and enabled),
 catalog as materialized (
  select l.id,l.source_id,l.value,l.observed_at,l.delisted_at,l.previous_asking_price,l.previous_price_observed_at,p.policy,p.live,p.cutoff,
   hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb) facts,
   coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb) conflicts
  from hs.listings l join p on p.source_id=l.source_id
  where l.id in (select id from touched) or (p.live and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl') and l.observed_at>=p.cutoff))
 select coalesce(jsonb_agg(item order by observed_at desc,id),'[]'::jsonb) into visible from (
 select l.id,l.observed_at,jsonb_build_object(
 'id',l.id,'householdId',p_household_id,'origin','source','sourceId',l.source_id,'title',l.value->>'title',
 'sourceUrls',jsonb_build_array(l.value->>'sourceUrl'),
 'facts',l.facts,
 'conflicts',l.conflicts,
 'coordinates',case when (l.value->'coordinates'->>'observedAt')::timestamptz>=l.cutoff and (l.value->'coordinates'->>'observedAt')::timestamptz<=now()+interval '5 minutes' then l.value->'coordinates' else 'null'::jsonb end,
 'evidence',coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where l.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or l.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl')) and (e->>'observedAt')::timestamptz>=l.cutoff),'[]'::jsonb),
 'photo',case when l.live and coalesce((l.policy->>'imageDisplay')::boolean,false) and coalesce((l.policy->>'imageHotlink')::boolean,false) and l.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') and (l.value->'photo'->>'expiresAt')::timestamptz>now() and (l.value->'photo'->>'observedAt')::timestamptz>=l.cutoff then l.value->'photo' else 'null'::jsonb end,
 'previousAskingPriceSek',case when l.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') and l.previous_price_observed_at>=l.cutoff then l.previous_asking_price else null end,
 'observedAt',l.observed_at,'addedBy',null,'userTags','[]'::jsonb
 )||case when l.delisted_at is null then '{}'::jsonb else jsonb_build_object('delistedAt',l.delisted_at) end item
 from catalog l
 where l.id in (select id from touched) or l.id in (select id from hidden)
  or (l.delisted_at is null and exists(select 1 from rules r where not hs.fails_hard_rule(l.facts,l.conflicts,r.criteria,l.source_id)))
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

create function hs.with_viewings(base jsonb,p_household_id uuid) returns jsonb language sql stable set search_path=pg_catalog,hs as $$
 select jsonb_set(base,'{listings}',coalesce((
  with shown as materialized (select source_id from hs.source_policies p where p.policy->'viewings'='true'::jsonb and hs.policy_current(p.policy))
  select jsonb_agg(case when v.list is null then e.item else e.item||jsonb_build_object('viewings',v.list) end order by e.ord)
  from jsonb_array_elements(base->'listings') with ordinality e(item,ord)
  left join lateral (
   select jsonb_agg(x order by x->>'startsAt') list
   from hs.listings l,
   jsonb_array_elements(case when jsonb_typeof(l.value->'viewings')='array' then l.value->'viewings' else '[]'::jsonb end) x
   where l.id=(e.item->>'id')::uuid and l.source_id in (select source_id from shown)
    and (x->>'startsAt')::timestamptz>now()
  ) v on true),'[]'::jsonb));
$$;

create function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; hides jsonb; shared jsonb;
begin
 base:=hs.with_viewings(hs.snapshot_base(p_household_id),p_household_id);
 select jsonb_agg(jsonb_build_object('listingId',coalesce(h.listing_id,h.manual_listing_id),'userId',h.user_id,'hiddenAt',h.hidden_at) order by coalesce(h.listing_id,h.manual_listing_id)) into hides from hs.hidden_listings h
  where h.household_id=p_household_id and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=coalesce(h.listing_id,h.manual_listing_id)::text);
 select jsonb_agg(jsonb_build_object('listingId',coalesce(n.listing_id,n.manual_listing_id),'userId',n.user_id,'body',n.body,'revision',n.revision,'editedAt',n.edited_at) order by coalesce(n.listing_id,n.manual_listing_id),n.user_id) into shared from hs.notes n
  where n.household_id=p_household_id and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=coalesce(n.listing_id,n.manual_listing_id)::text);
 return base||case when hides is null then '{}'::jsonb else jsonb_build_object('hides',hides) end||case when shared is null then '{}'::jsonb else jsonb_build_object('notes',shared) end;
end; $$;

create function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; homes jsonb;
begin
 base:=public.hs_snapshot(p_household_id);
 select coalesce(jsonb_agg(
  v.item || jsonb_build_object(
   'firstSeenAt',coalesce(l.first_seen_at,m.first_seen_at),'lastChangedAt',coalesce(l.last_changed_at,m.last_changed_at),
   'lastCheckedAt',coalesce(l.last_checked_at,m.last_checked_at),
   'isNew',coalesce(l.first_seen_run_id=sp.latest_run_id,false)) ||
  case when n.id is not null and jsonb_typeof(v.item->'coordinates')='object'
   then jsonb_build_object('neighborhood',jsonb_build_object('id',n.id,'name',n.name,'method','polygon','datasetVersion',n.dataset_version))
   else '{}'::jsonb end ||
  case when jsonb_typeof(v.item->'coordinates')='object' then jsonb_build_object(
   'neighborhoodCandidates',coalesce(candidates.areas,'[]'::jsonb)) ||
   case when l.neighborhood_radius_m is null then '{}'::jsonb
    else jsonb_build_object('neighborhoodRadiusM',l.neighborhood_radius_m) end
   else '{}'::jsonb end order by v.position
 ),'[]'::jsonb) into homes
 from jsonb_array_elements(base->'listings') with ordinality v(item,position)
 left join hs.listings l on l.id=(v.item->>'id')::uuid and v.item->>'origin'='source'
 left join hs.manual_listings m on m.id=(v.item->>'id')::uuid and m.household_id=p_household_id and v.item->>'origin'='manual'
 left join hs.neighborhoods n on n.id=l.neighborhood_id
 left join hs.source_policies sp on sp.source_id=l.source_id
 left join lateral (
  select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'method','polygon','datasetVersion',a.dataset_version) order by position) as areas
  from unnest(l.neighborhood_candidates) with ordinality ids(id,position)
  join hs.neighborhoods a on a.id=ids.id
 ) candidates on true;
 return jsonb_set(base,'{listings}',homes);
end;
$$;

create function public.hs_notes(p_household_id uuid,p_listing_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 return (select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'body',body,'revision',revision,'editedAt',edited_at) order by edited_at),'[]'::jsonb) from hs.notes where household_id=p_household_id and p_listing_id in (listing_id,manual_listing_id));
end; $$;

revoke all on function hs.snapshot_base(uuid),hs.with_viewings(jsonb,uuid),public.hs_snapshot(uuid),
 public.hs_snapshot_neighborhoods(uuid),public.hs_notes(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.hs_snapshot(uuid),public.hs_snapshot_neighborhoods(uuid),public.hs_notes(uuid,uuid) to authenticated;

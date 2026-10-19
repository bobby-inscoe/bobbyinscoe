-- Restore the previous UI endpoint and point assignment; preserve candidate caches and field documentation.
create or replace function hs.assign_neighborhood() returns trigger
language plpgsql set search_path=pg_catalog,hs as $$
begin
 new.neighborhood_id := hs.neighborhood_for_coordinates(new.value->'coordinates');
 return new;
end;
$$;
create or replace function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; homes jsonb;
begin
 base:=public.hs_snapshot(p_household_id);
 with latest_source_runs as (
  select distinct on (result->>'sourceId') result->>'sourceId' as source_id,r.id
  from hs.editions e join hs.runs r on r.id=e.run_id and r.household_id=e.household_id,
  lateral jsonb_array_elements(r.results) result
  where e.household_id=p_household_id and r.state='published' and result->>'status' in ('success','partial')
  order by result->>'sourceId',e.published_at desc,e.id desc
 )
 select coalesce(jsonb_agg(
  v.item || jsonb_build_object(
   'firstSeenAt',l.first_seen_at,'lastChangedAt',l.last_changed_at,'lastCheckedAt',l.last_checked_at,
   'isNew',coalesce(l.origin='source' and l.first_seen_run_id=latest.id,false)) ||
  case when n.id is not null and jsonb_typeof(v.item->'coordinates')='object'
   then jsonb_build_object('neighborhood',jsonb_build_object('id',n.id,'name',n.name,'method','polygon','datasetVersion',n.dataset_version))
   else '{}'::jsonb end order by v.position
 ),'[]'::jsonb) into homes
 from jsonb_array_elements(base->'listings') with ordinality v(item,position)
 join hs.listings l on l.id=(v.item->>'id')::uuid and l.household_id=p_household_id
 left join hs.neighborhoods n on n.id=l.neighborhood_id
 left join latest_source_runs latest on latest.source_id=l.source_id;
 return jsonb_set(base,'{listings}',homes);
end;
$$;

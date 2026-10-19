-- Retain discovery columns and their data. Older clients tolerate absent optional fields.
drop trigger if exists observation_discovery on hs.observations;
drop trigger if exists listing_times on hs.listings;
drop function if exists hs.record_discovery_run();
drop function if exists hs.track_listing_times();
create or replace function hs.neighborhood_for_coordinates(coordinates jsonb) returns text
language sql stable set search_path=pg_catalog,hs as $$
 select s.neighborhood_id
 from hs.neighborhood_shapes s
 where coordinates->>'precision' in ('address','building','user_supplied')
 and coalesce(coordinates->>'estimated','false') = 'false'
 and s.outline @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision)
 and not exists (
  select 1 from unnest(s.holes) as hole
  where hole @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision)
 )
 -- Shared boundaries use the lowest official code, independent of import order.
 order by s.neighborhood_id limit 1
$$;
create or replace function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; homes jsonb;
begin
 base := public.hs_snapshot(p_household_id);
 select coalesce(jsonb_agg(
  case when n.id is not null and jsonb_typeof(v.item->'coordinates')='object'
   then v.item || jsonb_build_object('neighborhood',jsonb_build_object(
    'id',n.id,'name',n.name,'method','polygon','datasetVersion',n.dataset_version))
   else v.item end order by v.position
 ),'[]'::jsonb) into homes
 from jsonb_array_elements(base->'listings') with ordinality v(item,position)
 left join hs.listings l on l.id=(v.item->>'id')::uuid and l.household_id=p_household_id
 left join hs.neighborhoods n on n.id=l.neighborhood_id;
 return jsonb_set(base,'{listings}',homes);
end;
$$;
update hs.listings set neighborhood_id=hs.neighborhood_for_coordinates(value->'coordinates')
 where value->'coordinates'->>'estimated'='true';

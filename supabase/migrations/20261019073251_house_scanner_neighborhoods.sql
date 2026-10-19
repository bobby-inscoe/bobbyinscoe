-- Official polygon assignments live outside source observations, so ingest contracts stay unchanged.
create table hs.neighborhoods (
 id text primary key,
 name text not null,
 dataset_version text not null
);
create table hs.neighborhood_shapes (
 neighborhood_id text not null references hs.neighborhoods(id),
 part integer not null,
 outline polygon not null,
 holes polygon[] not null default '{}',
 primary key(neighborhood_id,part)
);
alter table hs.neighborhoods enable row level security;
alter table hs.neighborhood_shapes enable row level security;
revoke all on hs.neighborhoods,hs.neighborhood_shapes from public,anon,authenticated,service_role;

alter table hs.listings add column neighborhood_id text references hs.neighborhoods(id);

create function hs.neighborhood_for_coordinates(coordinates jsonb) returns text
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

create function hs.assign_neighborhood() returns trigger
language plpgsql set search_path=pg_catalog,hs as $$
begin
 new.neighborhood_id := hs.neighborhood_for_coordinates(new.value->'coordinates');
 return new;
end;
$$;
create trigger listing_neighborhood before insert or update of value,neighborhood_id on hs.listings
 for each row execute function hs.assign_neighborhood();

-- The original endpoint keeps its exact shape for browsers with strict older schemas.
create function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
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
revoke all on function hs.neighborhood_for_coordinates(jsonb),hs.assign_neighborhood(),public.hs_snapshot_neighborhoods(uuid) from public,anon,authenticated,service_role;
grant execute on function public.hs_snapshot_neighborhoods(uuid) to authenticated;

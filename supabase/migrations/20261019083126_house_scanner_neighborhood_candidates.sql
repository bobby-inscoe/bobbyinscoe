-- Candidate areas preserve uncertainty instead of choosing an arbitrary side of a boundary.
-- A local planar conversion supports small browsing buffers around GÃ¶teborg, not surveyed accuracy.
create function hs.neighborhood_metres_point(lon double precision,lat double precision) returns point
language sql immutable set search_path=pg_catalog as $$
 select point((lon-12.0)*111320*cos(radians(57.7)),(lat-57.7)*111320)
$$;
create function hs.neighborhood_metres_ring(ring polygon) returns polygon
language sql immutable set search_path=pg_catalog,hs as $$
 select ('('||string_agg(hs.neighborhood_metres_point((v->>0)::double precision,(v->>1)::double precision)::text,',' order by position)||')')::polygon
 from jsonb_array_elements(translate(ring::text,'()','[]')::jsonb) with ordinality a(v,position)
$$;
alter table hs.neighborhood_shapes add column outline_metres polygon,add column holes_metres polygon[];
create function hs.prepare_neighborhood_metres() returns trigger
language plpgsql set search_path=pg_catalog,hs as $$
begin
 new.outline_metres:=hs.neighborhood_metres_ring(new.outline);
 select coalesce(array_agg(hs.neighborhood_metres_ring(hole)),'{}'::polygon[])
 into new.holes_metres from unnest(new.holes) hole;
 return new;
end;
$$;
create trigger neighborhood_metres before insert or update of outline,holes on hs.neighborhood_shapes
 for each row execute function hs.prepare_neighborhood_metres();
update hs.neighborhood_shapes set outline=outline;
alter table hs.neighborhood_shapes alter column outline_metres set not null,alter column holes_metres set not null;

create function hs.neighborhood_search_radius(coordinates jsonb) returns integer
language sql immutable set search_path=pg_catalog as $$
 select case
  when coordinates->>'estimated'='true' and coordinates->>'source'='Estimated from the street name (OpenStreetMap)' then 250
  when coordinates->>'precision' in ('address','building','user_supplied') then
   case when coalesce(coordinates->>'estimated','false')='false' then 0
    when coordinates->>'source'='Estimated from the address (OpenStreetMap)' then 50 end
 end
$$;
create function hs.neighborhood_candidate_ids(coordinates jsonb) returns text[]
language sql stable set search_path=pg_catalog,hs as $$
 with location as (
  select hs.neighborhood_search_radius(coordinates) as radius,
   point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision) as original,
   hs.neighborhood_metres_point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision) as projected
 )
 select coalesce(array_agg(distinct s.neighborhood_id order by s.neighborhood_id),'{}'::text[])
 from hs.neighborhood_shapes s cross join location l
 where (l.radius=0 and s.outline @> l.original
  and not exists(select 1 from unnest(s.holes) hole
   where hole @> l.original and (l.original <-> path(hole))>0))
 or (l.radius>0 and (l.projected <-> s.outline_metres)<=l.radius
  and not exists(select 1 from unnest(s.holes_metres) hole
   where hole @> l.projected and (l.projected <-> path(hole))>l.radius))
$$;
alter table hs.listings
 add column neighborhood_candidates text[] not null default '{}',
 add column neighborhood_radius_m integer check(neighborhood_radius_m in (0,50,250));
comment on column hs.listings.neighborhood_id is 'Legacy point-containing area; never use it to discard additional neighborhood_candidates.';
comment on column hs.listings.neighborhood_candidates is 'Official area IDs intersecting the point or browsing buffer; candidates may contain one, two or more IDs and do not assert membership.';
comment on column hs.listings.neighborhood_radius_m is 'Browsing buffer in approximate local metres: 0 source point, 50 address estimate, 250 street estimate. Not a measured geocoding error. Null means unsupported or missing position.';

create or replace function hs.assign_neighborhood() returns trigger
language plpgsql set search_path=pg_catalog,hs as $$
begin
 new.neighborhood_id:=hs.neighborhood_for_coordinates(new.value->'coordinates');
 new.neighborhood_candidates:=hs.neighborhood_candidate_ids(new.value->'coordinates');
 new.neighborhood_radius_m:=hs.neighborhood_search_radius(new.value->'coordinates');
 return new;
end;
$$;
update hs.listings set neighborhood_id=neighborhood_id;

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
   else '{}'::jsonb end ||
  case when jsonb_typeof(v.item->'coordinates')='object' then jsonb_build_object(
   'neighborhoodCandidates',coalesce(candidates.areas,'[]'::jsonb)) ||
   case when l.neighborhood_radius_m is null then '{}'::jsonb
    else jsonb_build_object('neighborhoodRadiusM',l.neighborhood_radius_m) end
   else '{}'::jsonb end order by v.position
 ),'[]'::jsonb) into homes
 from jsonb_array_elements(base->'listings') with ordinality v(item,position)
 join hs.listings l on l.id=(v.item->>'id')::uuid and l.household_id=p_household_id
 left join hs.neighborhoods n on n.id=l.neighborhood_id
 left join latest_source_runs latest on latest.source_id=l.source_id
 left join lateral (
  select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'method','polygon','datasetVersion',a.dataset_version) order by position) as areas
  from unnest(l.neighborhood_candidates) with ordinality ids(id,position)
  join hs.neighborhoods a on a.id=ids.id
 ) candidates on true;
 return jsonb_set(base,'{listings}',homes);
end;
$$;
revoke all on function hs.neighborhood_metres_point(double precision,double precision),hs.neighborhood_metres_ring(polygon),hs.prepare_neighborhood_metres(),hs.neighborhood_search_radius(jsonb),hs.neighborhood_candidate_ids(jsonb) from public,anon,authenticated,service_role;

comment on column hs.listings.first_seen_at is 'Server discovery time for this source listing episode; unchanged by refresh, null when complete historical discovery cannot be recovered.';
comment on column hs.listings.last_changed_at is 'Server time of the latest meaningful content revision; ordinary refreshes, viewing schedules and retention cleanup do not advance it.';
comment on column hs.listings.last_checked_at is 'Server time when a newer collector observation was accepted, even without a meaningful content change.';
comment on column hs.listings.observed_at is 'Collector observation time, used for ordering, staleness and source retention; not discovery or broker publication time.';
comment on column hs.listings.first_seen_run_id is 'Published source run that introduced this episode, compared with the latest successful/partial run of the same source for New.';
comment on column hs.listings.previous_asking_price is 'Immediately preceding comparable non-disputed asking price for this source episode; null after an unknown/disputed price or when history is unavailable.';
comment on column hs.listings.previous_price_observed_at is 'Earlier observation time governing retention of previous_asking_price, not the time the new price was discovered.';

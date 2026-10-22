-- Reverses 20261022102043_house_scanner_write_path.sql. public.hs_snapshot_neighborhoods comes from
-- 20261020111540_house_scanner_catalog.sql, hs.mark_delisted from 20261022065048_house_scanner_listing_history.sql and
-- both neighborhood lookups from 20261021201851_house_scanner_set_based_publish.sql. Pages already written with free
-- space keep it until the table is rewritten.
begin;
create or replace function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; homes jsonb;
begin
 base:=public.hs_snapshot(p_household_id);
 with latest_source_runs as (
  select distinct on (result->>'sourceId') result->>'sourceId' as source_id,r.id
  from hs.editions e join hs.runs r on r.id=e.run_id,
  lateral jsonb_array_elements(r.results) result
  where r.state='published' and result->>'status' in ('success','partial')
  order by result->>'sourceId',e.published_at desc,e.id desc
 )
 select coalesce(jsonb_agg(
  v.item || jsonb_build_object(
   'firstSeenAt',coalesce(l.first_seen_at,m.first_seen_at),'lastChangedAt',coalesce(l.last_changed_at,m.last_changed_at),
   'lastCheckedAt',coalesce(l.last_checked_at,m.last_checked_at),
   'isNew',coalesce(l.first_seen_run_id=latest.id,false)) ||
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
 left join latest_source_runs latest on latest.source_id=l.source_id
 left join lateral (
  select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'method','polygon','datasetVersion',a.dataset_version) order by position) as areas
  from unnest(l.neighborhood_candidates) with ordinality ids(id,position)
  join hs.neighborhoods a on a.id=ids.id
 ) candidates on true;
 return jsonb_set(base,'{listings}',homes);
end;
$$;

create or replace function hs.mark_delisted() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
declare result jsonb;
begin
 for result in select * from jsonb_array_elements(new.results) loop
  if result->>'status' not in ('success','partial') then continue; end if;
  with seen as (
   select x->>'sourceListingId' source_listing_id,x->>'episodeId' episode_id from jsonb_array_elements(case when jsonb_typeof(result->'seen')='array' then result->'seen' else '[]'::jsonb end) x
   union select o.source_listing_id,o.episode_id from hs.staged_observations o where o.run_id=new.id and o.source_id=result->>'sourceId'),
  cleared as (
   update hs.listings l set missed_full_reads=0,delisted_at=null
    from (select x.id,x.delisted_at from hs.listings x join seen on x.source_listing_id=seen.source_listing_id and x.episode_id=seen.episode_id
     where x.source_id=result->>'sourceId' and (x.missed_full_reads>0 or x.delisted_at is not null)) was
    where l.id=was.id
    returning l.id,was.delisted_at)
  insert into hs.listing_changes(listing_id,run_id,observed_at,field) select id,new.id,now(),'relisted' from cleared where delisted_at is not null;
  if result->'fullRead'='true'::jsonb and jsonb_typeof(result->'seen')='array' then
   with seen as (
    select x->>'sourceListingId' source_listing_id,x->>'episodeId' episode_id from jsonb_array_elements(result->'seen') x
    union select o.source_listing_id,o.episode_id from hs.staged_observations o where o.run_id=new.id and o.source_id=result->>'sourceId'),
   missed as (
    update hs.listings l set missed_full_reads=l.missed_full_reads+1,
     delisted_at=case when l.missed_full_reads+1>=2 then coalesce(l.delisted_at,now()) else l.delisted_at end
    where l.source_id=result->>'sourceId'
     and not exists(select 1 from seen where seen.source_listing_id=l.source_listing_id and seen.episode_id=l.episode_id)
    returning l.id,l.missed_full_reads)
   -- The second miss in a row is the one that marks a listing delisted.
   insert into hs.listing_changes(listing_id,run_id,observed_at,field) select id,new.id,now(),'delisted' from missed where missed_full_reads=2;
  end if;
 end loop;
 return new;
end; $$;

create or replace function hs.neighborhood_for_coordinates(coordinates jsonb) returns text
language sql stable set search_path=pg_catalog,hs as $$
 select s.neighborhood_id from hs.neighborhood_shapes s
 where coordinates->>'precision' in ('address','building','user_supplied')
 and (coalesce(coordinates->>'estimated','false')='false'
  or coordinates->>'source'='Estimated from the address (OpenStreetMap)')
 and s.outline_box @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision)
 and s.outline @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision)
 and not exists(select 1 from unnest(s.holes) as hole
  where hole @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision))
 order by s.neighborhood_id limit 1
$$;
create or replace function hs.neighborhood_candidate_ids(coordinates jsonb) returns text[]
language sql stable set search_path=pg_catalog,hs as $$
 with location as materialized (
  select hs.neighborhood_search_radius(coordinates) as radius,
   point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision) as original,
   hs.neighborhood_metres_point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision) as projected
 )
 select coalesce(array_agg(distinct s.neighborhood_id order by s.neighborhood_id),'{}'::text[])
 from hs.neighborhood_shapes s cross join location l
 where case when l.radius=0 then s.outline_box @> l.original when l.radius>0 then (l.projected <-> s.outline_metres_box)<=l.radius+1 else false end
 and ((l.radius=0 and s.outline @> l.original
  and not exists(select 1 from unnest(s.holes) hole
   where hole @> l.original and (l.original <-> path(hole))>0))
 or (l.radius>0 and (l.projected <-> s.outline_metres)<=l.radius
  and not exists(select 1 from unnest(s.holes_metres) hole
   where hole @> l.projected and (l.projected <-> path(hole))>l.radius)))
$$;

-- Rolling back the set-based publish or the listing history drops the box columns or the change table, and these
-- indexes with them.
drop index if exists hs.neighborhood_shapes_outline_box, hs.neighborhood_shapes_outline_metres_box, hs.members_user,
 hs.listing_changes_run;
drop trigger record_latest_run on hs.runs;
drop function hs.record_latest_run();
alter table hs.source_policies drop column latest_run_id;
alter table hs.listings reset (fillfactor);

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
commit;

-- Write-path fixes (spec: house-scanner-data-foundation, S1).
-- Three costs grew with history or catalog size instead of with the work at hand:
-- * "New" compared a home with its source's latest run, found by expanding the results of every published run on every
--   snapshot. Each source now records its latest run when a run publishes.
-- * A full read rewrote every listing of the source it missed, homes delisted long ago included, on every run. A
--   delisted home is now left alone until a run sees it again.
-- * A neighborhood lookup read all shapes, because a box-contains-point test cannot use an index. The bounding-box
--   pre-filter is now a box-to-box test on GiST indexes. It may pass a few more shapes than before; the exact polygon
--   tests after it decide, so the result is unchanged.
-- Member lookups by user and change rows by run get indexes, and listings leave room for in-page updates.

alter table hs.source_policies add column latest_run_id uuid references hs.runs(id);
-- The rule the snapshot used: the newest published edition whose result for the source succeeded or was partial.
update hs.source_policies p set latest_run_id=latest.id from (
 select distinct on (result->>'sourceId') result->>'sourceId' as source_id,r.id
 from hs.editions e join hs.runs r on r.id=e.run_id,
 lateral jsonb_array_elements(r.results) result
 where r.state='published' and result->>'status' in ('success','partial')
 order by result->>'sourceId',e.published_at desc,e.id desc) latest
where latest.source_id=p.source_id;
-- Publishing holds the catalog lock, so runs publish one at a time and the last one to publish is the newest edition.
create function hs.record_latest_run() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 update hs.source_policies p set latest_run_id=new.id
 from jsonb_array_elements(new.results) result
 where p.source_id=result->>'sourceId' and result->>'status' in ('success','partial');
 return new;
end; $$;
revoke all on function hs.record_latest_run() from public,anon,authenticated,service_role;
create trigger record_latest_run after update of state on hs.runs
 for each row when (old.state='staging' and new.state='published') execute function hs.record_latest_run();

create or replace function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
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
    where l.source_id=result->>'sourceId' and l.delisted_at is null
     and not exists(select 1 from seen where seen.source_listing_id=l.source_listing_id and seen.episode_id=l.episode_id)
    returning l.id,l.missed_full_reads)
   -- The second miss in a row is the one that marks a listing delisted.
   insert into hs.listing_changes(listing_id,run_id,observed_at,field) select id,new.id,now(),'delisted' from missed where missed_full_reads=2;
  end if;
 end loop;
 return new;
end; $$;

create index neighborhood_shapes_outline_box on hs.neighborhood_shapes using gist(outline_box);
create index neighborhood_shapes_outline_metres_box on hs.neighborhood_shapes using gist(outline_metres_box);
create or replace function hs.neighborhood_for_coordinates(coordinates jsonb) returns text
language sql stable set search_path=pg_catalog,hs as $$
 select s.neighborhood_id from hs.neighborhood_shapes s
 where coordinates->>'precision' in ('address','building','user_supplied')
 and (coalesce(coordinates->>'estimated','false')='false'
  or coordinates->>'source'='Estimated from the address (OpenStreetMap)')
 and s.outline_box @> box(point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision),
  point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision))
 and s.outline @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision)
 and not exists(select 1 from unnest(s.holes) as hole
  where hole @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision))
 order by s.neighborhood_id limit 1
$$;
-- One branch per kind of position, so each pre-filter is a plain index condition on its own box column. The metre
-- branch's square around the point holds the buffer circle plus the metre of rounding slack the old test allowed.
create or replace function hs.neighborhood_candidate_ids(coordinates jsonb) returns text[]
language sql stable set search_path=pg_catalog,hs as $$
 with location as materialized (
  select hs.neighborhood_search_radius(coordinates) as radius,
   point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision) as original,
   hs.neighborhood_metres_point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision) as projected
 )
 select coalesce(array_agg(distinct m.neighborhood_id order by m.neighborhood_id),'{}'::text[]) from (
  select s.neighborhood_id from hs.neighborhood_shapes s cross join location l
  where l.radius=0 and s.outline_box @> box(l.original,l.original) and s.outline @> l.original
   and not exists(select 1 from unnest(s.holes) hole
    where hole @> l.original and (l.original <-> path(hole))>0)
  union all
  select s.neighborhood_id from hs.neighborhood_shapes s cross join location l
  where l.radius>0
   and s.outline_metres_box && box(point(l.projected[0]-l.radius-1,l.projected[1]-l.radius-1),point(l.projected[0]+l.radius+1,l.projected[1]+l.radius+1))
   and (l.projected <-> s.outline_metres)<=l.radius
   and not exists(select 1 from unnest(s.holes_metres) hole
    where hole @> l.projected and (l.projected <-> path(hole))>l.radius)
 ) m
$$;

create index members_user on hs.members(user_id);
create index listing_changes_run on hs.listing_changes(run_id);
-- A refresh updates every listing it sees. Free space on the page lets that update stay in place (a HOT update) instead
-- of writing a new row version elsewhere and new index entries. Existing pages get it once the table is rewritten.
alter table hs.listings set (fillfactor=70);

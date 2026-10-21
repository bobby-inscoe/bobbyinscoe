-- Set-based publish (spec: house-scanner-set-based-publish, S1).
-- Publish applied a run's staged homes one at a time. Each home was compared with every earlier run's staged copy and
-- with its listing's history through unindexed scans, so publish got slower with every run; Bjurfors passed the 8 s
-- statement timeout on 19 and 21 October. Publish now applies a source's homes in a few statements and compares stored
-- content hashes. Staged rows live only until their run closes, so the comparison with earlier runs' staged copies is
-- gone. The same-time checks against the listing and its history stay.

-- md5 detects changes here; it is not a security boundary. Stored hashes do not follow a later change to
-- hs.observation_content: a migration that changes it must rewrite value in these three tables to recompute them.
alter table hs.listings add column content_hash text generated always as (md5(hs.observation_content(value)::text)) stored;
alter table hs.observations add column content_hash text generated always as (md5(hs.observation_content(value)::text)) stored;
alter table hs.staged_observations add column content_hash text generated always as (md5(hs.observation_content(value)::text)) stored;
create index observations_listing on hs.observations(listing_id);

-- Staged rows of closed runs only served the dropped cross-run check.
delete from hs.staged_observations o using hs.runs r where r.id=o.run_id and r.state<>'staging';

-- The neighborhood lookup takes about 5 ms a home. A refresh rewrites value on every run, so the lookup now runs on
-- insert, when neighborhood_id is written (the shape import forces a recompute that way), and when the position changes.
drop trigger listing_neighborhood on hs.listings;
create trigger listing_neighborhood before insert or update of neighborhood_id on hs.listings
 for each row execute function hs.assign_neighborhood();
create trigger listing_neighborhood_moved before update of value on hs.listings
 for each row when ((case when jsonb_typeof(old.value->'coordinates')='object' then (old.value->'coordinates')-'observedAt' else old.value->'coordinates' end)
  is distinct from (case when jsonb_typeof(new.value->'coordinates')='object' then (new.value->'coordinates')-'observedAt' else new.value->'coordinates' end))
 execute function hs.assign_neighborhood();

-- The candidate lookup took about 37 ms a home against 1,766 shapes, almost all of it in the location CTE: inlined
-- into the shape scan, it called the radius and projection functions (not inlinable, they carry a search path) three
-- times per shape. It is now materialized, so they run once per home. A shape's bounding box also holds its polygon,
-- so a point outside the box, or farther than the buffer from it, cannot match; the polygon tests run only on shapes
-- whose box passes. The extra metre keeps floating-point rounding from dropping a shape at the buffer's edge; the exact
-- test still decides. Both lookups gave identical results for all 1,036 stored positions on 21 October.
alter table hs.neighborhood_shapes add column outline_box box generated always as (box(outline)) stored,
 add column outline_metres_box box generated always as (box(outline_metres)) stored;
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

-- Homes a publish result saw on the search pages or staged. Replaces hs.seen_in, which expanded the seen list once per
-- listing of the source; seen_in stays because the delisting rollback drops it.
create function hs.seen_listings(p_run uuid,p_result jsonb) returns table(source_listing_id text,episode_id text) language sql stable as $$
 select x->>'sourceListingId',x->>'episodeId' from jsonb_array_elements(case when jsonb_typeof(p_result->'seen')='array' then p_result->'seen' else '[]'::jsonb end) x
 union select o.source_listing_id,o.episode_id from hs.staged_observations o where o.run_id=p_run and o.source_id=p_result->>'sourceId'
$$;

create or replace function hs.mark_delisted() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
declare result jsonb;
begin
 for result in select * from jsonb_array_elements(new.results) loop
  if result->>'status' not in ('success','partial') then continue; end if;
  update hs.listings l set missed_full_reads=0,delisted_at=null
   from hs.seen_listings(new.id,result) seen
   where l.source_id=result->>'sourceId' and l.source_listing_id=seen.source_listing_id and l.episode_id=seen.episode_id
    and (l.missed_full_reads>0 or l.delisted_at is not null);
  if result->'fullRead'='true'::jsonb and jsonb_typeof(result->'seen')='array' then
   update hs.listings l set missed_full_reads=l.missed_full_reads+1,
    delisted_at=case when l.missed_full_reads+1>=2 then coalesce(l.delisted_at,now()) else l.delisted_at end
   where l.source_id=result->>'sourceId'
    and not exists(select 1 from hs.seen_listings(new.id,result) seen where seen.source_listing_id=l.source_listing_id and seen.episode_id=l.episode_id);
  end if;
 end loop;
 return new;
end; $$;

create or replace function public.hs_ingest(p_key_id text,p_body_hash text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare c hs.ingest_credentials; r hs.runs; b hs.batches; s text; p jsonb; o jsonb; result jsonb; ids text[]; edition_id uuid; success_count integer; batch_count integer;
begin
 if p_body_hash is null or p_body_hash !~ '^[a-f0-9]{64}$' or (p_request->>'contractVersion')::int is distinct from 1 then raise exception 'Invalid ingest envelope'; end if;
 select * into c from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes) for share;
 if c.key_id is null then raise exception 'Credential invalid' using errcode='42501'; end if;
 perform hs.lock_catalog();
 if p_request->>'action'='begin' then
  select array_agg(value order by value) into ids from jsonb_array_elements_text(p_request->'sourceIds');
  if ids is null or cardinality(ids) not between 1 and 20 or not ids<@c.source_ids or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Invalid source set'; end if;
  foreach s in array ids loop
   select policy into p from hs.source_policies where source_id=s;
   if not hs.policy_current(p) then raise exception 'Source permission absent'; end if;
  end loop;
  -- A run that has not published a day after it began never will; its staged rows go and its listings stay as they were.
  with abandoned as (update hs.runs set state='failed' where state='staging' and created_at<now()-interval '24 hours' returning id)
  delete from hs.staged_observations st using abandoned a where st.run_id=a.id;
  select * into r from hs.runs where id=(p_request->>'runId')::uuid for update;
  if r.id is not null then
   if r.key_id<>c.key_id or r.begin_hash<>p_body_hash then raise exception 'Run ID reused with different content'; end if;
   return jsonb_build_object('runId',r.id,'state',r.state);
  end if;
  insert into hs.runs(id,key_id,source_ids,begin_hash) values((p_request->>'runId')::uuid,c.key_id,ids,p_body_hash) returning * into r;
  return jsonb_build_object('runId',r.id,'state',r.state);
 end if;
 select * into r from hs.runs where id=(p_request->>'runId')::uuid and key_id=c.key_id for update;
 if r.id is null or not r.source_ids<@c.source_ids then raise exception 'Run unavailable'; end if;
 if p_request->>'action'='stage' then
  select * into b from hs.batches where id=(p_request->>'batchId')::uuid;
  if b.id is not null then
   if b.run_id<>r.id or b.body_hash<>p_body_hash then raise exception 'Batch ID reused with different content'; end if;
   return jsonb_build_object('runId',r.id,'state',r.state);
  end if;
  if r.state<>'staging' then raise exception 'Run closed'; end if;
  select count(*) into batch_count from hs.batches where run_id=r.id;
  if batch_count>=100 or jsonb_array_length(p_request->'observations')>100 then raise exception 'Run/batch limit exceeded'; end if;
  s:=p_request->>'sourceId'; if not s=any(r.source_ids) then raise exception 'Source not in run'; end if;
  select policy into p from hs.source_policies where source_id=s;
  if not hs.policy_current(p) then raise exception 'Source permission absent'; end if;
  insert into hs.batches(id,run_id,source_id,body_hash) values((p_request->>'batchId')::uuid,r.id,s,p_body_hash);
  for o in select * from jsonb_array_elements(p_request->'observations') loop
   perform hs.assert_observation(p,o);
   if exists(select 1 from hs.staged_observations where run_id=r.id and source_id=s and source_listing_id=o->>'sourceListingId' and episode_id=o->>'episodeId' and observed_at=(o->>'observedAt')::timestamptz and value<>o) then raise exception 'Conflicting same-time observation'; end if;
   insert into hs.staged_observations(run_id,source_id,source_listing_id,episode_id,observed_at,value) values(r.id,s,o->>'sourceListingId',o->>'episodeId',(o->>'observedAt')::timestamptz,o) on conflict do nothing;
  end loop;
  return jsonb_build_object('runId',r.id,'state',r.state);
 end if;
 if p_request->>'action' is distinct from 'publish' then raise exception 'Unknown ingest action'; end if;
 if r.state<>'staging' then
  if r.publish_hash is distinct from p_body_hash then raise exception 'Publish ID reused with different content'; end if;
  select id into edition_id from hs.editions where run_id=r.id;
  return jsonb_build_object('runId',r.id,'state',r.state,'editionId',edition_id);
 end if;
 select array_agg(v->>'sourceId' order by v->>'sourceId') into ids from jsonb_array_elements(p_request->'results') v;
 if ids is distinct from r.source_ids then raise exception 'Results must match exact run source set'; end if;
 -- The statements below apply one observation per home. The collector stages each home once per run.
 if exists(select 1 from hs.staged_observations where run_id=r.id group by source_id,source_listing_id,episode_id having count(*)>1) then
  raise exception 'Listing staged more than once in run'; end if;
 success_count:=0;
 for result in select * from jsonb_array_elements(p_request->'results') loop
  s:=result->>'sourceId'; if result->>'status' not in ('success','partial','failed') then raise exception 'Invalid source status'; end if;
  if result->>'status'='failed' then continue; end if;
  -- One in-memory copy per source: the stored policy is out of line, and every policy-> read would fetch it again.
  select policy||'{}'::jsonb into p from hs.source_policies where source_id=s;
  if not hs.policy_current(p) then raise exception 'Source permission changed'; end if;
  if not exists(select 1 from hs.staged_observations where run_id=r.id and source_id=s) then raise exception 'Empty results lack coverage proof'; end if;
  success_count:=success_count+1;
  perform hs.assert_observation(p,st.value) from hs.staged_observations st where st.run_id=r.id and st.source_id=s;
  if exists(select 1 from hs.staged_observations st
   join hs.listings l on l.source_id=st.source_id and l.source_listing_id=st.source_listing_id and l.episode_id=st.episode_id
   join hs.observations h on h.listing_id=l.id
   where st.run_id=r.id and st.source_id=s and (h.value->>'observedAt')::timestamptz=st.observed_at and h.content_hash<>st.content_hash) then
   raise exception 'Conflicting historical same-time observation'; end if;
  if exists(select 1 from hs.staged_observations st
   join hs.listings l on l.source_id=st.source_id and l.source_listing_id=st.source_listing_id and l.episode_id=st.episode_id
   where st.run_id=r.id and st.source_id=s and st.observed_at=l.observed_at and l.content_hash<>st.content_hash) then
   raise exception 'Conflicting same-time observation across runs'; end if;
  -- New homes, each with its discovery observation.
  with added as (
   insert into hs.listings(source_id,source_listing_id,episode_id,value,observed_at)
   select st.source_id,st.source_listing_id,st.episode_id,st.value,st.observed_at from hs.staged_observations st
   where st.run_id=r.id and st.source_id=s
    and not exists(select 1 from hs.listings l where l.source_id=st.source_id and l.source_listing_id=st.source_listing_id and l.episode_id=st.episode_id)
   returning id,value)
  insert into hs.observations(listing_id,run_id,value) select id,r.id,value from added;
  -- Newer observations of known homes. A changed hash raises the revision and records history; an unchanged one only
  -- refreshes the stored observation and its times.
  with refreshed as (
   update hs.listings l set value=n.value,observed_at=n.observed_at,last_checked_at=now(),revision=l.revision+case when n.changed then 1 else 0 end,
    previous_price_observed_at=case when n.value->'facts'->>'askingPriceSek' is not null and l.value->'facts'->>'askingPriceSek' is not null and not(n.value->'conflicts' ? 'askingPriceSek') and not(l.value->'conflicts' ? 'askingPriceSek') and (n.value->'facts'->>'askingPriceSek')::bigint<>(l.value->'facts'->>'askingPriceSek')::bigint then l.observed_at when n.value->'facts'->>'askingPriceSek' is null or n.value->'conflicts' ? 'askingPriceSek' then null else l.previous_price_observed_at end,
    previous_asking_price=case when n.value->'facts'->>'askingPriceSek' is not null and l.value->'facts'->>'askingPriceSek' is not null and not(n.value->'conflicts' ? 'askingPriceSek') and not(l.value->'conflicts' ? 'askingPriceSek') and (n.value->'facts'->>'askingPriceSek')::bigint<>(l.value->'facts'->>'askingPriceSek')::bigint then (l.value->'facts'->>'askingPriceSek')::bigint when n.value->'facts'->>'askingPriceSek' is null or n.value->'conflicts' ? 'askingPriceSek' then null else l.previous_asking_price end
   from (select x.id,st.value,st.observed_at,st.content_hash<>x.content_hash changed from hs.staged_observations st
    join hs.listings x on x.source_id=st.source_id and x.source_listing_id=st.source_listing_id and x.episode_id=st.episode_id
    where st.run_id=r.id and st.source_id=s and st.observed_at>x.observed_at) n
   where l.id=n.id
   returning l.id,n.value,n.changed)
  insert into hs.observations(listing_id,run_id,value) select id,r.id,value from refreshed where changed;
  if result->>'status'='success' then update hs.source_policies set cursor=result->>'cursor' where source_id=s; end if;
 end loop;
 if success_count>0 then
  insert into hs.editions(run_id,coverage,source_summary) values(r.id,case when not exists(select 1 from jsonb_array_elements(p_request->'results') v join hs.source_policies sp on sp.source_id=v->>'sourceId' where v->>'status'<>'success' or coalesce(jsonb_array_length(sp.policy->'capabilities'->'coverageGaps'),1)>0 or sp.policy->'capabilities'->'resultCap'<>'null'::jsonb or not coalesce((sp.policy->'capabilities'->>'discovery')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'unknownPrice')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'upcoming')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'pagination')::boolean,false)) then 'complete' else 'partial' end,
   (select case when hs.text_length(summary)>900 then left(summary,440)||' [summary shortened; review run coverage details]' else summary end from (select string_agg((v->>'sourceId')||': '||(v->>'status')||' '||coalesce(v->>'coverageNote','')||case when sp.policy->'capabilities'->'resultCap'<>'null'::jsonb then ' [result cap applies]' else '' end||' gaps: '||coalesce((sp.policy->'capabilities'->'coverageGaps')::text,'unknown'),'; ' order by v->>'sourceId') summary from jsonb_array_elements(p_request->'results') v join hs.source_policies sp on sp.source_id=v->>'sourceId') summaries)) returning id into edition_id;
 end if;
 -- Delisting reads this run's staged rows when the state changes, so they are deleted after it.
 update hs.runs set state=case when success_count>0 then 'published' else 'failed' end,publish_hash=p_body_hash,results=p_request->'results' where id=r.id returning * into r;
 delete from hs.staged_observations where run_id=r.id;
 return jsonb_build_object('runId',r.id,'state',r.state,'editionId',edition_id);
end; $$;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;

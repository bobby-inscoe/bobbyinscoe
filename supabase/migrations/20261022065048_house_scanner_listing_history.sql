-- Listing history (spec: house-scanner-listing-history, S1).
-- Publish stored a full copy of a listing in hs.observations whenever any of its content changed, photo swaps and
-- description edits included, and nothing read those copies except publish's own checks. Publish now appends one row to
-- hs.listing_changes per tracked field that changed: asking price and listing status, plus delisted and relisted from
-- the delisting trigger. revision and last_changed_at rise only on a tracked change; other edits overwrite value.
-- Discovery is set when publish inserts a listing. hs.observations is no longer written and is dropped by a later step.

create table hs.listing_changes (
 id bigint generated always as identity primary key,
 listing_id uuid not null references hs.listings(id),
 run_id uuid not null references hs.runs(id),
 observed_at timestamptz not null,
 field text not null check(field in ('askingPriceSek','status','delisted','relisted')),
 old_value jsonb, new_value jsonb
);
create index listing_changes_listing on hs.listing_changes(listing_id,observed_at);
alter table hs.listing_changes enable row level security;
revoke all on hs.listing_changes from public,anon,authenticated,service_role;

-- Each tracked difference between a listing's consecutive history rows. Publish applies only newer observations, so
-- the order received is the order observed.
insert into hs.listing_changes(listing_id,run_id,observed_at,field,old_value,new_value)
select h.listing_id,h.run_id,h.observed_at,c.field,c.old_value,c.new_value from (
 select o.listing_id,o.run_id,(o.value->>'observedAt')::timestamptz observed_at,
  coalesce(o.value->'facts'->'askingPriceSek','null') price,coalesce(o.value->'facts'->'status','null') status,
  lag(coalesce(o.value->'facts'->'askingPriceSek','null')) over w old_price,lag(coalesce(o.value->'facts'->'status','null')) over w old_status
 from hs.observations o window w as (partition by o.listing_id order by o.received_at,o.id)) h
cross join lateral (values ('askingPriceSek',h.old_price,h.price),('status',h.old_status,h.status)) c(field,old_value,new_value)
where c.old_value is not null and c.old_value<>c.new_value
order by h.listing_id,h.observed_at,c.field;

-- A listing whose latest change was cosmetic dates back to its latest tracked change, or to its discovery. A history
-- row is the only one for its listing and run, so the change rows find the time it was received.
update hs.listings l set last_changed_at=coalesce((select max(o.received_at) from hs.listing_changes c
  join hs.observations o on o.listing_id=c.listing_id and o.run_id=c.run_id where c.listing_id=l.id),l.first_seen_at)
where exists(select 1 from hs.observations o where o.listing_id=l.id);

-- Publish sets discovery on insert, so the insert trigger keeps it.
drop trigger observation_discovery on hs.observations;
drop function hs.record_discovery_run();
create or replace function hs.track_listing_times() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 if tg_op='INSERT' then
  new.first_seen_at:=now();
  new.last_changed_at:=now();
 else
  new.first_seen_at:=old.first_seen_at;
  new.first_seen_run_id:=old.first_seen_run_id;
  new.last_changed_at:=case when new.revision>old.revision then now() else old.last_changed_at end;
 end if;
 return new;
end; $$;

-- Delisting and relisting are recorded with the run that decided them, at the time it was published.
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
   where st.run_id=r.id and st.source_id=s and st.observed_at=l.observed_at and l.content_hash<>st.content_hash) then
   raise exception 'Conflicting same-time observation across runs'; end if;
  -- New homes, discovered by this run.
  insert into hs.listings(source_id,source_listing_id,episode_id,value,observed_at,first_seen_run_id)
  select st.source_id,st.source_listing_id,st.episode_id,st.value,st.observed_at,r.id from hs.staged_observations st
  where st.run_id=r.id and st.source_id=s
   and not exists(select 1 from hs.listings l where l.source_id=st.source_id and l.source_listing_id=st.source_listing_id and l.episode_id=st.episode_id);
  -- Newer observations of known homes. A changed asking price or status raises the revision and records a change row;
  -- any other difference only overwrites the stored observation.
  with n as (
   select x.id,st.value,st.observed_at,
    coalesce(x.value->'facts'->'askingPriceSek','null') old_price,coalesce(st.value->'facts'->'askingPriceSek','null') new_price,
    coalesce(x.value->'facts'->'status','null') old_status,coalesce(st.value->'facts'->'status','null') new_status
   from hs.staged_observations st
   join hs.listings x on x.source_id=st.source_id and x.source_listing_id=st.source_listing_id and x.episode_id=st.episode_id
   where st.run_id=r.id and st.source_id=s and st.observed_at>x.observed_at),
  changes as (
   insert into hs.listing_changes(listing_id,run_id,observed_at,field,old_value,new_value)
   select n.id,r.id,n.observed_at,f.field,f.old_value,f.new_value from n
   cross join lateral (values ('askingPriceSek',n.old_price,n.new_price),('status',n.old_status,n.new_status)) f(field,old_value,new_value)
   where f.old_value<>f.new_value)
  update hs.listings l set value=n.value,observed_at=n.observed_at,last_checked_at=now(),
   revision=l.revision+case when n.old_price<>n.new_price or n.old_status<>n.new_status then 1 else 0 end,
   previous_price_observed_at=case when n.value->'facts'->>'askingPriceSek' is not null and l.value->'facts'->>'askingPriceSek' is not null and not(n.value->'conflicts' ? 'askingPriceSek') and not(l.value->'conflicts' ? 'askingPriceSek') and (n.value->'facts'->>'askingPriceSek')::bigint<>(l.value->'facts'->>'askingPriceSek')::bigint then l.observed_at when n.value->'facts'->>'askingPriceSek' is null or n.value->'conflicts' ? 'askingPriceSek' then null else l.previous_price_observed_at end,
   previous_asking_price=case when n.value->'facts'->>'askingPriceSek' is not null and l.value->'facts'->>'askingPriceSek' is not null and not(n.value->'conflicts' ? 'askingPriceSek') and not(l.value->'conflicts' ? 'askingPriceSek') and (n.value->'facts'->>'askingPriceSek')::bigint<>(l.value->'facts'->>'askingPriceSek')::bigint then (l.value->'facts'->>'askingPriceSek')::bigint when n.value->'facts'->>'askingPriceSek' is null or n.value->'conflicts' ? 'askingPriceSek' then null else l.previous_asking_price end
  from n where l.id=n.id;
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

comment on table hs.observations is 'Full listing copies written by publish until 22 October 2026; read-only, replaced by hs.listing_changes.';
comment on column hs.listings.last_changed_at is 'Server time of the latest asking price or status change, or of discovery.';

revoke all on all functions in schema hs from public,anon,authenticated,service_role;

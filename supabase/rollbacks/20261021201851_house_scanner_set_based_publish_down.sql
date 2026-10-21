-- Reverses 20261021201851_house_scanner_set_based_publish.sql. hs.mark_delisted is the definition
-- 20261020142553_house_scanner_delisted.sql installed, hs_ingest the one 20261020111540_house_scanner_catalog.sql
-- installed, and the neighborhood trigger the one 20261019073251_house_scanner_neighborhoods.sql created. Staged rows
-- the migration deleted, and those deleted by publish or by begin since, do not come back; the restored cross-run check
-- only compares with staged rows of runs published after this rollback.
begin;
drop trigger listing_neighborhood_moved on hs.listings;
drop trigger listing_neighborhood on hs.listings;
create trigger listing_neighborhood before insert or update of value,neighborhood_id on hs.listings
 for each row execute function hs.assign_neighborhood();

create or replace function hs.mark_delisted() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
declare result jsonb;
begin
 for result in select * from jsonb_array_elements(new.results) loop
  if result->>'status' not in ('success','partial') then continue; end if;
  update hs.listings l set missed_full_reads=0,delisted_at=null
   where l.source_id=result->>'sourceId' and (l.missed_full_reads>0 or l.delisted_at is not null) and hs.seen_in(new.id,result,l);
  if result->'fullRead'='true'::jsonb and jsonb_typeof(result->'seen')='array' then
   update hs.listings l set missed_full_reads=l.missed_full_reads+1,
    delisted_at=case when l.missed_full_reads+1>=2 then coalesce(l.delisted_at,now()) else l.delisted_at end
   where l.source_id=result->>'sourceId' and not hs.seen_in(new.id,result,l);
  end if;
 end loop;
 return new;
end; $$;
drop function hs.seen_listings(uuid,jsonb);

create or replace function public.hs_ingest(p_key_id text,p_body_hash text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare c hs.ingest_credentials; r hs.runs; b hs.batches; s text; p jsonb; o jsonb; result jsonb; ids text[]; existing hs.listings; lid uuid; edition_id uuid; obs record; meaningful boolean; success_count integer; batch_count integer;
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
 success_count:=0;
 for result in select * from jsonb_array_elements(p_request->'results') loop
  s:=result->>'sourceId'; if result->>'status' not in ('success','partial','failed') then raise exception 'Invalid source status'; end if;
  if result->>'status'='failed' then continue; end if;
  select policy into p from hs.source_policies where source_id=s;
  if not hs.policy_current(p) then raise exception 'Source permission changed'; end if;
  if not exists(select 1 from hs.staged_observations where run_id=r.id and source_id=s) then raise exception 'Empty results lack coverage proof'; end if;
  success_count:=success_count+1;
  for obs in select * from hs.staged_observations where run_id=r.id and source_id=s order by observed_at,source_listing_id,episode_id loop
   o:=obs.value; perform hs.assert_observation(p,o);
   select * into existing from hs.listings where source_id=s and source_listing_id=obs.source_listing_id and episode_id=obs.episode_id for update;
   if existing.id is null then
    insert into hs.listings(source_id,source_listing_id,episode_id,value,observed_at) values(s,obs.source_listing_id,obs.episode_id,o,obs.observed_at) returning id into lid;
   else
    lid:=existing.id;
    if exists(select 1 from hs.observations h where h.listing_id=lid and (h.value->>'observedAt')::timestamptz=obs.observed_at and hs.observation_content(h.value) is distinct from hs.observation_content(o)) then raise exception 'Conflicting historical same-time observation'; end if;
    -- Published staging rows also retain unchanged-time fingerprints without creating listing revisions.
    if exists(select 1 from hs.staged_observations prior join hs.runs published on published.id=prior.run_id
     where published.state='published' and prior.source_id=s and prior.source_listing_id=obs.source_listing_id and prior.episode_id=obs.episode_id and prior.observed_at=obs.observed_at
     and exists(select 1 from jsonb_array_elements(published.results) status where status->>'sourceId'=s and status->>'status' in ('success','partial'))
     and hs.observation_content(prior.value) is distinct from hs.observation_content(o)) then raise exception 'Conflicting published observation fingerprint'; end if;
    if obs.observed_at=existing.observed_at and hs.observation_content(existing.value) is distinct from hs.observation_content(o) then raise exception 'Conflicting same-time observation across runs'; end if;
    if obs.observed_at<=existing.observed_at then continue; end if;
    meaningful:=hs.observation_content(existing.value) is distinct from hs.observation_content(o);
    update hs.listings set value=o,observed_at=obs.observed_at,last_checked_at=now(),revision=revision+case when meaningful then 1 else 0 end,
     previous_price_observed_at=case when o->'facts'->>'askingPriceSek' is not null and existing.value->'facts'->>'askingPriceSek' is not null and not(o->'conflicts' ? 'askingPriceSek') and not(existing.value->'conflicts' ? 'askingPriceSek') and (o->'facts'->>'askingPriceSek')::bigint<>(existing.value->'facts'->>'askingPriceSek')::bigint then existing.observed_at when o->'facts'->>'askingPriceSek' is null or o->'conflicts' ? 'askingPriceSek' then null else previous_price_observed_at end,
     previous_asking_price=case when o->'facts'->>'askingPriceSek' is not null and existing.value->'facts'->>'askingPriceSek' is not null and not(o->'conflicts' ? 'askingPriceSek') and not(existing.value->'conflicts' ? 'askingPriceSek') and (o->'facts'->>'askingPriceSek')::bigint<>(existing.value->'facts'->>'askingPriceSek')::bigint then (existing.value->'facts'->>'askingPriceSek')::bigint when o->'facts'->>'askingPriceSek' is null or o->'conflicts' ? 'askingPriceSek' then null else previous_asking_price end where id=lid;
    if not meaningful then continue; end if;
   end if;
   insert into hs.observations(listing_id,run_id,value) values(lid,r.id,o);
  end loop;
  if result->>'status'='success' then update hs.source_policies set cursor=result->>'cursor' where source_id=s; end if;
 end loop;
 if success_count>0 then
  insert into hs.editions(run_id,coverage,source_summary) values(r.id,case when not exists(select 1 from jsonb_array_elements(p_request->'results') v join hs.source_policies sp on sp.source_id=v->>'sourceId' where v->>'status'<>'success' or coalesce(jsonb_array_length(sp.policy->'capabilities'->'coverageGaps'),1)>0 or sp.policy->'capabilities'->'resultCap'<>'null'::jsonb or not coalesce((sp.policy->'capabilities'->>'discovery')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'unknownPrice')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'upcoming')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'pagination')::boolean,false)) then 'complete' else 'partial' end,
   (select case when hs.text_length(summary)>900 then left(summary,440)||' [summary shortened; review run coverage details]' else summary end from (select string_agg((v->>'sourceId')||': '||(v->>'status')||' '||coalesce(v->>'coverageNote','')||case when sp.policy->'capabilities'->'resultCap'<>'null'::jsonb then ' [result cap applies]' else '' end||' gaps: '||coalesce((sp.policy->'capabilities'->'coverageGaps')::text,'unknown'),'; ' order by v->>'sourceId') summary from jsonb_array_elements(p_request->'results') v join hs.source_policies sp on sp.source_id=v->>'sourceId') summaries)) returning id into edition_id;
 end if;
 update hs.runs set state=case when success_count>0 then 'published' else 'failed' end,publish_hash=p_body_hash,results=p_request->'results' where id=r.id returning * into r;
 return jsonb_build_object('runId',r.id,'state',r.state,'editionId',edition_id);
end; $$;

drop index hs.observations_listing;
alter table hs.listings drop column content_hash;
alter table hs.observations drop column content_hash;
alter table hs.staged_observations drop column content_hash;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
commit;

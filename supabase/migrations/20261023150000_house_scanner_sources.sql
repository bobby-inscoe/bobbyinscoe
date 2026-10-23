-- Source policies become plain source settings (spec: house-scanner-source-policy-removal). A source keeps an
-- enabled switch and its listing and image origins; review dates, approval status, per-field allowances, rights text
-- and capabilities go. Retention is one constant, 14 days, the value every source had. Nothing members see changes:
-- every source starts enabled with its policy's origins, and no stored listing had a value the old filters removed.
-- The old policies are kept in hs.source_policies_archive for the rollback.

create table hs.source_policies_archive(source_id text primary key, policy jsonb not null);
insert into hs.source_policies_archive(source_id,policy) select source_id,policy from hs.source_policies;
alter table hs.source_policies_archive enable row level security;
revoke all on hs.source_policies_archive from public,anon,authenticated,service_role;

-- How long a home stays in browsing after it was last seen, and how old a photo, position or evidence item may be.
create function hs.retention() returns interval language sql immutable set search_path=pg_catalog as $$ select interval '14 days' $$;

-- An origin is scheme, lowercase host and a port that is neither the scheme default nor above 65535, as new URL().origin
-- prints it. The WHATWG parser fails outright for a host whose last label is numeric or 0x hex unless the host is an IPv4
-- address, and for an invalid punycode label, so such a host must be a strict dotted quad and no xn-- label is accepted.
create function hs.valid_origins(o text[], min_count integer) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(cardinality(o) between min_count and 20 and (cardinality(o)=0 or array_ndims(o)=1) and
  not exists(select 1 from (select x,substring(x from '^https?://([^:]+)') h from unnest(o) x) origins
   where x is null or x !~ '^https?://[a-z0-9.-]+(:(0|[1-9][0-9]{0,4}))?$' or
    coalesce(substring(x from ':([0-9]+)$')::integer,0)>65535 or x ~ '^https://.*:443$' or x ~ '^http://.*:80$' or
    h ~ '(^|\.)xn--' or
    (regexp_replace(h,'\.$','') ~ '(^|\.)([0-9]+|0x[0-9a-f]*)$' and h !~ '^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$')),false);
$$;

alter table hs.admin_log drop constraint admin_log_action_check, add constraint admin_log_action_check
 check(action in ('bootstrap_household','set_member','set_source_policy','set_source','issue_credential','revoke_credential'));

drop trigger policy_cards on hs.source_policies;
alter table hs.source_policies rename to sources;
alter table hs.sources add column enabled boolean not null default true, add column listing_origins text[], add column image_origins text[];
update hs.sources set listing_origins=array(select jsonb_array_elements_text(policy->'listingOrigins')),
 image_origins=array(select jsonb_array_elements_text(coalesce(policy->'imageOrigins','[]'::jsonb)));
alter table hs.sources alter column listing_origins set not null, alter column image_origins set not null,
 add constraint sources_listing_origins check(hs.valid_origins(listing_origins,1)),
 add constraint sources_image_origins check(hs.valid_origins(image_origins,0));

-- Refuses an observation from a disabled source, from another host, or with a time or image outside the rules.
create function hs.assert_observation_facts(p hs.sources, o jsonb) returns void language plpgsql set search_path=pg_catalog,hs as $$
declare evidence_item jsonb; at_time timestamptz; begin
 if not coalesce(p.enabled,false) or not(hs.origin(o->>'sourceUrl')=any(p.listing_origins)) or (o->>'observedAt')::timestamptz>now()+interval '5 minutes' or
 (o->>'observedAt')::timestamptz<now()-hs.retention() or o->'coordinates'->>'precision'='user_supplied' then raise exception 'Source disabled or observation time invalid'; end if;
 for at_time in
  select (o->'coordinates'->>'observedAt')::timestamptz where o->'coordinates'<>'null'::jsonb
  union all select (e->>'observedAt')::timestamptz from jsonb_array_elements(o->'evidence') e
  union all select (o->'photo'->>'observedAt')::timestamptz where o->'photo'<>'null'::jsonb
 loop
  if at_time is null or at_time>now()+interval '5 minutes' or at_time<now()-hs.retention() then raise exception 'Evidence, coordinate or photo outside retention'; end if;
 end loop;
 if o->'photo'<>'null'::jsonb and (not(hs.origin(o->'photo'->>'url')=any(p.image_origins)) or (o->'photo'->>'expiresAt')::timestamptz<=now()) then raise exception 'Photo not permitted'; end if;
 for evidence_item in select * from jsonb_array_elements(o->'evidence') loop
  if evidence_item->>'kind' not in ('source_claim','measurement') or (evidence_item->>'sourceUrl' is not null and not(hs.origin(evidence_item->>'sourceUrl')=any(p.listing_origins))) then raise exception 'Evidence not permitted'; end if;
 end loop;
end; $$;

create function hs.assert_observation(p hs.sources, o jsonb) returns void language plpgsql set search_path=pg_catalog,hs as $$
declare img jsonb; begin
 perform hs.assert_observation_facts(p,o);
 if o ? 'morePhotos' and (jsonb_typeof(o->'morePhotos') is distinct from 'array' or jsonb_array_length(o->'morePhotos') not between 1 and 3
  or jsonb_typeof(o->'photo') is distinct from 'object') then raise exception 'Photo not permitted'; end if;
 for img in select x from jsonb_array_elements(coalesce(o->'morePhotos','[]'::jsonb)) x union all select o->'floorPlan' where o ? 'floorPlan' loop
  if jsonb_typeof(img) is distinct from 'object' or not coalesce(hs.origin(img->>'url')=any(p.image_origins) and (img->>'expiresAt')::timestamptz>now()
   and (img->>'observedAt')::timestamptz between now()-hs.retention() and now()+interval '5 minutes',false) then
   raise exception 'Photo not permitted'; end if;
 end loop;
end; $$;

CREATE OR REPLACE FUNCTION hs.card_rows(p_ids uuid[])
 RETURNS TABLE(listing_id uuid, source_id text, title text, source_url text, facts jsonb, conflicts jsonb, coordinates jsonb, evidence jsonb, photo jsonb, viewings jsonb, previous_asking_price bigint, previous_price_observed_at timestamp with time zone, observed_at timestamp with time zone, first_seen_at timestamp with time zone, last_changed_at timestamp with time zone, last_checked_at timestamp with time zone, first_seen_run_id uuid, delisted_at timestamp with time zone, neighborhood_id text, neighborhood_candidates text[], neighborhood_radius_m integer, listed boolean, retention interval, gallery jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
 with p as materialized (select source_id,listing_origins,image_origins from hs.sources)
 select l.id,l.source_id,l.value->>'title',l.value->>'sourceUrl',
  hs.empty_facts() || case when jsonb_typeof(l.value->'facts')='object' then l.value->'facts' else '{}'::jsonb end,
  coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c),'[]'::jsonb),
  nullif(l.value->'coordinates','null'::jsonb),
  coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or hs.origin(e->>'sourceUrl')=any(p.listing_origins))),'[]'::jsonb),
  case when hs.origin(l.value->'photo'->>'url')=any(p.image_origins) then l.value->'photo' end,
  coalesce((select jsonb_agg(x order by x->>'startsAt') from jsonb_array_elements(case when jsonb_typeof(l.value->'viewings')='array' then l.value->'viewings' else '[]'::jsonb end) x),'[]'::jsonb),
  case when not(l.value->'conflicts' ? 'askingPriceSek') then l.previous_asking_price end,
  l.previous_price_observed_at,l.observed_at,l.first_seen_at,l.last_changed_at,l.last_checked_at,l.first_seen_run_id,l.delisted_at,
  l.neighborhood_id,l.neighborhood_candidates,l.neighborhood_radius_m,
  coalesce(hs.origin(l.value->>'sourceUrl')=any(p.listing_origins),false),hs.retention(),
  nullif(jsonb_strip_nulls(jsonb_build_object(
   'morePhotos',(select jsonb_agg(x order by n) from jsonb_array_elements(case when jsonb_typeof(l.value->'morePhotos')='array' then l.value->'morePhotos' else '[]'::jsonb end) with ordinality y(x,n)
    where hs.origin(x->>'url')=any(p.image_origins)),
   'floorPlan',case when jsonb_typeof(l.value->'floorPlan')='object' and hs.origin(l.value->'floorPlan'->>'url')=any(p.image_origins) then l.value->'floorPlan' end)),'{}'::jsonb)
 from hs.listings l join p on p.source_id=l.source_id
 where p_ids is null or l.id=any(p_ids)
$function$;

create or replace function hs.catalog_visible(p_household_id uuid, p_listing_id uuid) returns boolean language sql stable set search_path=pg_catalog,hs as $$
 select exists(select 1 from hs.listings l join hs.sources p on p.source_id=l.source_id where l.id=p_listing_id and
  (hs.listing_interacted(p_household_id,l.id) or (p.enabled and hs.origin(l.value->>'sourceUrl')=any(p.listing_origins)
   and l.observed_at>=now()-hs.retention())));
$$;

create or replace function hs.visible_listings(p_household_id uuid) returns table(listing_id uuid) language sql stable
begin atomic
 with p as materialized (select sources.source_id,sources.enabled as live from hs.sources)
 select h.listing_id from hs.household_listings h join hs.listing_cards c on c.listing_id=h.listing_id join p on p.source_id=c.source_id
 where h.household_id=visible_listings.p_household_id and (h.touched or (p.live and c.listed and c.observed_at>=now()-c.retention
  and (h.hidden or (h.matches and c.delisted_at is null))));
end;

CREATE OR REPLACE FUNCTION public.hs_household_snapshot(p_household_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
declare edition json; result json; homes integer; people integer; rules integer; saved integer;
begin
 perform hs.require_member(p_household_id);
 select json_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition
 from hs.editions order by published_at desc,id desc limit 1;
 with p as materialized (select source_id,enabled live,latest_run_id from hs.sources),
 -- The household's catalog homes with the clock-dependent rules applied.
 seen as materialized (
  select c.*,p.live,p.latest_run_id,
   case when (c.coordinates->>'observedAt')::timestamptz>=now()-c.retention and (c.coordinates->>'observedAt')::timestamptz<=now()+interval '5 minutes'
    and jsonb_typeof(c.coordinates)='object' then c.coordinates end shown_coordinates,
   case when p.live and (c.photo->>'expiresAt')::timestamptz>now() and (c.photo->>'observedAt')::timestamptz>=now()-c.retention then c.photo end shown_photo,
   case when p.live then (select jsonb_agg(jsonb_build_object('url',x->'url') order by n) from jsonb_array_elements(c.gallery->'morePhotos') with ordinality y(x,n)
    where (x->>'expiresAt')::timestamptz>now() and (x->>'observedAt')::timestamptz>=now()-c.retention) end shown_more,
   case when p.live and (c.gallery->'floorPlan'->>'expiresAt')::timestamptz>now() and (c.gallery->'floorPlan'->>'observedAt')::timestamptz>=now()-c.retention
    then c.gallery->'floorPlan' end shown_plan
  from hs.visible_listings(p_household_id) v join hs.listing_cards c on c.listing_id=v.listing_id join p on p.source_id=c.source_id),
 -- Each source's usual photo credit, sent once. A photo with other text carries its own.
 credits as materialized (
  select source_id,mode() within group (order by shown_photo->>'attribution') attribution,mode() within group (order by shown_photo->>'rightsBasis') rights
  from seen where shown_photo is not null group by source_id),
 areas as materialized (
  select a.id,a.name,a.dataset_version from hs.neighborhoods a
  where a.id in (select s.neighborhood_id from seen s where s.shown_coordinates is not null
   union select x from seen s,unnest(s.neighborhood_candidates) x where s.shown_coordinates is not null)),
 -- jsonb_strip_nulls drops keys without a value. It also reaches into nested objects, which is safe for the trimmed
 -- facts, coordinates, photo and area ids; viewings and evidence keep nullable fields, so they are added after it.
 source_homes as (
  select s.listing_id id,s.observed_at,jsonb_strip_nulls(jsonb_build_object(
   'id',s.listing_id,'sourceId',s.source_id,'title',s.title,'url',s.source_url,
   'facts',s.facts - array(select key from jsonb_each(s.facts) where hs.empty_facts()->key=value),
   'conflicts',nullif(s.conflicts,'[]'::jsonb),'coordinates',s.shown_coordinates,
   'photo',case when s.shown_photo is not null then jsonb_build_object('url',s.shown_photo->'url','expiresAt',s.shown_photo->'expiresAt','observedAt',s.shown_photo->'observedAt')
    ||case when (s.shown_photo->>'attribution',s.shown_photo->>'rightsBasis') is distinct from (k.attribution,k.rights)
     then jsonb_build_object('attribution',s.shown_photo->'attribution','rightsBasis',s.shown_photo->'rightsBasis') else '{}'::jsonb end end,
   'photos',case when s.shown_photo is not null and s.shown_more is not null then jsonb_build_array(jsonb_build_object('url',s.shown_photo->'url'))||s.shown_more end,
   'floorPlan',case when s.shown_plan is not null then jsonb_build_object('url',s.shown_plan->'url','expiresAt',s.shown_plan->'expiresAt','observedAt',s.shown_plan->'observedAt') end,
   'previousAskingPriceSek',case when s.previous_price_observed_at>=now()-s.retention then s.previous_asking_price end,
   'observedAt',s.observed_at,'firstSeenAt',s.first_seen_at,'lastChangedAt',s.last_changed_at,'lastCheckedAt',s.last_checked_at,
   'isNew',case when s.first_seen_run_id=s.latest_run_id then true end,
   'delistedAt',s.delisted_at,
   'neighborhoodId',case when s.shown_coordinates is not null then (select a.id from areas a where a.id=s.neighborhood_id) end,
   'neighborhoodIds',case when s.shown_coordinates is not null then coalesce((select jsonb_agg(ids.id order by ids.position)
    from unnest(s.neighborhood_candidates) with ordinality ids(id,position) join areas a on a.id=ids.id),'[]'::jsonb) end,
   'neighborhoodRadiusM',case when s.shown_coordinates is not null then s.neighborhood_radius_m end))
   ||coalesce((select jsonb_build_object('viewings',jsonb_agg(x order by x->>'startsAt')) from jsonb_array_elements(s.viewings) x
     where s.live and (x->>'startsAt')::timestamptz>now() having count(*)>0),'{}'::jsonb)
   ||coalesce((select jsonb_build_object('evidence',jsonb_agg(e order by n)) from jsonb_array_elements(s.evidence) with ordinality y(e,n)
     where (e->>'observedAt')::timestamptz>=now()-s.retention having count(*)>0),'{}'::jsonb) item
  from seen s left join credits k on k.source_id=s.source_id),
 manual_homes as (
  select m.id,m.observed_at,jsonb_strip_nulls(jsonb_build_object(
   'id',m.id,'origin','manual','title',m.value->>'title','sourceUrls',m.value->'sourceUrls',
   'facts',(select f - array(select key from jsonb_each(f) where hs.empty_facts()->key=value) from (select hs.empty_facts()||coalesce(m.value->'facts','{}'::jsonb) f) x),
   'photos',case when m.value ? 'imageUrls' then (select jsonb_agg(jsonb_build_object('url',u.url#>>'{}') order by n) from jsonb_array_elements(m.value->'imageUrls') with ordinality u(url,n)) end,
   'photoExpiresAt',case when m.value ? 'imageUrls' then to_jsonb(m.observed_at+interval '1 year') end,
   'observedAt',m.observed_at,'firstSeenAt',m.first_seen_at,'lastChangedAt',m.last_changed_at,'lastCheckedAt',m.last_checked_at,
   'addedBy',m.added_by,'userTags',m.value->'userTags')) item
  from hs.manual_listings m where m.household_id=p_household_id),
 all_homes as materialized (select * from source_homes union all select * from manual_homes)
 select json_build_object(
  'contractVersion',2,'householdId',p_household_id,'edition',edition,
  'members',(select coalesce(json_agg(json_build_object('userId',user_id,'displayName',display_name,'role',role) order by user_id),'[]'::json)
   from hs.members where household_id=p_household_id),
  'profiles',(select coalesce(json_agg(json_build_object('id',id,'revision',revision,'name',name,'enabled',enabled,'criteria',criteria,'editedBy',edited_by,'editedAt',edited_at) order by id),'[]'::json)
   from hs.profiles where household_id=p_household_id),
  'sources',(select coalesce(json_object_agg(source_id,json_build_object('photoAttribution',attribution,'photoRightsBasis',rights)),'{}'::json) from credits),
  'neighborhoods',(select coalesce(json_object_agg(id,json_build_object('name',name,'datasetVersion',dataset_version)),'{}'::json) from areas),
  'listings',(select coalesce(json_agg(item order by observed_at desc,id),'[]'::json) from all_homes),
  'favorites',(select coalesce(json_agg(json_build_object('listingId',coalesce(f.listing_id,f.manual_listing_id),'userId',f.user_id,'savedAt',f.saved_at) order by f.saved_at),'[]'::json)
   from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id
   where f.household_id=p_household_id and coalesce(f.listing_id,f.manual_listing_id) in (select id from all_homes)),
  'hides',(select coalesce(json_agg(json_build_object('listingId',coalesce(h.listing_id,h.manual_listing_id),'userId',h.user_id,'hiddenAt',h.hidden_at) order by coalesce(h.listing_id,h.manual_listing_id)),'[]'::json)
   from hs.hidden_listings h where h.household_id=p_household_id and coalesce(h.listing_id,h.manual_listing_id) in (select id from all_homes)),
  'notes',(select coalesce(json_agg(json_build_object('listingId',coalesce(n.listing_id,n.manual_listing_id),'userId',n.user_id,'body',n.body,'revision',n.revision,'editedAt',n.edited_at) order by coalesce(n.listing_id,n.manual_listing_id),n.user_id),'[]'::json)
   from hs.notes n where n.household_id=p_household_id and coalesce(n.listing_id,n.manual_listing_id) in (select id from all_homes))),
  (select count(*) from all_homes),
  (select count(*) from hs.members where household_id=p_household_id),
  (select count(*) from hs.profiles where household_id=p_household_id),
  (select count(*) from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id
   where f.household_id=p_household_id and coalesce(f.listing_id,f.manual_listing_id) in (select id from all_homes))
 into result,homes,people,rules,saved;
 if homes>1500 or people>10 or rules>20 or saved>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return result;
end; $function$;

CREATE OR REPLACE FUNCTION public.hs_ingest(p_key_id text, p_body_hash text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
declare c hs.ingest_credentials; r hs.runs; b hs.batches; s text; p hs.sources; o jsonb; result jsonb; ids text[]; edition_id uuid; success_count integer; batch_count integer;
begin
 if p_body_hash is null or p_body_hash !~ '^[a-f0-9]{64}$' or (p_request->>'contractVersion')::int is distinct from 1 then raise exception 'Invalid ingest envelope'; end if;
 select * into c from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes) for share;
 if c.key_id is null then raise exception 'Credential invalid' using errcode='42501'; end if;
 perform hs.lock_catalog();
 if p_request->>'action'='begin' then
  select array_agg(value order by value) into ids from jsonb_array_elements_text(p_request->'sourceIds');
  if ids is null or cardinality(ids) not between 1 and 20 or not ids<@c.source_ids or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Invalid source set'; end if;
  foreach s in array ids loop
   select * into p from hs.sources where source_id=s;
   if not coalesce(p.enabled,false) then raise exception 'Source disabled'; end if;
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
  select * into p from hs.sources where source_id=s;
  if not coalesce(p.enabled,false) then raise exception 'Source disabled'; end if;
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
  select * into p from hs.sources where source_id=s;
  if not coalesce(p.enabled,false) then raise exception 'Source disabled'; end if;
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
  if result->>'status'='success' then update hs.sources set cursor=result->>'cursor' where source_id=s; end if;
 end loop;
 if success_count>0 then
  insert into hs.editions(run_id,coverage,source_summary) values(r.id,case when not exists(select 1 from jsonb_array_elements(p_request->'results') v where v->>'status'<>'success') then 'complete' else 'partial' end,
   (select case when hs.text_length(summary)>900 then left(summary,440)||' [summary shortened; review run coverage details]' else summary end from (select string_agg((v->>'sourceId')||': '||(v->>'status')||' '||coalesce(v->>'coverageNote',''),'; ' order by v->>'sourceId') summary from jsonb_array_elements(p_request->'results') v) summaries)) returning id into edition_id;
 end if;
 -- Delisting reads this run's staged rows when the state changes, so they are deleted after it.
 update hs.runs set state=case when success_count>0 then 'published' else 'failed' end,publish_hash=p_body_hash,results=p_request->'results' where id=r.id returning * into r;
 delete from hs.staged_observations where run_id=r.id;
 return jsonb_build_object('runId',r.id,'state',r.state,'editionId',edition_id);
end; $function$;

CREATE OR REPLACE FUNCTION hs.record_latest_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
begin
 update hs.sources p set latest_run_id=new.id
 from jsonb_array_elements(new.results) result
 where p.source_id=result->>'sourceId' and result->>'status' in ('success','partial');
 return new;
end; $function$;

CREATE OR REPLACE FUNCTION hs.admin_issue_credential(p_key_id text, p_source_ids text[], p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hs'
AS $function$ begin
 perform hs.lock_catalog();
 if p_key_id is null or p_key_id !~ '^[a-zA-Z0-9_-]{1,80}$' or p_source_ids is null or array_ndims(p_source_ids) is distinct from 1 or cardinality(p_source_ids) not between 1 and 20 or
  exists(select 1 from unnest(p_source_ids) s where s is null) or cardinality(p_source_ids)<>(select count(distinct s) from unnest(p_source_ids) s) or
  p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '2160 hours' then raise exception 'Invalid credential'; end if;
 if (select count(*) from hs.sources where source_id=any(p_source_ids))<>cardinality(p_source_ids) then raise exception 'Unknown source'; end if;
 if exists(select 1 from hs.ingest_credentials where key_id=p_key_id) then raise exception 'Credential key id already used'; end if;
 insert into hs.ingest_credentials(key_id,source_ids,expires_at) values(p_key_id,p_source_ids,p_expires_at);
 insert into hs.admin_log(household_id,action,detail) values(null,'issue_credential',jsonb_build_object('keyId',p_key_id,'sourceIds',to_jsonb(p_source_ids),'expiresAt',p_expires_at));
 return jsonb_build_object('keyId',p_key_id,'sourceIds',to_jsonb(p_source_ids),'expiresAt',p_expires_at);
end; $function$;

-- What the ingest function checks each observation against: whether the source is on, and its hosts.
create function public.hs_ingest_sources(p_key_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare c hs.ingest_credentials; begin
 select * into c from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes);
 if c.key_id is null then raise exception 'Credential invalid' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('sourceId',source_id,'enabled',enabled,'listingOrigins',to_jsonb(listing_origins),
  'imageOrigins',to_jsonb(image_origins)) order by source_id),'[]'::jsonb) from hs.sources where source_id=any(c.source_ids));
end; $$;

-- Adds a source, or switches one on or off. Origins left null keep their stored value; a new source needs both.
-- Switching a source off hides its homes at once, except those a household saved, noted or hid, and ingest refuses it.
create function hs.admin_set_source(p_source_id text, p_enabled boolean, p_listing_origins text[] default null, p_image_origins text[] default null)
returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
declare v_old hs.sources; v_new hs.sources;
begin
 perform hs.lock_catalog();
 if p_source_id is null or p_source_id !~ '^[a-z0-9-]{1,60}$' or p_enabled is null then raise exception 'Invalid source'; end if;
 if (p_listing_origins is not null and not hs.valid_origins(p_listing_origins,1)) or (p_image_origins is not null and not hs.valid_origins(p_image_origins,0)) then
  raise exception 'Invalid origins'; end if;
 select * into v_old from hs.sources where source_id=p_source_id for update;
 if v_old.source_id is null then
  if p_listing_origins is null or p_image_origins is null then raise exception 'A new source needs its origins'; end if;
  insert into hs.sources(source_id,enabled,listing_origins,image_origins) values(p_source_id,p_enabled,p_listing_origins,p_image_origins) returning * into v_new;
 else
  update hs.sources set enabled=p_enabled,listing_origins=coalesce(p_listing_origins,listing_origins),image_origins=coalesce(p_image_origins,image_origins)
  where source_id=p_source_id returning * into v_new;
 end if;
 insert into hs.admin_log(household_id,action,detail) values(null,'set_source',jsonb_build_object('sourceId',p_source_id,'created',v_old.source_id is null,
  'enabled',jsonb_build_object('old',v_old.enabled,'new',v_new.enabled),'listingOrigins',to_jsonb(v_new.listing_origins),'imageOrigins',to_jsonb(v_new.image_origins)));
 return jsonb_build_object('sourceId',v_new.source_id,'enabled',v_new.enabled,'listingOrigins',to_jsonb(v_new.listing_origins),'imageOrigins',to_jsonb(v_new.image_origins));
end; $$;

-- Cards hold what a source's origins allow, so a change to them rewrites that source's cards.
create function hs.source_cards_follow() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 perform hs.refresh_cards(array(select l.id from hs.listings l join new_sources n on n.source_id=l.source_id
  join old_sources o on o.source_id=n.source_id where (o.listing_origins,o.image_origins) is distinct from (n.listing_origins,n.image_origins)));
 return null;
end; $$;

drop function hs.policy_cards_follow();
drop function hs.admin_set_source_policy(jsonb);
drop function public.hs_ingest_policies(text);
drop function hs.assert_observation(jsonb,jsonb);
drop function hs.assert_observation_facts(jsonb,jsonb);
drop function hs.valid_policy(jsonb);
drop function hs.scrub_value(jsonb,jsonb);
drop function hs.source_row_live(jsonb,text,timestamptz);
drop function hs.price_history_visible(jsonb,jsonb,timestamptz);
drop function hs.policy_live(jsonb);
drop function hs.lapse_grace();
drop function hs.policy_current(jsonb);
alter table hs.sources drop column policy;

create trigger source_cards after update on hs.sources referencing old table as old_sources new table as new_sources
 for each statement execute function hs.source_cards_follow();

-- New functions default to PUBLIC execute.
revoke all on all functions in schema hs from public,anon,authenticated,service_role;
revoke all on function public.hs_ingest_sources(text) from public,anon,authenticated,service_role;
grant execute on function public.hs_ingest_sources(text) to service_role;

select hs.refresh_cards(null);

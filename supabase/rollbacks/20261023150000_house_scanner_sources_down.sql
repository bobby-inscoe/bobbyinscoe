-- Rolls back 20261023150000_house_scanner_sources: restores hs.source_policies with each source's archived policy,
-- the policy functions and trigger, and rewrites the cards. A source added after the migration has no archived policy,
-- so the rollback stops; give it a policy in hs.source_policies_archive first.

drop trigger source_cards on hs.sources;
drop function hs.source_cards_follow();
drop function hs.admin_set_source(text,boolean,text[],text[]);
drop function public.hs_ingest_sources(text);
drop function hs.assert_observation(hs.sources,jsonb);
drop function hs.assert_observation_facts(hs.sources,jsonb);

-- visible_listings is compiled against the columns it reads; a placeholder frees them until the old one is restored.
create or replace function hs.visible_listings(p_household_id uuid) returns table(listing_id uuid) language sql stable
begin atomic
 select null::uuid where false;
end;

alter table hs.sources add column policy jsonb;
-- Each archived policy comes back with the origins the source has now, and disabled if the source was switched off.
update hs.sources s set policy=a.policy||jsonb_build_object('listingOrigins',to_jsonb(s.listing_origins),'imageOrigins',to_jsonb(s.image_origins))
 ||case when s.enabled then '{}'::jsonb else '{"status":"disabled"}'::jsonb end
from hs.source_policies_archive a where a.source_id=s.source_id;
alter table hs.sources drop constraint sources_listing_origins, drop constraint sources_image_origins,
 drop column enabled, drop column listing_origins, drop column image_origins;
alter table hs.sources rename to source_policies;
alter table hs.source_policies alter column policy set not null, add constraint source_policies_check check(jsonb_typeof(policy)='object' and policy->>'sourceId'=source_id),
 add constraint source_policy_shape check(
  (not(policy ? 'retentionDays') or case when jsonb_typeof(policy->'retentionDays')='number' and policy->>'retentionDays' ~ '^[0-9]+$' then (policy->>'retentionDays')::numeric between 1 and 180 else false end) and
  (not(policy ? 'listingOrigins') or jsonb_typeof(policy->'listingOrigins')='array') and
  (not(policy ? 'allowedFactFields') or jsonb_typeof(policy->'allowedFactFields')='array') and
  (not(policy ? 'allowedEvidenceSubjects') or jsonb_typeof(policy->'allowedEvidenceSubjects')='array'));
drop table hs.source_policies_archive;
-- Source switches were logged as set_source, which the earlier schema does not know.
delete from hs.admin_log where action='set_source';
alter table hs.admin_log drop constraint admin_log_action_check, add constraint admin_log_action_check
 check(action in ('bootstrap_household','set_member','set_source_policy','issue_credential','revoke_credential'));

CREATE OR REPLACE FUNCTION hs.policy_current(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select coalesce(p->>'status'='approved' and (p->>'freeOnly')::boolean and (p->>'automatedCollection')::boolean and (p->>'privateDisplay')::boolean and
 (p->>'reviewedAt')::timestamptz<=now() and (p->>'reviewDueAt')::timestamptz>now() and (p->>'retentionDays')::int between 1 and 180,false);
$function$;

CREATE OR REPLACE FUNCTION hs.lapse_grace()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$ select interval '0 seconds'; $function$;

CREATE OR REPLACE FUNCTION hs.policy_live(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
 select hs.policy_current(case when hs.lapse_grace()=interval '0 seconds' then p
  else jsonb_set(p,'{reviewDueAt}',to_jsonb(((p->>'reviewDueAt')::timestamptz+hs.lapse_grace())::text)) end);
$function$;

CREATE OR REPLACE FUNCTION hs.price_history_visible(p jsonb, v jsonb, prior_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
 select coalesce(p->'allowedFactFields' ? 'askingPriceSek' and not(v->'conflicts' ? 'askingPriceSek') and prior_at>=now()-make_interval(days=>(p->>'retentionDays')::int),false);
$function$;

CREATE OR REPLACE FUNCTION hs.source_row_live(p jsonb, source_url text, seen_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
 select coalesce(hs.policy_live(p) and p->'listingOrigins' ? hs.origin(source_url) and seen_at>=now()-make_interval(days=>(p->>'retentionDays')::int),false);
$function$;

CREATE OR REPLACE FUNCTION hs.scrub_value(v jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
declare r jsonb:=v; cutoff timestamptz; coordinate_at timestamptz;
begin
 if not hs.policy_live(p) then return v; end if;
 cutoff:=now()-make_interval(days=>(p->>'retentionDays')::int);
 if jsonb_typeof(r->'coordinates')='object' then
  coordinate_at:=(r->'coordinates'->>'observedAt')::timestamptz;
  if not coalesce(coordinate_at>=cutoff and coordinate_at<=now()+interval '5 minutes',false) then r:=jsonb_set(r,'{coordinates}','null'::jsonb); end if;
 end if;
 if jsonb_typeof(r->'evidence')='array' then
  r:=jsonb_set(r,'{evidence}',coalesce((select jsonb_agg(e order by ord) from jsonb_array_elements(r->'evidence') with ordinality as t(e,ord)
   where coalesce(p->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p->'listingOrigins' ? hs.origin(e->>'sourceUrl')) and (e->>'observedAt')::timestamptz>=cutoff,false)),'[]'::jsonb));
 end if;
 if jsonb_typeof(r->'photo')='object' and not coalesce(coalesce((p->>'imageDisplay')::boolean,false) and coalesce((p->>'imageHotlink')::boolean,false) and p->'imageOrigins' ? hs.origin(r->'photo'->>'url') and
  (r->'photo'->>'expiresAt')::timestamptz>now() and (r->'photo'->>'observedAt')::timestamptz>=cutoff,false) then r:=jsonb_set(r,'{photo}','null'::jsonb); end if;
 if jsonb_typeof(r->'facts')='object' then
  r:=jsonb_set(r,'{facts}',(select coalesce(jsonb_object_agg(f.key,case when p->'allowedFactFields' ? f.key then f.value else coalesce(hs.empty_facts()->f.key,'null'::jsonb) end),'{}'::jsonb) from jsonb_each(r->'facts') f));
 end if;
 return r;
end; $function$;

CREATE OR REPLACE FUNCTION hs.valid_policy(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'hs'
AS $function$ begin
 return coalesce(jsonb_typeof(p)='object' and (select count(*) from jsonb_object_keys(p) k where k<>'viewings')=20 and (not(p ? 'viewings') or jsonb_typeof(p->'viewings')='boolean') and
  jsonb_typeof(p->'sourceId')='string' and p->>'sourceId' ~ '^[a-z0-9-]{1,60}$' and
  hs.number_in(p,'revision',1,2147483647,true) and p->>'revision' ~ '^[0-9]+$' and
  p->>'status' in ('disabled','pending','approved') and jsonb_typeof(p->'status')='string' and
  not exists(select 1 from unnest(array['reviewedAt','reviewDueAt']) k where jsonb_typeof(p->k) is distinct from 'string' or
   p->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' or (p->>k)::timestamptz is null) and
  jsonb_typeof(p->'rightsBasis')='string' and hs.text_length(p->>'rightsBasis') between 1 and 2000 and
  p->'freeOnly'='true'::jsonb and
  not exists(select 1 from unnest(array['automatedCollection','privateDisplay','imageDisplay','imageHotlink','modelProcessing','emailDigest','telegramDigest']) k
   where jsonb_typeof(p->k) is distinct from 'boolean') and
  hs.number_in(p,'retentionDays',1,180,true) and p->>'retentionDays' ~ '^[0-9]+$' and
  -- An origin is scheme, lowercase host and a port that is neither the scheme default nor above 65535, as new URL().origin
  -- prints it. The WHATWG parser fails outright, and the schema refinement then throws, for a host whose last label is
  -- numeric or 0x hex unless the host is an IPv4 address, and for an invalid punycode label. So such a host must be a
  -- strict dotted quad, and no xn-- label is accepted, as in hs.valid_bookmark_url.
  jsonb_typeof(p->'listingOrigins')='array' and jsonb_array_length(p->'listingOrigins') between 1 and 20 and
  jsonb_typeof(p->'imageOrigins')='array' and jsonb_array_length(p->'imageOrigins') between 0 and 20 and
  not exists(select 1 from (select o,substring(o#>>'{}' from '^https?://([^:]+)') h from
    (select o from jsonb_array_elements(p->'listingOrigins') o union all select o from jsonb_array_elements(p->'imageOrigins') o) u) origins
   where jsonb_typeof(o)<>'string' or o#>>'{}' !~ '^https?://[a-z0-9.-]+(:(0|[1-9][0-9]{0,4}))?$' or
    coalesce(substring(o#>>'{}' from ':([0-9]+)$')::integer,0)>65535 or o#>>'{}' ~ '^https://.*:443$' or o#>>'{}' ~ '^http://.*:80$' or
    h ~ '(^|\.)xn--' or
    (regexp_replace(h,'\.$','') ~ '(^|\.)([0-9]+|0x[0-9a-f]*)$' and
     h !~ '^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$')) and
  jsonb_typeof(p->'allowedFactFields')='array' and jsonb_array_length(p->'allowedFactFields') between 0 and 20 and
  not exists(select 1 from jsonb_array_elements(p->'allowedFactFields') f where jsonb_typeof(f)<>'string' or not hs.empty_facts() ? (f#>>'{}')) and
  jsonb_typeof(p->'allowedEvidenceSubjects')='array' and jsonb_array_length(p->'allowedEvidenceSubjects') between 0 and 10 and
  not exists(select 1 from jsonb_array_elements(p->'allowedEvidenceSubjects') e where jsonb_typeof(e)<>'string' or
   (e#>>'{}') <> all(array['facts','nearby_nature','nature_access','green_outlook','privacy','quietness','transit'])) and
  jsonb_typeof(p->'capabilities')='object' and (select count(*) from jsonb_object_keys(p->'capabilities'))=7 and
  not exists(select 1 from unnest(array['discovery','knownListingRefresh','unknownPrice','upcoming','pagination']) k
   where jsonb_typeof(p->'capabilities'->k) is distinct from 'boolean') and
  (p->'capabilities'->'resultCap'='null'::jsonb or hs.number_in(p->'capabilities','resultCap',1,2147483647,true)) and
  jsonb_typeof(p->'capabilities'->'coverageGaps')='array' and jsonb_array_length(p->'capabilities'->'coverageGaps') between 0 and 30 and
  not exists(select 1 from jsonb_array_elements(p->'capabilities'->'coverageGaps') g where jsonb_typeof(g)<>'string' or hs.text_length(g#>>'{}')>300),false);
exception when others then return false; end; $function$;

CREATE OR REPLACE FUNCTION hs.assert_observation_facts(p jsonb, o jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hs'
AS $function$ declare f record; evidence_item jsonb; at_time timestamptz; begin
 if not hs.policy_current(p) or not(p->'listingOrigins' ? hs.origin(o->>'sourceUrl')) or (o->>'observedAt')::timestamptz>now()+interval '5 minutes' or
 (o->>'observedAt')::timestamptz<now()-make_interval(days=>(p->>'retentionDays')::int) or o->'coordinates'->>'precision'='user_supplied' then raise exception 'Source permission or observation time invalid'; end if;
 for at_time in
  select (o->'coordinates'->>'observedAt')::timestamptz where o->'coordinates'<>'null'::jsonb
  union all select (e->>'observedAt')::timestamptz from jsonb_array_elements(o->'evidence') e
  union all select (o->'photo'->>'observedAt')::timestamptz where o->'photo'<>'null'::jsonb
 loop
  if at_time is null or at_time>now()+interval '5 minutes' or at_time<now()-make_interval(days=>(p->>'retentionDays')::int) then raise exception 'Evidence, coordinate or photo outside retention'; end if;
 end loop;
 for f in select * from jsonb_each(o->'facts') loop
  if f.value<>'null'::jsonb and f.value<>'"unknown"'::jsonb and not(p->'allowedFactFields' ? f.key) then raise exception 'Fact field not permitted'; end if;
 end loop;
 if o->'photo'<>'null'::jsonb and (not coalesce((p->>'imageDisplay')::boolean,false) or not coalesce((p->>'imageHotlink')::boolean,false) or not(p->'imageOrigins' ? hs.origin(o->'photo'->>'url')) or (o->'photo'->>'expiresAt')::timestamptz<=now()) then raise exception 'Photo not permitted'; end if;
 for evidence_item in select * from jsonb_array_elements(o->'evidence') loop
  if evidence_item->>'kind' not in ('source_claim','measurement') or not(p->'allowedEvidenceSubjects' ? (evidence_item->>'subject')) or (evidence_item->>'sourceUrl' is not null and not(p->'listingOrigins' ? hs.origin(evidence_item->>'sourceUrl'))) then raise exception 'Evidence not permitted'; end if;
 end loop;
end; $function$;

CREATE OR REPLACE FUNCTION hs.assert_observation(p jsonb, o jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hs'
AS $function$ declare img jsonb; begin
 perform hs.assert_observation_facts(p,o);
 if jsonb_typeof(o->'viewings')='array' and jsonb_array_length(o->'viewings')>0 and p->'viewings' is distinct from 'true'::jsonb then
  raise exception 'Viewing times not permitted'; end if;
 if o ? 'morePhotos' and (jsonb_typeof(o->'morePhotos') is distinct from 'array' or jsonb_array_length(o->'morePhotos') not between 1 and 3
  or jsonb_typeof(o->'photo') is distinct from 'object') then raise exception 'Photo not permitted'; end if;
 for img in select x from jsonb_array_elements(coalesce(o->'morePhotos','[]'::jsonb)) x union all select o->'floorPlan' where o ? 'floorPlan' loop
  if jsonb_typeof(img) is distinct from 'object' or not coalesce((p->>'imageDisplay')::boolean and (p->>'imageHotlink')::boolean
   and p->'imageOrigins' ? hs.origin(img->>'url') and (img->>'expiresAt')::timestamptz>now()
   and (img->>'observedAt')::timestamptz between now()-make_interval(days=>(p->>'retentionDays')::int) and now()+interval '5 minutes',false) then
   raise exception 'Photo not permitted'; end if;
 end loop;
end; $function$;

CREATE OR REPLACE FUNCTION hs.admin_set_source_policy(p_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
declare v_old jsonb; v_created boolean; v_changed jsonb;
begin
 perform hs.lock_catalog();
 if not hs.valid_policy(p_policy) then raise exception 'Invalid source policy'; end if;
 select policy into v_old from hs.source_policies where source_id=p_policy->>'sourceId';
 v_created:=v_old is null;
 if not v_created and jsonb_typeof(v_old->'revision')='number' and (p_policy->>'revision')::numeric<=(v_old->>'revision')::numeric then raise exception 'Policy revision must increase'; end if;
 insert into hs.source_policies(source_id,policy) values(p_policy->>'sourceId',p_policy)
  on conflict(source_id) do update set policy=excluded.policy;
 select coalesce(jsonb_agg(t.k order by t.k),'[]'::jsonb) into v_changed from jsonb_object_keys(p_policy) as t(k) where v_created or v_old->t.k is distinct from p_policy->t.k;
 insert into hs.admin_log(household_id,action,detail) values(null,'set_source_policy',jsonb_build_object(
  'sourceId',p_policy->>'sourceId','created',v_created,'status',jsonb_build_object('old',v_old->'status','new',p_policy->'status'),
  'revision',jsonb_build_object('old',v_old->'revision','new',p_policy->'revision'),
  'retentionDays',jsonb_build_object('old',v_old->'retentionDays','new',p_policy->'retentionDays'),'changedKeys',v_changed));
 return jsonb_build_object('sourceId',p_policy->>'sourceId','created',v_created,'revision',p_policy->'revision');
end; $function$;

CREATE OR REPLACE FUNCTION public.hs_ingest_policies(p_key_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'hs'
AS $function$ declare c hs.ingest_credentials; begin
 select * into c from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes);
 if c.key_id is null then raise exception 'Credential invalid' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(policy order by source_id),'[]'::jsonb) from hs.source_policies where source_id=any(c.source_ids));
end; $function$;

CREATE OR REPLACE FUNCTION hs.policy_cards_follow()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
begin
 perform hs.refresh_cards(array(select l.id from hs.listings l join new_policies n on n.source_id=l.source_id
  join old_policies o on o.source_id=n.source_id where o.policy is distinct from n.policy));
 return null;
end; $function$;

CREATE OR REPLACE FUNCTION hs.card_rows(p_ids uuid[])
 RETURNS TABLE(listing_id uuid, source_id text, title text, source_url text, facts jsonb, conflicts jsonb, coordinates jsonb, evidence jsonb, photo jsonb, viewings jsonb, previous_asking_price bigint, previous_price_observed_at timestamp with time zone, observed_at timestamp with time zone, first_seen_at timestamp with time zone, last_changed_at timestamp with time zone, last_checked_at timestamp with time zone, first_seen_run_id uuid, delisted_at timestamp with time zone, neighborhood_id text, neighborhood_candidates text[], neighborhood_radius_m integer, listed boolean, retention interval, gallery jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
 -- Policies are stored out of line; ||'{}' reads each once, where the bare column is read again at every reference.
 with p as materialized (select source_id,policy||'{}'::jsonb policy,make_interval(days=>(policy->>'retentionDays')::int) retention,
  coalesce((policy->>'imageDisplay')::boolean,false) and coalesce((policy->>'imageHotlink')::boolean,false) images from hs.source_policies)
 select l.id,l.source_id,l.value->>'title',l.value->>'sourceUrl',
  hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb),
  coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb),
  nullif(l.value->'coordinates','null'::jsonb),
  coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where p.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl'))),'[]'::jsonb),
  case when p.images and p.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') then l.value->'photo' end,
  case when p.policy->'viewings'='true'::jsonb then coalesce((select jsonb_agg(x order by x->>'startsAt') from jsonb_array_elements(case when jsonb_typeof(l.value->'viewings')='array' then l.value->'viewings' else '[]'::jsonb end) x),'[]'::jsonb) end,
  case when p.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') then l.previous_asking_price end,
  l.previous_price_observed_at,l.observed_at,l.first_seen_at,l.last_changed_at,l.last_checked_at,l.first_seen_run_id,l.delisted_at,
  l.neighborhood_id,l.neighborhood_candidates,l.neighborhood_radius_m,
  coalesce(p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl'),false),p.retention,
  case when p.images then nullif(jsonb_strip_nulls(jsonb_build_object(
   'morePhotos',(select jsonb_agg(x order by n) from jsonb_array_elements(case when jsonb_typeof(l.value->'morePhotos')='array' then l.value->'morePhotos' else '[]'::jsonb end) with ordinality y(x,n)
    where p.policy->'imageOrigins' ? hs.origin(x->>'url')),
   'floorPlan',case when jsonb_typeof(l.value->'floorPlan')='object' and p.policy->'imageOrigins' ? hs.origin(l.value->'floorPlan'->>'url') then l.value->'floorPlan' end)),'{}'::jsonb) end
 from hs.listings l join p on p.source_id=l.source_id
 where p_ids is null or l.id=any(p_ids)
$function$;

CREATE OR REPLACE FUNCTION hs.catalog_visible(p_household_id uuid, p_listing_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
 select exists(select 1 from hs.listings l join hs.source_policies p on p.source_id=l.source_id where l.id=p_listing_id and
  (hs.listing_interacted(p_household_id,l.id) or (hs.policy_current(p.policy) and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl')
   and l.observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int))));
$function$;

CREATE OR REPLACE FUNCTION hs.visible_listings(p_household_id uuid)
 RETURNS TABLE(listing_id uuid)
 LANGUAGE sql
 STABLE
BEGIN ATOMIC
 WITH p AS MATERIALIZED (
          SELECT source_policies.source_id,
             hs.policy_current(source_policies.policy) AS live
            FROM hs.source_policies
         )
  SELECT h.listing_id
    FROM ((hs.household_listings h
      JOIN hs.listing_cards c ON ((c.listing_id = h.listing_id)))
      JOIN p ON ((p.source_id = c.source_id)))
   WHERE ((h.household_id = visible_listings.p_household_id) AND (h.touched OR (p.live AND c.listed AND (c.observed_at >= (now() - c.retention)) AND (h.hidden OR (h.matches AND (c.delisted_at IS NULL))))));
END;

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
 with p as materialized (select source_id,hs.policy_current(policy) live,latest_run_id from hs.source_policies),
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
end; $function$;

CREATE OR REPLACE FUNCTION hs.record_latest_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
begin
 update hs.source_policies p set latest_run_id=new.id
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
 if (select count(*) from hs.source_policies where source_id=any(p_source_ids))<>cardinality(p_source_ids) then raise exception 'Unknown source'; end if;
 if exists(select 1 from hs.ingest_credentials where key_id=p_key_id) then raise exception 'Credential key id already used'; end if;
 insert into hs.ingest_credentials(key_id,source_ids,expires_at) values(p_key_id,p_source_ids,p_expires_at);
 insert into hs.admin_log(household_id,action,detail) values(null,'issue_credential',jsonb_build_object('keyId',p_key_id,'sourceIds',to_jsonb(p_source_ids),'expiresAt',p_expires_at));
 return jsonb_build_object('keyId',p_key_id,'sourceIds',to_jsonb(p_source_ids),'expiresAt',p_expires_at);
end; $function$;

drop function hs.valid_origins(text[],integer);
drop function hs.retention();

create trigger policy_cards after update on hs.source_policies referencing old table as old_policies new table as new_policies
 for each statement execute function hs.policy_cards_follow();

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
revoke all on function public.hs_ingest_policies(text) from public,anon,authenticated,service_role;
grant execute on function public.hs_ingest_policies(text) to service_role;

select hs.refresh_cards(null);

-- Viewing times. A listing's value already holds whatever the latest observation carried, so the times need no
-- column. Four changes make them safe to carry:
-- 1. Viewing lists change daily, so they are left out of the content fingerprint. Counting them would add a revision
--    and an observation row to every home every day and could trip the conflicting-observation checks.
-- 2. Ingest refuses viewings from a source whose policy does not allow them (policy.viewings must be true).
-- 3. The snapshot carries a listing's future viewings when the policy allows them, and leaves the key out otherwise,
--    so a reader built before it keeps parsing until a policy is switched on. Apply the app and the ingest function
--    first; the policy revisions are the switch.
-- 4. Nothing else moves: the retention purge and the scrub pass the value through unchanged, and past times are
--    never shown.
create or replace function hs.observation_content(o jsonb) returns jsonb language sql immutable set search_path=pg_catalog as $$
 select (o-'observedAt'-'publishedAt'-'coordinates'-'photo'-'evidence'-'viewings') || jsonb_build_object(
 'coordinates',case when jsonb_typeof(o->'coordinates')='object' then (o->'coordinates')-'observedAt' else 'null'::jsonb end,'photo',case when jsonb_typeof(o->'photo')='object' then (o->'photo')-'observedAt'-'expiresAt' else 'null'::jsonb end,
 'evidence',coalesce((select jsonb_agg(e-'id'-'observedAt' order by (e-'id'-'observedAt')::text) from jsonb_array_elements(o->'evidence') e),'[]'::jsonb));
$$;

-- The original check keeps its body under a private name, so this migration does not copy it.
alter function hs.assert_observation(jsonb,jsonb) rename to assert_observation_facts;
create function hs.assert_observation(p jsonb,o jsonb) returns void language plpgsql set search_path=pg_catalog,hs as $$ begin
 perform hs.assert_observation_facts(p,o);
 if jsonb_typeof(o->'viewings')='array' and jsonb_array_length(o->'viewings')>0 and p->'viewings' is distinct from 'true'::jsonb then
  raise exception 'Viewing times not permitted'; end if;
end; $$;

-- Adds each visible listing's future viewings, in order, for a source whose current policy allows them.
create function hs.with_viewings(base jsonb,p_household_id uuid) returns jsonb language sql stable set search_path=pg_catalog,hs as $$
 select jsonb_set(base,'{listings}',coalesce((
  select jsonb_agg(case when v.list is null then e.item else e.item||jsonb_build_object('viewings',v.list) end order by e.ord)
  from jsonb_array_elements(base->'listings') with ordinality e(item,ord)
  left join lateral (
   select jsonb_agg(x order by x->>'startsAt') list
   from hs.listings l
   join hs.source_policies p on p.household_id=l.household_id and p.source_id=l.source_id,
   jsonb_array_elements(case when jsonb_typeof(l.value->'viewings')='array' then l.value->'viewings' else '[]'::jsonb end) x
   where l.household_id=p_household_id and l.id=(e.item->>'id')::uuid and l.origin='source'
    and p.policy->'viewings'='true'::jsonb and hs.policy_current(p.policy)
    and (x->>'startsAt')::timestamptz>now()
  ) v on true),'[]'::jsonb));
$$;

create or replace function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; ids jsonb; shared jsonb;
begin
 base:=hs.with_viewings(hs.snapshot_base(p_household_id),p_household_id);
 select jsonb_agg(h.listing_id order by h.listing_id) into ids from hs.hidden_listings h
  where h.household_id=p_household_id and h.user_id=auth.uid() and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=h.listing_id::text);
 select jsonb_agg(jsonb_build_object('listingId',n.listing_id,'userId',n.user_id,'body',n.body,'revision',n.revision,'editedAt',n.edited_at) order by n.listing_id,n.user_id) into shared from hs.notes n
  where n.household_id=p_household_id and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=n.listing_id::text);
 return base||case when ids is null then '{}'::jsonb else jsonb_build_object('hiddenListingIds',ids) end||case when shared is null then '{}'::jsonb else jsonb_build_object('notes',shared) end;
end; $$;

-- A policy may carry viewings, a boolean. The validator counted exactly twenty keys, so it learns the one optional key.
create or replace function hs.valid_policy(p jsonb) returns boolean language plpgsql stable set search_path=pg_catalog,hs as $$ begin
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
exception when others then return false; end; $$;

revoke all on function hs.assert_observation(jsonb,jsonb),hs.with_viewings(jsonb,uuid) from public,anon,authenticated,service_role;

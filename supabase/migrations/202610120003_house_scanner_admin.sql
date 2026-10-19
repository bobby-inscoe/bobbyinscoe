-- Operator-only household administration. Run these from the Supabase SQL editor as the postgres role.
-- There is no browser, PostgREST or Edge entry point: the functions live in schema hs, whose usage 0001 revoked from
-- every API role, they are plain SECURITY INVOKER, and nobody but the owner holds execute (revoked at the end).
-- Each call locks the household row before it writes, appends one hs.admin_log row on success, and raises on failure,
-- which rolls back every write of the call, so a failed call leaves no log row. Members are never deleted: a leaving
-- member is deactivated, and their favorites and notes stay unless a clear flag is passed explicitly.

-- Time, household, action, subject user and a detail object of old and new values and counts. Never emails, secrets,
-- criteria or policy text. RLS is on with no policy and no grant, so only the owner reads it. No foreign key, so the
-- history outlives anything it names.
create table hs.admin_log (
 id bigint generated always as identity primary key, logged_at timestamptz not null default clock_timestamp(),
 household_id uuid not null,
 action text not null check(action in ('bootstrap_household','set_member','set_source_policy','issue_credential','revoke_credential')),
 subject_user_id uuid, detail jsonb not null check(jsonb_typeof(detail)='object')
);
alter table hs.admin_log enable row level security;
revoke all on hs.admin_log from public,anon,authenticated,service_role;

-- True when the policy satisfies sourcePolicySchema (src/features/house-scanner/types/contracts.ts), for every status.
-- The database reads sourceId, status, both timestamps, the booleans, retentionDays, the origin and field arrays and
-- capabilities; the Edge ingest parses every policy in a credential's scope with the full schema and fails the whole
-- request on one malformed policy, so the keys it alone reads are checked too and extra keys are rejected.
-- Deliberately stricter than the schema: origins must be http(s) with an ASCII host (no ftp, ws, IPv6, IDN or xn-- hosts),
-- retentionDays and numeric bounds must be written as plain integers (the table check rejects 30.0), and integers stop
-- at 2147483647.
create function hs.valid_policy(p jsonb) returns boolean language plpgsql stable set search_path=pg_catalog,hs as $$ begin
 return coalesce(jsonb_typeof(p)='object' and (select count(*) from jsonb_object_keys(p))=20 and
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

-- Creates one household with its owner and one enabled profile at revision 1. Criteria are an argument with no default,
-- so nothing here can seed a preference. The first profile version row is written lazily by hs_ingest and hs_save_profile.
-- Returns {householdId, profileId}.
create function hs.admin_bootstrap_household(p_name text,p_owner_user_id uuid,p_owner_name text,p_profile_name text,p_criteria jsonb) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
declare v_household uuid; v_profile uuid;
begin
 if p_name is null or p_owner_user_id is null or p_owner_name is null or p_profile_name is null or
  p_name !~ '\S' or p_owner_name !~ '\S' or p_profile_name !~ '\S' or
  hs.text_length(btrim(p_name)) not between 1 and 80 or hs.text_length(btrim(p_owner_name)) not between 1 and 80 or hs.text_length(btrim(p_profile_name)) not between 1 and 80 or
  not hs.valid_criteria(p_criteria) then raise exception 'Invalid household'; end if;
 if not exists(select 1 from auth.users where id=p_owner_user_id) then raise exception 'Unknown auth user'; end if;
 insert into hs.households(name) values(btrim(p_name)) returning id into v_household;
 insert into hs.members(household_id,user_id,display_name,role,active) values(v_household,p_owner_user_id,btrim(p_owner_name),'owner',true);
 insert into hs.profiles(household_id,name,enabled,criteria,edited_by) values(v_household,btrim(p_profile_name),true,p_criteria,p_owner_user_id) returning id into v_profile;
 insert into hs.admin_log(household_id,action,subject_user_id,detail) values(v_household,'bootstrap_household',p_owner_user_id,jsonb_build_object('profileId',v_profile,'profileRevision',1));
 return jsonb_build_object('householdId',v_household,'profileId',v_profile);
end; $$;

-- Adds a member or updates one. The auth user must already exist; a user without a member row reads nothing.
-- Deactivation (p_active false) only sets active=false. p_clear_favorites and p_clear_notes delete that member's
-- favorites and notes and are only accepted for an inactive result, so a listing they alone saved becomes an ordinary
-- expired listing for the next purge. Reactivation restores and deletes nothing. A household keeps at least one
-- active owner and at most ten member rows, which is the limit hs_snapshot raises above.
-- Returns {created, favoritesCleared, notesCleared}.
create function hs.admin_set_member(p_household_id uuid,p_user_id uuid,p_display_name text,p_role text,p_active boolean,p_clear_favorites boolean default false,p_clear_notes boolean default false) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
declare v_old hs.members; v_created boolean; v_favorites integer:=0; v_notes integer:=0;
begin
 perform 1 from hs.households where id=p_household_id for update;
 if not found then raise exception 'Household unavailable'; end if;
 if p_user_id is null or p_display_name is null or p_display_name !~ '\S' or hs.text_length(btrim(p_display_name)) not between 1 and 80 or
  p_role is null or p_role not in ('owner','member') or p_active is null or p_clear_favorites is null or p_clear_notes is null then raise exception 'Invalid member'; end if;
 if p_active and (p_clear_favorites or p_clear_notes) then raise exception 'Clearing needs an inactive member'; end if;
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Unknown auth user'; end if;
 select * into v_old from hs.members where household_id=p_household_id and user_id=p_user_id;
 v_created:=v_old.user_id is null;
 if v_created then
  if (select count(*) from hs.members where household_id=p_household_id)>=10 then raise exception 'Household member limit reached'; end if;
  insert into hs.members(household_id,user_id,display_name,role,active) values(p_household_id,p_user_id,btrim(p_display_name),p_role,p_active);
 else
  update hs.members set display_name=btrim(p_display_name),role=p_role,active=p_active where household_id=p_household_id and user_id=p_user_id;
 end if;
 if not exists(select 1 from hs.members where household_id=p_household_id and role='owner' and active) then raise exception 'Household needs an active owner'; end if;
 if p_clear_favorites then
  delete from hs.favorites where household_id=p_household_id and user_id=p_user_id;
  get diagnostics v_favorites=row_count;
 end if;
 if p_clear_notes then
  delete from hs.notes where household_id=p_household_id and user_id=p_user_id;
  get diagnostics v_notes=row_count;
 end if;
 -- The display name is not logged, only whether it changed.
 insert into hs.admin_log(household_id,action,subject_user_id,detail) values(p_household_id,'set_member',p_user_id,jsonb_build_object(
  'created',v_created,'role',jsonb_build_object('old',v_old.role,'new',p_role),'active',jsonb_build_object('old',v_old.active,'new',p_active),
  'displayNameChanged',v_old.display_name is distinct from btrim(p_display_name),
  'clearFavorites',p_clear_favorites,'favoritesCleared',v_favorites,'clearNotes',p_clear_notes,'notesCleared',v_notes));
 return jsonb_build_object('created',v_created,'favoritesCleared',v_favorites,'notesCleared',v_notes);
end; $$;

-- Creates or replaces one source policy, keyed by its sourceId. The stored cursor is kept. The revision must rise
-- above the stored one, so an unchanged policy has to be written with a higher revision.
-- Returns {sourceId, created, revision}.
create function hs.admin_set_source_policy(p_household_id uuid,p_policy jsonb) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
declare v_old jsonb; v_created boolean; v_changed jsonb;
begin
 perform 1 from hs.households where id=p_household_id for update;
 if not found then raise exception 'Household unavailable'; end if;
 if not hs.valid_policy(p_policy) then raise exception 'Invalid source policy'; end if;
 select policy into v_old from hs.source_policies where household_id=p_household_id and source_id=p_policy->>'sourceId';
 v_created:=v_old is null;
 if not v_created and jsonb_typeof(v_old->'revision')='number' and (p_policy->>'revision')::numeric<=(v_old->>'revision')::numeric then raise exception 'Policy revision must increase'; end if;
 insert into hs.source_policies(household_id,source_id,policy) values(p_household_id,p_policy->>'sourceId',p_policy)
  on conflict(household_id,source_id) do update set policy=excluded.policy;
 select coalesce(jsonb_agg(t.k order by t.k),'[]'::jsonb) into v_changed from jsonb_object_keys(p_policy) as t(k) where v_created or v_old->t.k is distinct from p_policy->t.k;
 insert into hs.admin_log(household_id,action,detail) values(p_household_id,'set_source_policy',jsonb_build_object(
  'sourceId',p_policy->>'sourceId','created',v_created,'status',jsonb_build_object('old',v_old->'status','new',p_policy->'status'),
  'revision',jsonb_build_object('old',v_old->'revision','new',p_policy->'revision'),
  'retentionDays',jsonb_build_object('old',v_old->'retentionDays','new',p_policy->'retentionDays'),'changedKeys',v_changed));
 return jsonb_build_object('sourceId',p_policy->>'sourceId','created',v_created,'revision',p_policy->'revision');
end; $$;

-- Registers an ingest credential row. The HMAC secret is generated and stored outside the database, in the Edge
-- function environment (HS_INGEST_KEYS_JSON, keyed by this key id). Nothing here creates, returns or stores a secret.
-- A key id is never reused, revoked or not. Expiry is in the future and at most 90 days (2160 hours, so a DST change
-- cannot stretch the cap) out. The source id list must be one-dimensional.
-- Returns {keyId, sourceIds, expiresAt}.
create function hs.admin_issue_credential(p_household_id uuid,p_key_id text,p_source_ids text[],p_expires_at timestamptz) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$ begin
 perform 1 from hs.households where id=p_household_id for update;
 if not found then raise exception 'Household unavailable'; end if;
 if p_key_id is null or p_key_id !~ '^[a-zA-Z0-9_-]{1,80}$' or p_source_ids is null or array_ndims(p_source_ids) is distinct from 1 or cardinality(p_source_ids) not between 1 and 20 or
  exists(select 1 from unnest(p_source_ids) s where s is null) or cardinality(p_source_ids)<>(select count(distinct s) from unnest(p_source_ids) s) or
  p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '2160 hours' then raise exception 'Invalid credential'; end if;
 if (select count(*) from hs.source_policies where household_id=p_household_id and source_id=any(p_source_ids))<>cardinality(p_source_ids) then raise exception 'Unknown source'; end if;
 if exists(select 1 from hs.ingest_credentials where key_id=p_key_id) then raise exception 'Credential key id already used'; end if;
 insert into hs.ingest_credentials(key_id,household_id,source_ids,expires_at) values(p_key_id,p_household_id,p_source_ids,p_expires_at);
 insert into hs.admin_log(household_id,action,detail) values(p_household_id,'issue_credential',jsonb_build_object('keyId',p_key_id,'sourceIds',to_jsonb(p_source_ids),'expiresAt',p_expires_at));
 return jsonb_build_object('keyId',p_key_id,'sourceIds',to_jsonb(p_source_ids),'expiresAt',p_expires_at);
end; $$;

-- Sets revoked_at, after which hs_ingest_credential, hs_consume_nonce, hs_ingest_policies and hs_ingest refuse the key.
-- Locks the credential row and then the household row, the order hs_ingest takes them in, so the two cannot deadlock.
-- A key that is unknown or already revoked raises, which keeps the original revoked_at and the log honest.
-- Returns {keyId, revokedAt}.
create function hs.admin_revoke_credential(p_key_id text) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
declare v_household uuid; v_revoked timestamptz;
begin
 select household_id into v_household from hs.ingest_credentials where key_id=p_key_id for update;
 if v_household is null then raise exception 'Credential unavailable'; end if;
 perform 1 from hs.households where id=v_household for update;
 update hs.ingest_credentials set revoked_at=now() where key_id=p_key_id and revoked_at is null returning revoked_at into v_revoked;
 if v_revoked is null then raise exception 'Credential already revoked'; end if;
 insert into hs.admin_log(household_id,action,detail) values(v_household,'revoke_credential',jsonb_build_object('keyId',p_key_id));
 return jsonb_build_object('keyId',p_key_id,'revokedAt',v_revoked);
end; $$;

-- New functions default to PUBLIC execute. Nothing is granted afterwards: only the owning operator role can call these.
revoke all on all functions in schema hs from public,anon,authenticated,service_role;

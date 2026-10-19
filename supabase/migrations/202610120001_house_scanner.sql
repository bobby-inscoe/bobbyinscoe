-- Browser clients have no private table grants; checked RPCs own all writes.
create schema if not exists hs;
revoke all on schema hs from public, anon, authenticated, service_role;
create table hs.households (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80));
create table hs.members (
 household_id uuid not null references hs.households(id), user_id uuid not null references auth.users(id),
 display_name text not null check(length(display_name) between 1 and 80), role text not null check(role in ('owner','member')),
 active boolean not null default true, primary key(household_id,user_id)
);
create table hs.profiles (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references hs.households(id), revision integer not null default 1 check(revision>0),
 name text not null check(length(name) between 1 and 80), enabled boolean not null, criteria jsonb not null check(jsonb_typeof(criteria)='object'),
 edited_by uuid not null, edited_at timestamptz not null default now(), unique(id,household_id),
 foreign key(household_id,edited_by) references hs.members(household_id,user_id)
);
create table hs.profile_versions (
 profile_id uuid not null, household_id uuid not null, revision integer not null, value jsonb not null, primary key(profile_id,revision),
 foreign key(profile_id,household_id) references hs.profiles(id,household_id)
);
create table hs.source_policies (
 household_id uuid not null references hs.households(id), source_id text not null check(source_id ~ '^[a-z0-9-]{1,60}$'),
 policy jsonb not null check(jsonb_typeof(policy)='object' and policy->>'sourceId'=source_id), cursor text, primary key(household_id,source_id),
 -- Reads and the retention purge cast these keys for every listing of the source, so one malformed value would make
 -- hs_snapshot raise for the whole household. Pending and disabled policies may omit a key, so only present keys are checked.
 constraint source_policy_shape check(
  (not(policy ? 'retentionDays') or case when jsonb_typeof(policy->'retentionDays')='number' and policy->>'retentionDays' ~ '^[0-9]+$' then (policy->>'retentionDays')::numeric between 1 and 180 else false end) and
  (not(policy ? 'listingOrigins') or jsonb_typeof(policy->'listingOrigins')='array') and
  (not(policy ? 'allowedFactFields') or jsonb_typeof(policy->'allowedFactFields')='array') and
  (not(policy ? 'allowedEvidenceSubjects') or jsonb_typeof(policy->'allowedEvidenceSubjects')='array'))
);
create table hs.ingest_credentials (
 key_id text primary key check(key_id ~ '^[a-zA-Z0-9_-]{1,80}$'), household_id uuid not null references hs.households(id),
 source_ids text[] not null check(cardinality(source_ids) between 1 and 20), scopes text[] not null default array['ingest']::text[] check(scopes <@ array['ingest']::text[]),
 revoked_at timestamptz, expires_at timestamptz not null, unique(key_id,household_id)
);
create table hs.ingest_nonces (
 key_id text not null references hs.ingest_credentials(key_id), nonce text not null check(nonce ~ '^[a-zA-Z0-9_-]{16,128}$'),
 used_at timestamptz not null default now(), primary key(key_id,nonce)
);
create table hs.runs (
 id uuid primary key, household_id uuid not null, key_id text not null, profile_versions jsonb not null, source_ids text[] not null,
 state text not null default 'staging' check(state in ('staging','published','failed')), begin_hash text not null, publish_hash text, results jsonb,
 created_at timestamptz not null default now(), unique(id,household_id), foreign key(key_id,household_id) references hs.ingest_credentials(key_id,household_id)
);
create table hs.batches (
 id uuid primary key, run_id uuid not null, household_id uuid not null, source_id text not null, body_hash text not null check(body_hash ~ '^[a-f0-9]{64}$'),
 foreign key(run_id,household_id) references hs.runs(id,household_id), foreign key(household_id,source_id) references hs.source_policies(household_id,source_id)
);
create table hs.staged_observations (
 run_id uuid not null, household_id uuid not null, source_id text not null, source_listing_id text not null, episode_id text not null, observed_at timestamptz not null, value jsonb not null,
 primary key(run_id,source_id,source_listing_id,episode_id,observed_at), foreign key(run_id,household_id) references hs.runs(id,household_id),
 foreign key(household_id,source_id) references hs.source_policies(household_id,source_id)
);
create table hs.listings (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references hs.households(id), origin text not null check(origin in ('source','manual')),
 source_id text, source_listing_id text, episode_id text, value jsonb not null, added_by uuid, canonical_url text, revision integer not null default 1,
 previous_asking_price bigint check(previous_asking_price>0), previous_price_observed_at timestamptz, observed_at timestamptz not null default now(), last_checked_at timestamptz not null default now(),
 unique(id,household_id), unique(household_id,source_id,source_listing_id,episode_id), unique(household_id,canonical_url),
 foreign key(household_id,source_id) references hs.source_policies(household_id,source_id), foreign key(household_id,added_by) references hs.members(household_id,user_id),
 check((origin='source' and source_id is not null and source_listing_id is not null and episode_id is not null and added_by is null) or
       (origin='manual' and source_id is null and source_listing_id is null and episode_id is null and added_by is not null))
);
create table hs.observations (
 id uuid primary key default gen_random_uuid(), household_id uuid not null, listing_id uuid not null, run_id uuid not null, value jsonb not null, received_at timestamptz not null default now(),
 foreign key(listing_id,household_id) references hs.listings(id,household_id), foreign key(run_id,household_id) references hs.runs(id,household_id)
);
create table hs.editions (
 id uuid primary key default gen_random_uuid(), household_id uuid not null, run_id uuid not null unique, published_at timestamptz not null default now(),
 coverage text not null check(coverage in ('partial','complete')), source_summary text not null, foreign key(run_id,household_id) references hs.runs(id,household_id)
);
create table hs.favorites (
 household_id uuid not null, listing_id uuid not null, user_id uuid not null, bookmark_url text not null, saved_at timestamptz not null default now(), primary key(household_id,listing_id,user_id),
 foreign key(listing_id,household_id) references hs.listings(id,household_id), foreign key(household_id,user_id) references hs.members(household_id,user_id)
);
create table hs.notes (
 household_id uuid not null, listing_id uuid not null, user_id uuid not null, bookmark_url text not null, body text not null check(length(body)<=2000), revision integer not null default 1,
 edited_at timestamptz not null default now(), primary key(household_id,listing_id,user_id),
 foreign key(listing_id,household_id) references hs.listings(id,household_id), foreign key(household_id,user_id) references hs.members(household_id,user_id)
);
create function hs.is_member(h uuid) returns boolean language sql stable security definer set search_path=pg_catalog,hs as $$
 select exists(select 1 from hs.members where household_id=h and user_id=auth.uid() and active);
$$;
create function hs.require_member(h uuid, owner_only boolean default false) returns void language plpgsql security definer set search_path=pg_catalog,hs as $$
begin
 if auth.uid() is null or not exists(select 1 from hs.members where household_id=h and user_id=auth.uid() and active and (not owner_only or role='owner')) then
  raise exception 'Household access denied' using errcode='42501';
 end if;
end;
$$;
do $$ declare t text; begin
 foreach t in array array['households','members','profiles','profile_versions','source_policies','ingest_credentials','ingest_nonces','runs','batches','staged_observations','listings','observations','editions','favorites','notes'] loop
  execute format('alter table hs.%I enable row level security',t);
  execute format('revoke all on hs.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['households','members','profiles','profile_versions','listings','observations','editions','favorites','notes'] loop
  execute format('create policy active_household_read on hs.%I for select to authenticated using(hs.is_member(%I))',t,case when t='households' then 'id' else 'household_id' end);
 end loop;
end; $$;
create function hs.empty_facts() returns jsonb language sql immutable set search_path=pg_catalog as $$
 select '{"propertyType":null,"tenure":"unknown","purchase":null,"livingAreaM2":null,"secondaryAreaM2":null,"rooms":null,"askingPriceSek":null,"groundFloor":null,"lift":null,"liftServesHome":null,"stepFree":null,"outdoor":null,"glazed":null,"largePrivateTerrace":null,"municipality":null,"baseFeeSek":null,"mandatoryMonthlySek":null,"status":"unknown"}'::jsonb;
$$;
create function hs.origin(url text) returns text language sql immutable set search_path=pg_catalog as $$ select substring(url from '^https?://[^/?#]+'); $$;
create function hs.policy_current(p jsonb) returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(p->>'status'='approved' and (p->>'freeOnly')::boolean and (p->>'automatedCollection')::boolean and (p->>'privateDisplay')::boolean and
 (p->>'reviewedAt')::timestamptz<=now() and (p->>'reviewDueAt')::timestamptz>now() and (p->>'retentionDays')::int between 1 and 180,false);
$$;
-- A listing someone favorited or wrote a note on is kept with its stored content. A blank note row does not count:
-- saving an empty note is how a note is removed, and the retention purge must be able to delete the listing then.
create function hs.listing_interacted(p_household_id uuid,p_listing_id uuid) returns boolean language sql stable set search_path=pg_catalog,hs as $$
 select exists(select 1 from hs.favorites where household_id=p_household_id and listing_id=p_listing_id)
  or exists(select 1 from hs.notes where household_id=p_household_id and listing_id=p_listing_id and body ~ '\S');
$$;
create function hs.assert_observation(p jsonb,o jsonb) returns void language plpgsql set search_path=pg_catalog,hs as $$ declare f record; evidence_item jsonb; at_time timestamptz; begin
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
end; $$;
-- Membership and role mutation have no browser entry point.
create function public.hs_memberships() returns jsonb language sql stable security definer set search_path=pg_catalog,hs as $$
 select coalesce(jsonb_agg(jsonb_build_object('householdId',household_id,'userId',user_id,'displayName',display_name,'role',role) order by household_id),'[]'::jsonb)
 from hs.members where user_id=auth.uid() and active;
$$;
create function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare visible jsonb; edition jsonb; people jsonb; profiles jsonb; favorites jsonb;
begin
 perform hs.require_member(p_household_id);
 select jsonb_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition from hs.editions where household_id=p_household_id order by published_at desc,id desc limit 1;
 select coalesce(jsonb_agg(item order by observed_at desc,id),'[]'::jsonb) into visible from (
 select l.id,l.observed_at,jsonb_build_object(
 'id',l.id,'householdId',l.household_id,'origin',l.origin,'title',l.value->>'title',
 'sourceUrls',case when l.origin='manual' then l.value->'sourceUrls' else jsonb_build_array(l.value->>'sourceUrl') end,
 'facts',case when l.origin='manual' then hs.empty_facts() else hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb) end,
 'conflicts',case when l.origin='manual' then '[]'::jsonb else coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb) end,
 'coordinates',case when l.origin='source' and (l.value->'coordinates'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) and (l.value->'coordinates'->>'observedAt')::timestamptz<=now()+interval '5 minutes' then l.value->'coordinates' else 'null'::jsonb end,
 'evidence',case when l.origin='manual' then '[]'::jsonb else coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where p.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl')) and (e->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)),'[]'::jsonb) end,
 'photo',case when l.origin='source' and hs.policy_current(p.policy) and coalesce((p.policy->>'imageDisplay')::boolean,false) and coalesce((p.policy->>'imageHotlink')::boolean,false) and p.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') and (l.value->'photo'->>'expiresAt')::timestamptz>now() and (l.value->'photo'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.value->'photo' else 'null'::jsonb end,
 'previousAskingPriceSek',case when p.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') and l.previous_price_observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.previous_asking_price else null end,
 'observedAt',l.observed_at,'addedBy',l.added_by,'userTags',case when l.origin='manual' then l.value->'userTags' else '[]'::jsonb end
 ) item from hs.listings l left join hs.source_policies p on p.household_id=l.household_id and p.source_id=l.source_id
 where l.household_id=p_household_id and (l.origin='manual' or hs.listing_interacted(l.household_id,l.id) or (hs.policy_current(p.policy) and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl') and l.observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)))
 ) permitted;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',household_id,'userId',user_id,'displayName',display_name,'role',role) order by user_id),'[]'::jsonb) into people from hs.members where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'householdId',household_id,'revision',revision,'name',name,'enabled',enabled,'criteria',criteria,'editedBy',edited_by,'editedAt',edited_at) order by id),'[]'::jsonb) into profiles from hs.profiles where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',f.household_id,'listingId',listing_id,'userId',f.user_id,'savedAt',saved_at) order by saved_at),'[]'::jsonb) into favorites from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id where f.household_id=p_household_id and exists(select 1 from jsonb_array_elements(visible) v where v->>'id'=f.listing_id::text);
 if jsonb_array_length(visible)>500 or jsonb_array_length(people)>10 or jsonb_array_length(profiles)>20 or jsonb_array_length(favorites)>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return jsonb_build_object('contractVersion',1,'householdId',p_household_id,'edition',edition,'listings',visible,'members',people,'profiles',profiles,'favorites',favorites);
end; $$;
-- The favorite and note writers take the household lock first, as hs_ingest and hs.purge_expired do. Without it a
-- favorite landing mid-purge could save a listing after the purge chose its history rows, which the purge then deletes.
-- Membership is checked again after the lock. Under READ COMMITTED a request that passed the first check and then waited on
-- the lock would otherwise write after an operator deactivated or demoted the caller; the first check stays as a cheap gate
-- so an outsider cannot queue for the lock.
create function public.hs_set_favorite(p_household_id uuid,p_listing_id uuid,p_saved boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_saved is null or not exists(select 1 from hs.listings where id=p_listing_id and household_id=p_household_id) then raise exception 'Listing unavailable'; end if;
 if p_saved then insert into hs.favorites(household_id,listing_id,user_id,bookmark_url) select p_household_id,p_listing_id,auth.uid(),coalesce(value->>'sourceUrl',value->'sourceUrls'->>0) from hs.listings where id=p_listing_id and household_id=p_household_id on conflict do nothing;
 else delete from hs.favorites where household_id=p_household_id and listing_id=p_listing_id and user_id=auth.uid(); end if;
 return jsonb_build_object('ok',true);
end; $$;
-- Zod 4 counts Unicode code points; this function counts UTF-16 code units, as a browser maxLength does, so the
-- database is the stricter of the two for text with characters outside the Basic Multilingual Plane.
create function hs.text_length(t text) returns integer language sql immutable set search_path=pg_catalog as $$
 select length(t)+(select count(*)::integer from regexp_matches(t,U&'[\+010000-\+10FFFF]','g'));
$$;
create function hs.valid_bookmark_url(u text) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare host_name text; address inet;
begin
 if u is null or u !~ '^https?://([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' or position(chr(92) in u)>0 then return false; end if;
 if coalesce(substring(u from '^https?://(?:\[[0-9a-fA-F:]+\]|[^:/?#]+):([0-9]+)(?:[/#?]|$)')::integer,0)>65535 then return false; end if;
 host_name:=substring(u from '^https?://(\[[0-9a-fA-F:]+\]|[^:/?#]+)');
 if left(host_name,1)='[' then address:=btrim(host_name,'[]')::inet; return family(address)=6; end if;
 if host_name ~ '^[0-9.]+$' then address:=host_name::inet; return family(address)=4 and host(address)=host_name and host_name ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; end if;
 -- ponytail: accept ASCII DNS names only until server-side IDNA validation is available.
 if host_name ~* '(^|\.)xn--' then return false; end if;
 return host_name ~ '^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?$';
exception when others then return false;
end; $$;
create function public.hs_add_manual(p_household_id uuid,p_url text,p_title text,p_note text,p_tags jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare lid uuid; begin
 perform hs.require_member(p_household_id);
 if p_url is null or p_title is null or p_note is null or p_tags is null or hs.text_length(p_url)>2048 or not hs.valid_bookmark_url(p_url) or hs.text_length(p_title)>200 or hs.text_length(p_note)>2000 or jsonb_typeof(p_tags)<>'array' or jsonb_array_length(p_tags)>10 or exists(select 1 from jsonb_array_elements(p_tags) tag where jsonb_typeof(tag)<>'string' or hs.text_length(tag#>>'{}') not between 1 and 40) then raise exception 'Invalid bookmark'; end if;
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 select id into lid from hs.listings where household_id=p_household_id and (canonical_url=p_url or (origin='source' and value->>'sourceUrl'=p_url)) order by id limit 1;
 if lid is not null then return jsonb_build_object('listingId',lid,'existing',true); end if;
 insert into hs.listings(household_id,origin,added_by,canonical_url,value) values(p_household_id,'manual',auth.uid(),p_url,jsonb_build_object('title',coalesce(nullif(btrim(p_title),''),'Saved listing'),'sourceUrls',jsonb_build_array(p_url),'userTags',p_tags)) returning id into lid;
 if length(btrim(p_note))>0 then insert into hs.notes(household_id,listing_id,user_id,bookmark_url,body) values(p_household_id,lid,auth.uid(),p_url,btrim(p_note)); end if;
 return jsonb_build_object('listingId',lid,'existing',false);
end; $$;
create function public.hs_notes(p_household_id uuid,p_listing_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 return (select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'body',body,'revision',revision,'editedAt',edited_at) order by edited_at),'[]'::jsonb) from hs.notes where household_id=p_household_id and listing_id=p_listing_id);
end; $$;
create function public.hs_save_note(p_household_id uuid,p_listing_id uuid,p_body text,p_revision integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare rev integer; begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_body is null or hs.text_length(p_body)>2000 or p_revision is null or p_revision<0 then raise exception 'Invalid note'; end if;
 if p_revision=0 then insert into hs.notes(household_id,listing_id,user_id,bookmark_url,body) select p_household_id,p_listing_id,auth.uid(),coalesce(value->>'sourceUrl',value->'sourceUrls'->>0),p_body from hs.listings where id=p_listing_id and household_id=p_household_id on conflict do nothing returning revision into rev;
 else update hs.notes set body=p_body,revision=revision+1,edited_at=now() where household_id=p_household_id and listing_id=p_listing_id and user_id=auth.uid() and revision=p_revision returning revision into rev; end if;
 if rev is null then raise exception 'Note changed; reload before saving' using errcode='40001'; end if;
 return jsonb_build_object('revision',rev);
end; $$;
create function hs.number_in(o jsonb,k text,lo numeric,hi numeric,whole boolean default false) returns boolean language plpgsql immutable set search_path=pg_catalog as $$ begin
 return coalesce(jsonb_typeof(o->k)='number' and (o->>k)::numeric between lo and hi and (lo<>0 or whole or (o->>k)::numeric>0) and (not whole or trunc((o->>k)::numeric)=(o->>k)::numeric),false);
exception when others then return false; end; $$;
create function hs.valid_criteria(c jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,hs as $$ begin
 return coalesce(jsonb_typeof(c)='object' and (select count(*) from jsonb_object_keys(c))=14 and
 hs.number_in(c,'minAreaM2',0,10000) and (c->'maxAreaM2'='null'::jsonb or hs.number_in(c,'maxAreaM2',(c->>'minAreaM2')::numeric,10000)) and
 hs.number_in(c,'minRooms',0,100) and hs.number_in(c,'preferredPriceSek',0,1000000000,true) and hs.number_in(c,'stretchPriceSek',(c->>'preferredPriceSek')::numeric,1000000000,true) and hs.number_in(c,'feeReferenceSek',0,1000000000,true) and
 jsonb_typeof(c->'propertyTypes')='array' and jsonb_array_length(c->'propertyTypes') between 1 and 2 and c->'propertyTypes'<@'["apartment","house"]'::jsonb and
 jsonb_typeof(c->'excludeGroundFloor')='boolean' and jsonb_typeof(c->'requireLift')='boolean' and jsonb_typeof(c->'requireOutdoor')='boolean' and jsonb_typeof(c->'preferGlazing')='boolean' and
 (select count(*) from jsonb_object_keys(c->'geography'))=3 and (select count(*) from jsonb_object_keys(c->'nature'))=2 and (select count(*) from jsonb_object_keys(c->'transit'))=3 and
 jsonb_typeof(c->'geography'->'municipalities')='array' and jsonb_array_length(c->'geography'->'municipalities') between 1 and 100 and
 not exists(select 1 from jsonb_array_elements(c->'geography'->'municipalities') m where jsonb_typeof(m)<>'string' or hs.text_length(m#>>'{}') not between 1 and 100) and
 jsonb_typeof(c->'geography'->'center')='array' and jsonb_array_length(c->'geography'->'center')=2 and
 jsonb_typeof(c->'geography'->'center'->0)='number' and jsonb_typeof(c->'geography'->'center'->1)='number' and
 (c->'geography'->'center'->>0)::numeric between -180 and 180 and (c->'geography'->'center'->>1)::numeric between -90 and 90 and hs.number_in(c->'geography','radiusKm',0,100) and
 jsonb_typeof(c->'nature'->'preferImmediateGreenery')='boolean' and hs.number_in(c->'nature','preferredWalkMinutes',0,120) and
 hs.number_in(c->'transit','preferredWalkMinutes',0,120) and hs.number_in(c->'transit','preferredJourneyMinutes',0,240) and
 hs.number_in(c->'transit','tradeoffJourneyMinutes',(c->'transit'->>'preferredJourneyMinutes')::numeric,240),false);
exception when others then return false; end; $$;
create function public.hs_save_profile(p_household_id uuid,p_profile_id uuid,p_revision integer,p_name text,p_enabled boolean,p_criteria jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare v hs.profiles; begin
 perform hs.require_member(p_household_id,true);
 if p_name is null or hs.text_length(btrim(p_name)) not between 1 and 80 or p_enabled is null or not hs.valid_criteria(p_criteria) then raise exception 'Invalid profile'; end if;
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id,true);
 -- Preserve the initial revision even when a private bootstrap omitted its history row.
 insert into hs.profile_versions select id,household_id,revision,to_jsonb(p) from hs.profiles p where id=p_profile_id and household_id=p_household_id on conflict do nothing;
 update hs.profiles set name=btrim(p_name),enabled=p_enabled,criteria=p_criteria,revision=revision+1,edited_by=auth.uid(),edited_at=now() where id=p_profile_id and household_id=p_household_id and revision=p_revision returning * into v;
 if v.id is null then raise exception 'Profile changed; reload before saving' using errcode='40001'; end if;
 insert into hs.profile_versions values(v.id,v.household_id,v.revision,to_jsonb(v));
 return jsonb_build_object('revision',v.revision);
end; $$;
create function public.hs_ingest_credential(p_key_id text) returns jsonb language sql stable security definer set search_path=pg_catalog,hs as $$
 select jsonb_build_object('householdId',household_id,'sourceIds',source_ids,'scopes',scopes) from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes);
$$;
create function public.hs_consume_nonce(p_key_id text,p_nonce text,p_timestamp bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 perform 1 from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes) for share;
 if not found or p_timestamp is null or abs(extract(epoch from clock_timestamp())-p_timestamp)>300 then raise exception 'Credential or timestamp invalid' using errcode='42501'; end if;
 insert into hs.ingest_nonces(key_id,nonce) values(p_key_id,p_nonce);
 return jsonb_build_object('ok',true);
end; $$;
create function public.hs_ingest_policies(p_key_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$ declare c hs.ingest_credentials; begin
 select * into c from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes);
 if c.key_id is null then raise exception 'Credential invalid' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(policy order by source_id),'[]'::jsonb) from hs.source_policies where household_id=c.household_id and source_id=any(c.source_ids));
end; $$;
-- Refresh timestamps and evidence identifiers do not create fact revisions.
create function hs.observation_content(o jsonb) returns jsonb language sql immutable set search_path=pg_catalog as $$
 select (o-'observedAt'-'publishedAt'-'coordinates'-'photo'-'evidence') || jsonb_build_object(
 'coordinates',case when jsonb_typeof(o->'coordinates')='object' then (o->'coordinates')-'observedAt' else 'null'::jsonb end,'photo',case when jsonb_typeof(o->'photo')='object' then (o->'photo')-'observedAt'-'expiresAt' else 'null'::jsonb end,
 'evidence',coalesce((select jsonb_agg(e-'id'-'observedAt' order by (e-'id'-'observedAt')::text) from jsonb_array_elements(o->'evidence') e),'[]'::jsonb));
$$;
create function public.hs_ingest(p_key_id text,p_body_hash text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare c hs.ingest_credentials; r hs.runs; b hs.batches; s text; p jsonb; o jsonb; result jsonb; versions jsonb; ids text[]; existing hs.listings; lid uuid; edition_id uuid; obs record; meaningful boolean; success_count integer; batch_count integer;
begin
 if p_body_hash is null or p_body_hash !~ '^[a-f0-9]{64}$' or (p_request->>'contractVersion')::int is distinct from 1 then raise exception 'Invalid ingest envelope'; end if;
 select * into c from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes) for share;
 if c.key_id is null then raise exception 'Credential invalid' using errcode='42501'; end if;
 perform 1 from hs.households where id=c.household_id for update;
 if p_request->>'action'='begin' then
  select array_agg(value order by value) into ids from jsonb_array_elements_text(p_request->'sourceIds');
  if ids is null or cardinality(ids) not between 1 and 20 or not ids<@c.source_ids or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Invalid source set'; end if;
  foreach s in array ids loop
   select policy into p from hs.source_policies where household_id=c.household_id and source_id=s;
   if not hs.policy_current(p) then raise exception 'Source permission absent'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('profileId',id,'revision',revision) order by id) into versions from hs.profiles where household_id=c.household_id and enabled;
  if versions is null or versions is distinct from (select jsonb_agg(v order by v->>'profileId') from jsonb_array_elements(p_request->'profileVersions') v) then raise exception 'Profiles changed or incomplete'; end if;
  insert into hs.profile_versions select id,household_id,revision,to_jsonb(pf) from hs.profiles pf where household_id=c.household_id and enabled on conflict do nothing;
  select * into r from hs.runs where id=(p_request->>'runId')::uuid for update;
  if r.id is not null then
   if r.key_id<>c.key_id or r.household_id<>c.household_id or r.begin_hash<>p_body_hash then raise exception 'Run ID reused with different content'; end if;
   return jsonb_build_object('runId',r.id,'state',r.state);
  end if;
  insert into hs.runs(id,household_id,key_id,profile_versions,source_ids,begin_hash) values((p_request->>'runId')::uuid,c.household_id,c.key_id,versions,ids,p_body_hash) returning * into r;
  return jsonb_build_object('runId',r.id,'state',r.state);
 end if;
 select * into r from hs.runs where id=(p_request->>'runId')::uuid and household_id=c.household_id and key_id=c.key_id for update;
 if r.id is null or not r.source_ids<@c.source_ids then raise exception 'Run unavailable'; end if;
 if p_request->>'action'='stage' then
  select * into b from hs.batches where id=(p_request->>'batchId')::uuid;
  if b.id is not null then
   if b.run_id<>r.id or b.household_id<>c.household_id or b.body_hash<>p_body_hash then raise exception 'Batch ID reused with different content'; end if;
   return jsonb_build_object('runId',r.id,'state',r.state);
  end if;
  if r.state<>'staging' then raise exception 'Run closed'; end if;
  select count(*) into batch_count from hs.batches where run_id=r.id;
  if batch_count>=100 or jsonb_array_length(p_request->'observations')>100 then raise exception 'Run/batch limit exceeded'; end if;
  s:=p_request->>'sourceId'; if not s=any(r.source_ids) then raise exception 'Source not in run'; end if;
  select policy into p from hs.source_policies where household_id=c.household_id and source_id=s;
  if not hs.policy_current(p) then raise exception 'Source permission absent'; end if;
  insert into hs.batches values((p_request->>'batchId')::uuid,r.id,c.household_id,s,p_body_hash);
  for o in select * from jsonb_array_elements(p_request->'observations') loop
   perform hs.assert_observation(p,o);
   if exists(select 1 from hs.staged_observations where run_id=r.id and source_id=s and source_listing_id=o->>'sourceListingId' and episode_id=o->>'episodeId' and observed_at=(o->>'observedAt')::timestamptz and value<>o) then raise exception 'Conflicting same-time observation'; end if;
   insert into hs.staged_observations values(r.id,c.household_id,s,o->>'sourceListingId',o->>'episodeId',(o->>'observedAt')::timestamptz,o) on conflict do nothing;
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
 select jsonb_agg(jsonb_build_object('profileId',id,'revision',revision) order by id) into versions from hs.profiles where household_id=c.household_id and enabled;
 if versions is distinct from r.profile_versions then raise exception 'Profiles changed before publication'; end if;
 success_count:=0;
 for result in select * from jsonb_array_elements(p_request->'results') loop
  s:=result->>'sourceId'; if result->>'status' not in ('success','partial','failed') then raise exception 'Invalid source status'; end if;
  if result->>'status'='failed' then continue; end if;
  select policy into p from hs.source_policies where household_id=c.household_id and source_id=s;
  if not hs.policy_current(p) then raise exception 'Source permission changed'; end if;
  if not exists(select 1 from hs.staged_observations where run_id=r.id and source_id=s) then raise exception 'Empty results lack coverage proof'; end if;
  success_count:=success_count+1;
  for obs in select * from hs.staged_observations where run_id=r.id and source_id=s order by observed_at,source_listing_id,episode_id loop
   o:=obs.value; perform hs.assert_observation(p,o);
   select * into existing from hs.listings where household_id=c.household_id and source_id=s and source_listing_id=obs.source_listing_id and episode_id=obs.episode_id for update;
   if existing.id is null then
    insert into hs.listings(household_id,origin,source_id,source_listing_id,episode_id,value,observed_at) values(c.household_id,'source',s,obs.source_listing_id,obs.episode_id,o,obs.observed_at) returning id into lid;
   else
    lid:=existing.id;
    if exists(select 1 from hs.observations h where h.household_id=c.household_id and h.listing_id=lid and (h.value->>'observedAt')::timestamptz=obs.observed_at and hs.observation_content(h.value) is distinct from hs.observation_content(o)) then raise exception 'Conflicting historical same-time observation'; end if;
    -- Published staging rows also retain unchanged-time fingerprints without creating listing revisions.
    if exists(select 1 from hs.staged_observations prior join hs.runs published on published.id=prior.run_id and published.household_id=prior.household_id
     where published.state='published' and prior.household_id=c.household_id and prior.source_id=s and prior.source_listing_id=obs.source_listing_id and prior.episode_id=obs.episode_id and prior.observed_at=obs.observed_at
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
   insert into hs.observations(household_id,listing_id,run_id,value) values(c.household_id,lid,r.id,o);
  end loop;
  if result->>'status'='success' then update hs.source_policies set cursor=result->>'cursor' where household_id=c.household_id and source_id=s; end if;
 end loop;
 if success_count>0 then
  insert into hs.editions(household_id,run_id,coverage,source_summary) values(c.household_id,r.id,case when not exists(select 1 from jsonb_array_elements(p_request->'results') v join hs.source_policies sp on sp.household_id=c.household_id and sp.source_id=v->>'sourceId' where v->>'status'<>'success' or coalesce(jsonb_array_length(sp.policy->'capabilities'->'coverageGaps'),1)>0 or sp.policy->'capabilities'->'resultCap'<>'null'::jsonb or not coalesce((sp.policy->'capabilities'->>'discovery')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'unknownPrice')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'upcoming')::boolean,false) or not coalesce((sp.policy->'capabilities'->>'pagination')::boolean,false)) then 'complete' else 'partial' end,
   (select case when hs.text_length(summary)>900 then left(summary,440)||' [summary shortened; review run coverage details]' else summary end from (select string_agg((v->>'sourceId')||': '||(v->>'status')||' '||coalesce(v->>'coverageNote','')||case when sp.policy->'capabilities'->'resultCap'<>'null'::jsonb then ' [result cap applies]' else '' end||' gaps: '||coalesce((sp.policy->'capabilities'->'coverageGaps')::text,'unknown'),'; ' order by v->>'sourceId') summary from jsonb_array_elements(p_request->'results') v join hs.source_policies sp on sp.household_id=c.household_id and sp.source_id=v->>'sourceId') summaries)) returning id into edition_id;
 end if;
 update hs.runs set state=case when success_count>0 then 'published' else 'failed' end,publish_hash=p_body_hash,results=p_request->'results' where id=r.id returning * into r;
 return jsonb_build_object('runId',r.id,'state',r.state,'editionId',edition_id);
end; $$;
revoke all on all functions in schema hs from public,anon,authenticated,service_role;
revoke all on function public.hs_memberships(),public.hs_snapshot(uuid),public.hs_set_favorite(uuid,uuid,boolean),public.hs_add_manual(uuid,text,text,text,jsonb),public.hs_notes(uuid,uuid),public.hs_save_note(uuid,uuid,text,integer),public.hs_save_profile(uuid,uuid,integer,text,boolean,jsonb),public.hs_ingest_credential(text),public.hs_consume_nonce(text,text,bigint),public.hs_ingest_policies(text),public.hs_ingest(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.hs_memberships(),public.hs_snapshot(uuid),public.hs_set_favorite(uuid,uuid,boolean),public.hs_add_manual(uuid,text,text,text,jsonb),public.hs_notes(uuid,uuid),public.hs_save_note(uuid,uuid,text,integer),public.hs_save_profile(uuid,uuid,integer,text,boolean,jsonb) to authenticated;
grant execute on function public.hs_ingest_credential(text),public.hs_consume_nonce(text,text,bigint),public.hs_ingest_policies(text),public.hs_ingest(text,text,jsonb) to service_role;

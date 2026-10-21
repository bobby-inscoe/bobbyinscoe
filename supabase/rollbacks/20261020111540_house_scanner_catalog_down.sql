-- Reverses 20261020111540_house_scanner_catalog.sql. Catalog rows, policies, credentials and runs go back to the one
-- household, manual listings return to hs.listings with their ids, and the household-scoped functions, including the
-- purge, are restored as the earlier migrations defined them. Valid only while one household exists: with more, catalog
-- rows have no single owner and this stops. Source policy and credential log rows written without a household get it.
begin;
do $$ begin
 if (select count(*) from hs.households)>1 then raise exception 'Catalog rollback needs exactly one household'; end if;
 if (select count(*) from hs.households)=0 and (exists(select 1 from hs.source_policies) or exists(select 1 from hs.ingest_credentials)) then
  raise exception 'Catalog rollback needs a household to own the catalog'; end if;
end $$;
create temporary table rollback_owner on commit drop as select id from hs.households;

drop trigger manual_listing_times on hs.manual_listings;
drop function hs.admin_set_source_policy(jsonb);
drop function hs.admin_issue_credential(text,text[],timestamptz);
do $$ declare c record; begin
 for c in select conrelid::regclass as tbl,conname from pg_constraint
  where contype='f' and confrelid in ('hs.listings'::regclass,'hs.runs'::regclass,'hs.source_policies'::regclass,'hs.ingest_credentials'::regclass,'hs.manual_listings'::regclass)
 loop execute format('alter table %s drop constraint %I',c.tbl,c.conname); end loop;
end $$;

alter table hs.source_policies add column household_id uuid;
update hs.source_policies set household_id=(select id from rollback_owner);
alter table hs.source_policies alter column household_id set not null, drop constraint source_policies_pkey,
 add primary key(household_id,source_id), add foreign key(household_id) references hs.households(id);
alter table hs.ingest_credentials add column household_id uuid;
update hs.ingest_credentials set household_id=(select id from rollback_owner);
alter table hs.ingest_credentials alter column household_id set not null, add unique(key_id,household_id),
 add foreign key(household_id) references hs.households(id);
alter table hs.runs add column household_id uuid, add column profile_versions jsonb;
update hs.runs set household_id=(select id from rollback_owner),profile_versions='[]'::jsonb;
alter table hs.runs alter column household_id set not null, alter column profile_versions set not null, add unique(id,household_id);
-- The restored hs_ingest inserts into batches and staged observations by position, so both get their old column order back.
create table hs.batches_restore (id uuid primary key, run_id uuid not null, household_id uuid not null, source_id text not null, body_hash text not null check(body_hash ~ '^[a-f0-9]{64}$'));
insert into hs.batches_restore select id,run_id,(select id from rollback_owner),source_id,body_hash from hs.batches;
drop table hs.batches;
alter table hs.batches_restore rename to batches;
alter table hs.batches rename constraint batches_restore_pkey to batches_pkey;
create table hs.staged_observations_restore (
 run_id uuid not null, household_id uuid not null, source_id text not null, source_listing_id text not null, episode_id text not null, observed_at timestamptz not null, value jsonb not null,
 primary key(run_id,source_id,source_listing_id,episode_id,observed_at));
insert into hs.staged_observations_restore select run_id,(select id from rollback_owner),source_id,source_listing_id,episode_id,observed_at,value from hs.staged_observations;
drop table hs.staged_observations;
alter table hs.staged_observations_restore rename to staged_observations;
alter table hs.staged_observations rename constraint staged_observations_restore_pkey to staged_observations_pkey;
alter table hs.batches enable row level security;
alter table hs.staged_observations enable row level security;
revoke all on hs.batches,hs.staged_observations from public,anon,authenticated,service_role;
alter table hs.observations add column household_id uuid;
alter table hs.editions add column household_id uuid;
update hs.observations set household_id=(select id from rollback_owner);
update hs.editions set household_id=(select id from rollback_owner);
alter table hs.observations alter column household_id set not null;
alter table hs.editions alter column household_id set not null;
update hs.admin_log set household_id=(select id from rollback_owner) where household_id is null;
alter table hs.admin_log alter column household_id set not null;

-- Manual rows come back with their times; the listing triggers would reset them on insert.
alter table hs.listings drop constraint listings_source_identity,
 alter column source_id drop not null, alter column source_listing_id drop not null, alter column episode_id drop not null,
 add column household_id uuid, add column origin text, add column added_by uuid, add column canonical_url text;
update hs.listings set household_id=(select id from rollback_owner),origin='source';
alter table hs.listings disable trigger user;
insert into hs.listings(id,household_id,origin,added_by,canonical_url,value,observed_at,last_checked_at,first_seen_at,last_changed_at)
 select id,household_id,'manual',added_by,canonical_url,value,observed_at,last_checked_at,first_seen_at,last_changed_at from hs.manual_listings;
alter table hs.listings enable trigger user;
alter table hs.listings alter column household_id set not null, alter column origin set not null,
 add check(origin in ('source','manual')),
 add unique(id,household_id), add unique(household_id,source_id,source_listing_id,episode_id), add unique(household_id,canonical_url),
 add foreign key(household_id) references hs.households(id),
 add foreign key(household_id,source_id) references hs.source_policies(household_id,source_id),
 add foreign key(household_id,added_by) references hs.members(household_id,user_id),
 add check((origin='source' and source_id is not null and source_listing_id is not null and episode_id is not null and added_by is null) or
       (origin='manual' and source_id is null and source_listing_id is null and episode_id is null and added_by is not null));

drop index hs.favorites_member_listing;
drop index hs.notes_member_listing;
drop index hs.hidden_listings_member_listing;
alter table hs.favorites drop constraint favorites_one_listing;
alter table hs.notes drop constraint notes_one_listing;
alter table hs.hidden_listings drop constraint hidden_listings_one_listing;
update hs.favorites set listing_id=manual_listing_id where manual_listing_id is not null;
update hs.notes set listing_id=manual_listing_id where manual_listing_id is not null;
update hs.hidden_listings set listing_id=manual_listing_id where manual_listing_id is not null;
alter table hs.favorites drop column manual_listing_id, alter column listing_id set not null, add primary key(household_id,listing_id,user_id);
alter table hs.notes drop column manual_listing_id, alter column listing_id set not null, add primary key(household_id,listing_id,user_id);
alter table hs.hidden_listings drop column manual_listing_id, alter column listing_id set not null, add primary key(household_id,listing_id,user_id);
drop table hs.manual_listings;

alter table hs.ingest_nonces add foreign key(key_id) references hs.ingest_credentials(key_id);
alter table hs.runs add foreign key(key_id,household_id) references hs.ingest_credentials(key_id,household_id);
alter table hs.batches add foreign key(run_id,household_id) references hs.runs(id,household_id),
 add foreign key(household_id,source_id) references hs.source_policies(household_id,source_id);
alter table hs.staged_observations add foreign key(run_id,household_id) references hs.runs(id,household_id),
 add foreign key(household_id,source_id) references hs.source_policies(household_id,source_id);
alter table hs.listings add foreign key(first_seen_run_id) references hs.runs(id);
alter table hs.observations add foreign key(listing_id,household_id) references hs.listings(id,household_id),
 add foreign key(run_id,household_id) references hs.runs(id,household_id);
alter table hs.editions add foreign key(run_id,household_id) references hs.runs(id,household_id);
alter table hs.favorites add foreign key(listing_id,household_id) references hs.listings(id,household_id);
alter table hs.notes add foreign key(listing_id,household_id) references hs.listings(id,household_id);
alter table hs.hidden_listings add foreign key(listing_id,household_id) references hs.listings(id,household_id) on delete cascade;
create policy active_household_read on hs.listings for select to authenticated using(hs.is_member(household_id));
create policy active_household_read on hs.observations for select to authenticated using(hs.is_member(household_id));
create policy active_household_read on hs.editions for select to authenticated using(hs.is_member(household_id));

drop function hs.catalog_visible(uuid,uuid);
drop function hs.lock_catalog();
drop function hs.track_manual_times();

-- The definitions below are copied verbatim from the migrations that last defined them before the catalog.
create or replace function hs.listing_interacted(p_household_id uuid,p_listing_id uuid) returns boolean language sql stable set search_path=pg_catalog,hs as $$
 select exists(select 1 from hs.favorites where household_id=p_household_id and listing_id=p_listing_id)
  or exists(select 1 from hs.notes where household_id=p_household_id and listing_id=p_listing_id and body ~ '\S');
$$;

create or replace function hs.snapshot_base(p_household_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'hs'
AS $function$
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
 if jsonb_array_length(visible)>1500 or jsonb_array_length(people)>10 or jsonb_array_length(profiles)>20 or jsonb_array_length(favorites)>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return jsonb_build_object('contractVersion',1,'householdId',p_household_id,'edition',edition,'listings',visible,'members',people,'profiles',profiles,'favorites',favorites);
end; $function$;

create or replace function hs.with_viewings(base jsonb,p_household_id uuid) returns jsonb language sql stable set search_path=pg_catalog,hs as $$
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

create or replace function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; homes jsonb;
begin
 base:=public.hs_snapshot(p_household_id);
 with latest_source_runs as (
  select distinct on (result->>'sourceId') result->>'sourceId' as source_id,r.id
  from hs.editions e join hs.runs r on r.id=e.run_id and r.household_id=e.household_id,
  lateral jsonb_array_elements(r.results) result
  where e.household_id=p_household_id and r.state='published' and result->>'status' in ('success','partial')
  order by result->>'sourceId',e.published_at desc,e.id desc
 )
 select coalesce(jsonb_agg(
  v.item || jsonb_build_object(
   'firstSeenAt',l.first_seen_at,'lastChangedAt',l.last_changed_at,'lastCheckedAt',l.last_checked_at,
   'isNew',coalesce(l.origin='source' and l.first_seen_run_id=latest.id,false)) ||
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
 join hs.listings l on l.id=(v.item->>'id')::uuid and l.household_id=p_household_id
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

create or replace function hs.track_listing_times() returns trigger
language plpgsql set search_path=pg_catalog,hs as $$
begin
 if tg_op='INSERT' then
  new.first_seen_at:=now();
  new.last_changed_at:=now();
  new.first_seen_run_id:=null;
 else
  new.first_seen_at:=old.first_seen_at;
  new.first_seen_run_id:=old.first_seen_run_id;
  -- Ingest already increments revision for meaningful source changes; retention scrubbing does not.
  new.last_changed_at:=case when
   (new.origin='source' and new.revision>old.revision) or
   (new.origin='manual' and hs.observation_content(new.value) is distinct from hs.observation_content(old.value))
   then now() else old.last_changed_at end;
 end if;
 return new;
end;
$$;

create or replace function hs.record_discovery_run() returns trigger
language plpgsql set search_path=pg_catalog,hs as $$
begin
 update hs.listings set first_seen_run_id=new.run_id
 where id=new.listing_id and household_id=new.household_id and origin='source'
 and first_seen_run_id is null and first_seen_at=new.received_at;
 return new;
end;
$$;

create or replace function public.hs_set_favorite(p_household_id uuid,p_listing_id uuid,p_saved boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_saved is null or not exists(select 1 from hs.listings where id=p_listing_id and household_id=p_household_id) then raise exception 'Listing unavailable'; end if;
 if p_saved then insert into hs.favorites(household_id,listing_id,user_id,bookmark_url) select p_household_id,p_listing_id,auth.uid(),coalesce(value->>'sourceUrl',value->'sourceUrls'->>0) from hs.listings where id=p_listing_id and household_id=p_household_id on conflict do nothing;
 else delete from hs.favorites where household_id=p_household_id and listing_id=p_listing_id and user_id=auth.uid(); end if;
 return jsonb_build_object('ok',true);
end; $$;

create or replace function public.hs_add_manual(p_household_id uuid,p_url text,p_title text,p_note text,p_tags jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare lid uuid; begin
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

create or replace function public.hs_notes(p_household_id uuid,p_listing_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 return (select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'body',body,'revision',revision,'editedAt',edited_at) order by edited_at),'[]'::jsonb) from hs.notes where household_id=p_household_id and listing_id=p_listing_id);
end; $$;

create or replace function public.hs_save_note(p_household_id uuid,p_listing_id uuid,p_body text,p_revision integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare rev integer; begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_body is null or hs.text_length(p_body)>2000 or p_revision is null or p_revision<0 then raise exception 'Invalid note'; end if;
 if p_revision=0 then insert into hs.notes(household_id,listing_id,user_id,bookmark_url,body) select p_household_id,p_listing_id,auth.uid(),coalesce(value->>'sourceUrl',value->'sourceUrls'->>0),p_body from hs.listings where id=p_listing_id and household_id=p_household_id on conflict do nothing returning revision into rev;
 else update hs.notes set body=p_body,revision=revision+1,edited_at=now() where household_id=p_household_id and listing_id=p_listing_id and user_id=auth.uid() and revision=p_revision returning revision into rev; end if;
 if rev is null then raise exception 'Note changed; reload before saving' using errcode='40001'; end if;
 return jsonb_build_object('revision',rev);
end; $$;

create or replace function public.hs_set_hidden(p_household_id uuid,p_listing_ids uuid[],p_hidden boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare ids uuid[];
begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_hidden is null or p_listing_ids is null or cardinality(p_listing_ids) not between 1 and 500 or array_position(p_listing_ids,null) is not null then raise exception 'Invalid hide request'; end if;
 select array_agg(distinct x) into ids from unnest(p_listing_ids) x;
 if (select count(*) from hs.listings where household_id=p_household_id and id=any(ids))<>cardinality(ids) then raise exception 'Listing unavailable'; end if;
 if p_hidden then insert into hs.hidden_listings(household_id,listing_id,user_id) select p_household_id,x,auth.uid() from unnest(ids) x on conflict do nothing;
 else delete from hs.hidden_listings where household_id=p_household_id and user_id=auth.uid() and listing_id=any(ids); end if;
 return jsonb_build_object('ok',true);
end; $$;

create or replace function public.hs_ingest_credential(p_key_id text) returns jsonb language sql stable security definer set search_path=pg_catalog,hs as $$
 select jsonb_build_object('householdId',household_id,'sourceIds',source_ids,'scopes',scopes) from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes);
$$;

create or replace function public.hs_ingest_policies(p_key_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$ declare c hs.ingest_credentials; begin
 select * into c from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes);
 if c.key_id is null then raise exception 'Credential invalid' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(policy order by source_id),'[]'::jsonb) from hs.source_policies where household_id=c.household_id and source_id=any(c.source_ids));
end; $$;

create or replace function public.hs_ingest(p_key_id text,p_body_hash text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
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

create or replace function hs.admin_set_source_policy(p_household_id uuid,p_policy jsonb) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
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

create or replace function hs.admin_issue_credential(p_household_id uuid,p_key_id text,p_source_ids text[],p_expires_at timestamptz) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$ begin
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

create or replace function hs.admin_revoke_credential(p_key_id text) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
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

create or replace function hs.purge_expired(p_household_id uuid,p_limit integer,p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare
 dry boolean:=coalesce(p_dry_run,true); budget integer; more_work boolean:=false; n integer; counts jsonb:='{}'::jsonb;
 obs_ids uuid[]; obs_scrub_ids uuid[]; listing_ids uuid[]; scrub_ids uuid[]; source_ids text[];
 staged_ids tid[]; staged_scrub_ids tid[]; nonce_ids tid[]; closed_run_ids uuid[];
begin
 if p_household_id is null or p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid purge request'; end if;
 perform 1 from hs.households where id=p_household_id for update;
 if not found then raise exception 'Household unavailable'; end if;
 budget:=p_limit;

 -- History rows outside retention, with a lapsed policy, or whose listing is no longer live. Not for interacted listings.
 select coalesce(array_agg(id),'{}') into obs_ids from (
  select o.id from hs.observations o
  join hs.listings l on l.id=o.listing_id and l.household_id=o.household_id
  join hs.source_policies p on p.household_id=l.household_id and p.source_id=l.source_id
  where o.household_id=p_household_id and not hs.listing_interacted(l.household_id,l.id)
   and not (hs.source_row_live(p.policy,o.value->>'sourceUrl',(o.value->>'observedAt')::timestamptz) and hs.source_row_live(p.policy,l.value->>'sourceUrl',l.observed_at))
  order by o.id limit budget+1) s;
 if cardinality(obs_ids)>budget then more_work:=true; obs_ids:=obs_ids[1:budget]; end if;
 n:=cardinality(obs_ids); budget:=budget-n;
 if not dry and n>0 then delete from hs.observations where household_id=p_household_id and id=any(obs_ids); end if;
 counts:=counts||jsonb_build_object('observationsDeleted',n);

 -- Staged payloads. A row of a run still staging that would need scrubbing is deleted: scrubbing would publish content the collector never sent.
 -- Publication only requires one staged row per source, so a run that lost any staged row is closed as failed below. Otherwise
 -- it would publish the remaining rows and silently drop the deleted listing.
 select coalesce(array_agg(ctid),'{}') into staged_ids from (
  select s.ctid from hs.staged_observations s
  join hs.runs r on r.id=s.run_id and r.household_id=s.household_id
  join hs.source_policies p on p.household_id=s.household_id and p.source_id=s.source_id
  where s.household_id=p_household_id
   and (not hs.source_row_live(p.policy,s.value->>'sourceUrl',s.observed_at) or (r.state='staging' and hs.scrub_value(s.value,p.policy) is distinct from s.value))
  order by s.ctid limit budget+1) q;
 if cardinality(staged_ids)>budget then more_work:=true; staged_ids:=staged_ids[1:budget]; end if;
 n:=cardinality(staged_ids); budget:=budget-n;
 -- ponytail: staged_observations has no surrogate key, so rows are addressed by ctid. Writers are serialized by the household lock and nothing updates these rows.
 select coalesce(array_agg(distinct s.run_id),'{}') into closed_run_ids from hs.staged_observations s
  join hs.runs r on r.id=s.run_id and r.household_id=s.household_id
  where s.household_id=p_household_id and s.ctid=any(staged_ids) and r.state='staging';
 if not dry and n>0 then delete from hs.staged_observations where household_id=p_household_id and ctid=any(staged_ids); end if;
 if not dry and cardinality(closed_run_ids)>0 then update hs.runs set state='failed' where household_id=p_household_id and id=any(closed_run_ids) and state='staging'; end if;
 counts:=counts||jsonb_build_object('stagedDeleted',n,'runsClosed',cardinality(closed_run_ids));

 -- Expired listings nobody favorited or wrote a note on. Their history was selected above under the same budget, and the budget
 -- is spent on it first, so a listing is only reached once all of its history rows are gone (the foreign key would reject the
 -- delete otherwise). Blank note rows still reference such a listing, so they are deleted with it and are not counted.
 -- A favorite or note committed after this select makes the delete fail on its foreign key and the call rolls back;
 -- a rerun keeps the listing.
 select coalesce(array_agg(id),'{}') into listing_ids from (
  select l.id from hs.listings l
  join hs.source_policies p on p.household_id=l.household_id and p.source_id=l.source_id
  where l.household_id=p_household_id and l.origin='source' and not hs.source_row_live(p.policy,l.value->>'sourceUrl',l.observed_at)
   and not hs.listing_interacted(l.household_id,l.id)
  order by l.id limit budget+1) s;
 if cardinality(listing_ids)>budget then more_work:=true; listing_ids:=listing_ids[1:budget]; end if;
 n:=cardinality(listing_ids); budget:=budget-n;
 if not dry and n>0 then
  delete from hs.notes where household_id=p_household_id and listing_id=any(listing_ids) and body !~ '\S';
  delete from hs.listings where household_id=p_household_id and id=any(listing_ids);
 end if;
 counts:=counts||jsonb_build_object('listingsDeleted',n);

 -- Live listings: scrub nested paths and an invisible previous price. Not for interacted listings.
 select coalesce(array_agg(id),'{}') into scrub_ids from (
  select l.id from hs.listings l
  join hs.source_policies p on p.household_id=l.household_id and p.source_id=l.source_id
  where l.household_id=p_household_id and l.origin='source' and hs.source_row_live(p.policy,l.value->>'sourceUrl',l.observed_at)
   and not hs.listing_interacted(l.household_id,l.id)
   and (hs.scrub_value(l.value,p.policy) is distinct from l.value
    or ((l.previous_asking_price is not null or l.previous_price_observed_at is not null) and not hs.price_history_visible(p.policy,l.value,l.previous_price_observed_at)))
  order by l.id limit budget+1) s;
 if cardinality(scrub_ids)>budget then more_work:=true; scrub_ids:=scrub_ids[1:budget]; end if;
 n:=cardinality(scrub_ids); budget:=budget-n;
 if not dry and n>0 then
  update hs.listings l set value=hs.scrub_value(l.value,p.policy),
   previous_asking_price=case when hs.price_history_visible(p.policy,l.value,l.previous_price_observed_at) then l.previous_asking_price end,
   previous_price_observed_at=case when hs.price_history_visible(p.policy,l.value,l.previous_price_observed_at) then l.previous_price_observed_at end
  from hs.source_policies p where p.household_id=l.household_id and p.source_id=l.source_id and l.household_id=p_household_id and l.id=any(scrub_ids);
 end if;
 counts:=counts||jsonb_build_object('listingsScrubbed',n);

 -- Live history rows: same scrub, again not for interacted listings.
 select coalesce(array_agg(id),'{}') into obs_scrub_ids from (
  select o.id from hs.observations o
  join hs.listings l on l.id=o.listing_id and l.household_id=o.household_id
  join hs.source_policies p on p.household_id=l.household_id and p.source_id=l.source_id
  where o.household_id=p_household_id and not hs.listing_interacted(l.household_id,l.id)
   and hs.source_row_live(p.policy,o.value->>'sourceUrl',(o.value->>'observedAt')::timestamptz) and hs.source_row_live(p.policy,l.value->>'sourceUrl',l.observed_at)
   and hs.scrub_value(o.value,p.policy) is distinct from o.value
  order by o.id limit budget+1) s;
 if cardinality(obs_scrub_ids)>budget then more_work:=true; obs_scrub_ids:=obs_scrub_ids[1:budget]; end if;
 n:=cardinality(obs_scrub_ids); budget:=budget-n;
 if not dry and n>0 then
  update hs.observations o set value=hs.scrub_value(o.value,p.policy)
  from hs.listings l,hs.source_policies p
  where o.household_id=p_household_id and o.id=any(obs_scrub_ids) and l.id=o.listing_id and l.household_id=o.household_id and p.household_id=l.household_id and p.source_id=l.source_id;
 end if;
 counts:=counts||jsonb_build_object('observationsScrubbed',n);

 -- Staged rows of closed runs are scrubbed in place so replay fingerprints stay.
 select coalesce(array_agg(ctid),'{}') into staged_scrub_ids from (
  select s.ctid from hs.staged_observations s
  join hs.runs r on r.id=s.run_id and r.household_id=s.household_id
  join hs.source_policies p on p.household_id=s.household_id and p.source_id=s.source_id
  where s.household_id=p_household_id and r.state<>'staging' and hs.source_row_live(p.policy,s.value->>'sourceUrl',s.observed_at)
   and hs.scrub_value(s.value,p.policy) is distinct from s.value
  order by s.ctid limit budget+1) q;
 if cardinality(staged_scrub_ids)>budget then more_work:=true; staged_scrub_ids:=staged_scrub_ids[1:budget]; end if;
 n:=cardinality(staged_scrub_ids); budget:=budget-n;
 if not dry and n>0 then
  update hs.staged_observations s set value=hs.scrub_value(s.value,p.policy)
  from hs.source_policies p where s.household_id=p_household_id and s.ctid=any(staged_scrub_ids) and p.household_id=s.household_id and p.source_id=s.source_id;
 end if;
 counts:=counts||jsonb_build_object('stagedScrubbed',n);

 select coalesce(array_agg(ctid),'{}') into nonce_ids from (
  select u.ctid from hs.ingest_nonces u join hs.ingest_credentials c on c.key_id=u.key_id
  where c.household_id=p_household_id and u.used_at<now()-hs.nonce_retention()
  order by u.ctid limit budget+1) s;
 if cardinality(nonce_ids)>budget then more_work:=true; nonce_ids:=nonce_ids[1:budget]; end if;
 n:=cardinality(nonce_ids); budget:=budget-n;
 if not dry and n>0 then delete from hs.ingest_nonces where ctid=any(nonce_ids); end if;
 counts:=counts||jsonb_build_object('noncesDeleted',n);

 -- Only lapsed sources lose their cursor; a live source whose content aged out keeps it. Budget is only left here when no
 -- content work was cut off, so the reset runs after the lapsed source's content is gone.
 select coalesce(array_agg(source_id),'{}') into source_ids from (
  select sp.source_id from hs.source_policies sp where sp.household_id=p_household_id and sp.cursor is not null and not hs.policy_live(sp.policy)
  order by sp.source_id limit budget+1) s;
 if cardinality(source_ids)>budget then more_work:=true; source_ids:=source_ids[1:budget]; end if;
 n:=cardinality(source_ids);
 if not dry and n>0 then update hs.source_policies set cursor=null where household_id=p_household_id and source_id=any(source_ids); end if;
 counts:=counts||jsonb_build_object('cursorsReset',n);

 return counts||jsonb_build_object('more',more_work);
end; $$;

create or replace function public.hs_purge_expired(p_household_id uuid,p_limit integer,p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 return hs.purge_expired(p_household_id,p_limit,p_dry_run);
end; $$;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
revoke all on function public.hs_purge_expired(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.hs_purge_expired(uuid,integer,boolean) to service_role;
commit;

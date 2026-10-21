-- Shared listing catalog (specs/house-scanner-shared-catalog.md, slice S1).
-- Source listings, their history, source policies, ingest credentials, runs, batches and editions stop belonging to a
-- household: each broker listing is stored once. Households keep members, profiles, favorites, notes, hides and their
-- manual listings, which move to hs.manual_listings so the catalog holds no private rows. Favorites, notes and hides
-- point at a catalog listing or a manual listing, exactly one. Ingest no longer checks profile revisions.
-- The snapshot output keeps its shape: householdId on a listing is the household that asked. A catalog listing is shown
-- while its source policy is current and it is within retention, or while the household has a favorite or nonblank note
-- on it. Retention stays hide-only, so the household-scoped purge is dropped.
-- Every id is kept. The move needs at most one household owning source data and stops otherwise.
-- Release: the ingest function that accepts both credential shapes first, then this migration, then the collector.

do $$ begin
 if (select count(distinct household_id) from (
  select household_id from hs.listings where origin='source'
  union all select household_id from hs.source_policies
  union all select household_id from hs.ingest_credentials
  union all select household_id from hs.runs) owners)>1
 then raise exception 'Catalog move needs at most one household owning source data'; end if;
end $$;

-- Manual listings keep their ids, so favorites, notes and hides can be repointed in place.
create table hs.manual_listings (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references hs.households(id),
 added_by uuid not null, canonical_url text, value jsonb not null,
 observed_at timestamptz not null default now(), last_checked_at timestamptz not null default now(),
 first_seen_at timestamptz, last_changed_at timestamptz,
 unique(id,household_id), unique(household_id,canonical_url),
 foreign key(household_id,added_by) references hs.members(household_id,user_id)
);
alter table hs.manual_listings enable row level security;
revoke all on hs.manual_listings from public,anon,authenticated,service_role;
create policy active_household_read on hs.manual_listings for select to authenticated using(hs.is_member(household_id));
insert into hs.manual_listings(id,household_id,added_by,canonical_url,value,observed_at,last_checked_at,first_seen_at,last_changed_at)
 select id,household_id,added_by,canonical_url,value,observed_at,last_checked_at,first_seen_at,last_changed_at from hs.listings where origin='manual';

-- Every foreign key into the tables that lose their household column is dropped here and re-added below on the new keys.
do $$ declare c record; begin
 for c in select conrelid::regclass as tbl,conname from pg_constraint
  where contype='f' and confrelid in ('hs.listings'::regclass,'hs.runs'::regclass,'hs.source_policies'::regclass,'hs.ingest_credentials'::regclass)
 loop execute format('alter table %s drop constraint %I',c.tbl,c.conname); end loop;
end $$;

-- Activity rows: one of listing_id (catalog) and manual_listing_id is set, unique per household, member and listing.
alter table hs.favorites drop constraint favorites_pkey;
alter table hs.notes drop constraint notes_pkey;
alter table hs.hidden_listings drop constraint hidden_listings_pkey;
alter table hs.favorites alter column listing_id drop not null, add column manual_listing_id uuid;
alter table hs.notes alter column listing_id drop not null, add column manual_listing_id uuid;
alter table hs.hidden_listings alter column listing_id drop not null, add column manual_listing_id uuid;
update hs.favorites t set manual_listing_id=t.listing_id,listing_id=null from hs.manual_listings m where m.id=t.listing_id;
update hs.notes t set manual_listing_id=t.listing_id,listing_id=null from hs.manual_listings m where m.id=t.listing_id;
update hs.hidden_listings t set manual_listing_id=t.listing_id,listing_id=null from hs.manual_listings m where m.id=t.listing_id;
alter table hs.favorites add constraint favorites_one_listing check(num_nonnulls(listing_id,manual_listing_id)=1);
alter table hs.notes add constraint notes_one_listing check(num_nonnulls(listing_id,manual_listing_id)=1);
alter table hs.hidden_listings add constraint hidden_listings_one_listing check(num_nonnulls(listing_id,manual_listing_id)=1);
create unique index favorites_member_listing on hs.favorites(household_id,user_id,coalesce(listing_id,manual_listing_id));
create unique index notes_member_listing on hs.notes(household_id,user_id,coalesce(listing_id,manual_listing_id));
create unique index hidden_listings_member_listing on hs.hidden_listings(household_id,user_id,coalesce(listing_id,manual_listing_id));

-- The catalog tables lose their household column. Constraints on that column go with it.
drop policy active_household_read on hs.listings;
drop policy active_household_read on hs.observations;
drop policy active_household_read on hs.editions;
delete from hs.listings where origin='manual';
alter table hs.listings drop column household_id, drop column origin, drop column added_by, drop column canonical_url;
alter table hs.listings alter column source_id set not null, alter column source_listing_id set not null, alter column episode_id set not null,
 add constraint listings_source_identity unique(source_id,source_listing_id,episode_id);
alter table hs.source_policies drop column household_id;
alter table hs.source_policies add primary key(source_id);
alter table hs.ingest_credentials drop column household_id;
alter table hs.runs drop column household_id, drop column profile_versions;
alter table hs.batches drop column household_id;
alter table hs.staged_observations drop column household_id;
alter table hs.observations drop column household_id;
alter table hs.editions drop column household_id;
-- Source policy and credential changes are catalog actions without a household.
alter table hs.admin_log alter column household_id drop not null;

alter table hs.ingest_nonces add foreign key(key_id) references hs.ingest_credentials(key_id);
alter table hs.runs add foreign key(key_id) references hs.ingest_credentials(key_id);
alter table hs.batches add foreign key(run_id) references hs.runs(id), add foreign key(source_id) references hs.source_policies(source_id);
alter table hs.staged_observations add foreign key(run_id) references hs.runs(id), add foreign key(source_id) references hs.source_policies(source_id);
alter table hs.listings add foreign key(source_id) references hs.source_policies(source_id), add foreign key(first_seen_run_id) references hs.runs(id);
alter table hs.observations add foreign key(listing_id) references hs.listings(id), add foreign key(run_id) references hs.runs(id);
alter table hs.editions add foreign key(run_id) references hs.runs(id);
alter table hs.favorites add foreign key(listing_id) references hs.listings(id),
 add foreign key(manual_listing_id,household_id) references hs.manual_listings(id,household_id);
alter table hs.notes add foreign key(listing_id) references hs.listings(id),
 add foreign key(manual_listing_id,household_id) references hs.manual_listings(id,household_id);
alter table hs.hidden_listings add foreign key(listing_id) references hs.listings(id) on delete cascade,
 add foreign key(manual_listing_id,household_id) references hs.manual_listings(id,household_id) on delete cascade;

-- Ingest and operator policy or credential changes serialize on one catalog-wide transaction lock.
create function hs.lock_catalog() returns void language sql set search_path=pg_catalog as $$ select pg_advisory_xact_lock(7233001) $$;

create or replace function hs.listing_interacted(p_household_id uuid,p_listing_id uuid) returns boolean language sql stable set search_path=pg_catalog,hs as $$
 select exists(select 1 from hs.favorites where household_id=p_household_id and p_listing_id in (listing_id,manual_listing_id))
  or exists(select 1 from hs.notes where household_id=p_household_id and p_listing_id in (listing_id,manual_listing_id) and body ~ '\S');
$$;

-- The snapshot's visibility rule for one catalog listing and one household.
create function hs.catalog_visible(p_household_id uuid,p_listing_id uuid) returns boolean language sql stable set search_path=pg_catalog,hs as $$
 select exists(select 1 from hs.listings l join hs.source_policies p on p.source_id=l.source_id where l.id=p_listing_id and
  (hs.listing_interacted(p_household_id,l.id) or (hs.policy_current(p.policy) and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl')
   and l.observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int))));
$$;

-- Discovery times: catalog rows change meaningfully when ingest raises the revision, manual rows when their content changes.
create or replace function hs.track_listing_times() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 if tg_op='INSERT' then
  new.first_seen_at:=now();
  new.last_changed_at:=now();
  new.first_seen_run_id:=null;
 else
  new.first_seen_at:=old.first_seen_at;
  new.first_seen_run_id:=old.first_seen_run_id;
  new.last_changed_at:=case when new.revision>old.revision then now() else old.last_changed_at end;
 end if;
 return new;
end; $$;
create function hs.track_manual_times() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 if tg_op='INSERT' then
  new.first_seen_at:=now();
  new.last_changed_at:=now();
 else
  new.first_seen_at:=old.first_seen_at;
  new.last_changed_at:=case when hs.observation_content(new.value) is distinct from hs.observation_content(old.value) then now() else old.last_changed_at end;
 end if;
 return new;
end; $$;
create trigger manual_listing_times before insert or update of value on hs.manual_listings
 for each row execute function hs.track_manual_times();
create or replace function hs.record_discovery_run() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 update hs.listings set first_seen_run_id=new.run_id
 where id=new.listing_id and first_seen_run_id is null and first_seen_at=new.received_at;
 return new;
end; $$;

create or replace function hs.snapshot_base(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare visible jsonb; edition jsonb; people jsonb; profiles jsonb; favorites jsonb;
begin
 perform hs.require_member(p_household_id);
 select jsonb_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition from hs.editions order by published_at desc,id desc limit 1;
 select coalesce(jsonb_agg(item order by observed_at desc,id),'[]'::jsonb) into visible from (
 select l.id,l.observed_at,jsonb_build_object(
 'id',l.id,'householdId',p_household_id,'origin','source','title',l.value->>'title',
 'sourceUrls',jsonb_build_array(l.value->>'sourceUrl'),
 'facts',hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb),
 'conflicts',coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb),
 'coordinates',case when (l.value->'coordinates'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) and (l.value->'coordinates'->>'observedAt')::timestamptz<=now()+interval '5 minutes' then l.value->'coordinates' else 'null'::jsonb end,
 'evidence',coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where p.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl')) and (e->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)),'[]'::jsonb),
 'photo',case when hs.policy_current(p.policy) and coalesce((p.policy->>'imageDisplay')::boolean,false) and coalesce((p.policy->>'imageHotlink')::boolean,false) and p.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') and (l.value->'photo'->>'expiresAt')::timestamptz>now() and (l.value->'photo'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.value->'photo' else 'null'::jsonb end,
 'previousAskingPriceSek',case when p.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') and l.previous_price_observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.previous_asking_price else null end,
 'observedAt',l.observed_at,'addedBy',null,'userTags','[]'::jsonb
 ) item from hs.listings l join hs.source_policies p on p.source_id=l.source_id
 where hs.listing_interacted(p_household_id,l.id) or (hs.policy_current(p.policy) and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl') and l.observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int))
 union all
 select m.id,m.observed_at,jsonb_build_object(
 'id',m.id,'householdId',m.household_id,'origin','manual','title',m.value->>'title','sourceUrls',m.value->'sourceUrls',
 'facts',hs.empty_facts(),'conflicts','[]'::jsonb,'coordinates','null'::jsonb,'evidence','[]'::jsonb,'photo','null'::jsonb,
 'previousAskingPriceSek',null,'observedAt',m.observed_at,'addedBy',m.added_by,'userTags',m.value->'userTags'
 ) from hs.manual_listings m where m.household_id=p_household_id
 ) permitted;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',household_id,'userId',user_id,'displayName',display_name,'role',role) order by user_id),'[]'::jsonb) into people from hs.members where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'householdId',household_id,'revision',revision,'name',name,'enabled',enabled,'criteria',criteria,'editedBy',edited_by,'editedAt',edited_at) order by id),'[]'::jsonb) into profiles from hs.profiles where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',f.household_id,'listingId',coalesce(f.listing_id,f.manual_listing_id),'userId',f.user_id,'savedAt',saved_at) order by saved_at),'[]'::jsonb) into favorites from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id where f.household_id=p_household_id and exists(select 1 from jsonb_array_elements(visible) v where v->>'id'=coalesce(f.listing_id,f.manual_listing_id)::text);
 if jsonb_array_length(visible)>1500 or jsonb_array_length(people)>10 or jsonb_array_length(profiles)>20 or jsonb_array_length(favorites)>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return jsonb_build_object('contractVersion',1,'householdId',p_household_id,'edition',edition,'listings',visible,'members',people,'profiles',profiles,'favorites',favorites);
end; $$;

create or replace function hs.with_viewings(base jsonb,p_household_id uuid) returns jsonb language sql stable set search_path=pg_catalog,hs as $$
 select jsonb_set(base,'{listings}',coalesce((
  select jsonb_agg(case when v.list is null then e.item else e.item||jsonb_build_object('viewings',v.list) end order by e.ord)
  from jsonb_array_elements(base->'listings') with ordinality e(item,ord)
  left join lateral (
   select jsonb_agg(x order by x->>'startsAt') list
   from hs.listings l
   join hs.source_policies p on p.source_id=l.source_id,
   jsonb_array_elements(case when jsonb_typeof(l.value->'viewings')='array' then l.value->'viewings' else '[]'::jsonb end) x
   where l.id=(e.item->>'id')::uuid and p.policy->'viewings'='true'::jsonb and hs.policy_current(p.policy)
    and (x->>'startsAt')::timestamptz>now()
  ) v on true),'[]'::jsonb));
$$;

create or replace function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; ids jsonb; shared jsonb;
begin
 base:=hs.with_viewings(hs.snapshot_base(p_household_id),p_household_id);
 select jsonb_agg(coalesce(h.listing_id,h.manual_listing_id) order by coalesce(h.listing_id,h.manual_listing_id)) into ids from hs.hidden_listings h
  where h.household_id=p_household_id and h.user_id=auth.uid() and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=coalesce(h.listing_id,h.manual_listing_id)::text);
 select jsonb_agg(jsonb_build_object('listingId',coalesce(n.listing_id,n.manual_listing_id),'userId',n.user_id,'body',n.body,'revision',n.revision,'editedAt',n.edited_at) order by coalesce(n.listing_id,n.manual_listing_id),n.user_id) into shared from hs.notes n
  where n.household_id=p_household_id and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=coalesce(n.listing_id,n.manual_listing_id)::text);
 return base||case when ids is null then '{}'::jsonb else jsonb_build_object('hiddenListingIds',ids) end||case when shared is null then '{}'::jsonb else jsonb_build_object('notes',shared) end;
end; $$;

create or replace function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; homes jsonb;
begin
 base:=public.hs_snapshot(p_household_id);
 with latest_source_runs as (
  select distinct on (result->>'sourceId') result->>'sourceId' as source_id,r.id
  from hs.editions e join hs.runs r on r.id=e.run_id,
  lateral jsonb_array_elements(r.results) result
  where r.state='published' and result->>'status' in ('success','partial')
  order by result->>'sourceId',e.published_at desc,e.id desc
 )
 select coalesce(jsonb_agg(
  v.item || jsonb_build_object(
   'firstSeenAt',coalesce(l.first_seen_at,m.first_seen_at),'lastChangedAt',coalesce(l.last_changed_at,m.last_changed_at),
   'lastCheckedAt',coalesce(l.last_checked_at,m.last_checked_at),
   'isNew',coalesce(l.first_seen_run_id=latest.id,false)) ||
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
 left join latest_source_runs latest on latest.source_id=l.source_id
 left join lateral (
  select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'method','polygon','datasetVersion',a.dataset_version) order by position) as areas
  from unnest(l.neighborhood_candidates) with ordinality ids(id,position)
  join hs.neighborhoods a on a.id=ids.id
 ) candidates on true;
 return jsonb_set(base,'{listings}',homes);
end;
$$;

-- Activity writers keep the household lock and the membership recheck after it. A catalog listing can be saved, noted
-- or added while the household can see it; a manual listing only by its household.
create or replace function public.hs_set_favorite(p_household_id uuid,p_listing_id uuid,p_saved boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_saved is null or not (exists(select 1 from hs.manual_listings where id=p_listing_id and household_id=p_household_id)
  or (p_saved and hs.catalog_visible(p_household_id,p_listing_id)) or (not p_saved and exists(select 1 from hs.listings where id=p_listing_id))) then raise exception 'Listing unavailable'; end if;
 if p_saved then
  insert into hs.favorites(household_id,listing_id,manual_listing_id,user_id,bookmark_url)
   select p_household_id,l.id,null,auth.uid(),l.value->>'sourceUrl' from hs.listings l where l.id=p_listing_id
   union all select p_household_id,null,m.id,auth.uid(),m.value->'sourceUrls'->>0 from hs.manual_listings m where m.id=p_listing_id and m.household_id=p_household_id
   on conflict do nothing;
 else delete from hs.favorites where household_id=p_household_id and p_listing_id in (listing_id,manual_listing_id) and user_id=auth.uid(); end if;
 return jsonb_build_object('ok',true);
end; $$;

create or replace function public.hs_add_manual(p_household_id uuid,p_url text,p_title text,p_note text,p_tags jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare lid uuid; begin
 perform hs.require_member(p_household_id);
 if p_url is null or p_title is null or p_note is null or p_tags is null or hs.text_length(p_url)>2048 or not hs.valid_bookmark_url(p_url) or hs.text_length(p_title)>200 or hs.text_length(p_note)>2000 or jsonb_typeof(p_tags)<>'array' or jsonb_array_length(p_tags)>10 or exists(select 1 from jsonb_array_elements(p_tags) tag where jsonb_typeof(tag)<>'string' or hs.text_length(tag#>>'{}') not between 1 and 40) then raise exception 'Invalid bookmark'; end if;
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 select id into lid from (
  select id from hs.manual_listings where household_id=p_household_id and canonical_url=p_url
  union all select l.id from hs.listings l where l.value->>'sourceUrl'=p_url and hs.catalog_visible(p_household_id,l.id)
 ) found order by id limit 1;
 if lid is not null then return jsonb_build_object('listingId',lid,'existing',true); end if;
 insert into hs.manual_listings(household_id,added_by,canonical_url,value) values(p_household_id,auth.uid(),p_url,jsonb_build_object('title',coalesce(nullif(btrim(p_title),''),'Saved listing'),'sourceUrls',jsonb_build_array(p_url),'userTags',p_tags)) returning id into lid;
 if length(btrim(p_note))>0 then insert into hs.notes(household_id,manual_listing_id,user_id,bookmark_url,body) values(p_household_id,lid,auth.uid(),p_url,btrim(p_note)); end if;
 return jsonb_build_object('listingId',lid,'existing',false);
end; $$;

create or replace function public.hs_notes(p_household_id uuid,p_listing_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 return (select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'body',body,'revision',revision,'editedAt',edited_at) order by edited_at),'[]'::jsonb) from hs.notes where household_id=p_household_id and p_listing_id in (listing_id,manual_listing_id));
end; $$;

create or replace function public.hs_save_note(p_household_id uuid,p_listing_id uuid,p_body text,p_revision integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare rev integer; begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_body is null or hs.text_length(p_body)>2000 or p_revision is null or p_revision<0 then raise exception 'Invalid note'; end if;
 if p_revision=0 then
  insert into hs.notes(household_id,listing_id,manual_listing_id,user_id,bookmark_url,body)
   select p_household_id,l.id,null,auth.uid(),l.value->>'sourceUrl',p_body from hs.listings l where l.id=p_listing_id and hs.catalog_visible(p_household_id,l.id)
   union all select p_household_id,null,m.id,auth.uid(),m.value->'sourceUrls'->>0,p_body from hs.manual_listings m where m.id=p_listing_id and m.household_id=p_household_id
   on conflict do nothing returning revision into rev;
 else update hs.notes set body=p_body,revision=revision+1,edited_at=now() where household_id=p_household_id and p_listing_id in (listing_id,manual_listing_id) and user_id=auth.uid() and revision=p_revision returning revision into rev; end if;
 if rev is null then raise exception 'Note changed; reload before saving' using errcode='40001'; end if;
 return jsonb_build_object('revision',rev);
end; $$;

-- Hides stay per member until S3. Every id must be a catalog listing or one of the household's manual listings.
create or replace function public.hs_set_hidden(p_household_id uuid,p_listing_ids uuid[],p_hidden boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare ids uuid[];
begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_hidden is null or p_listing_ids is null or cardinality(p_listing_ids) not between 1 and 500 or array_position(p_listing_ids,null) is not null then raise exception 'Invalid hide request'; end if;
 select array_agg(distinct x) into ids from unnest(p_listing_ids) x;
 if (select count(*) from unnest(ids) x where exists(select 1 from hs.listings where id=x) or exists(select 1 from hs.manual_listings where id=x and household_id=p_household_id))<>cardinality(ids) then raise exception 'Listing unavailable'; end if;
 if p_hidden then
  insert into hs.hidden_listings(household_id,listing_id,manual_listing_id,user_id)
   select p_household_id,case when m.id is null then x end,m.id,auth.uid() from unnest(ids) x left join hs.manual_listings m on m.id=x and m.household_id=p_household_id
   on conflict do nothing;
 else delete from hs.hidden_listings where household_id=p_household_id and user_id=auth.uid() and coalesce(listing_id,manual_listing_id)=any(ids); end if;
 return jsonb_build_object('ok',true);
end; $$;

create or replace function public.hs_ingest_credential(p_key_id text) returns jsonb language sql stable security definer set search_path=pg_catalog,hs as $$
 select jsonb_build_object('sourceIds',source_ids,'scopes',scopes) from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes);
$$;
create or replace function public.hs_ingest_policies(p_key_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$ declare c hs.ingest_credentials; begin
 select * into c from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes);
 if c.key_id is null then raise exception 'Credential invalid' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(policy order by source_id),'[]'::jsonb) from hs.source_policies where source_id=any(c.source_ids));
end; $$;

-- The household version without its household and profile checks. profileVersions in a begin request is ignored.
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

-- Operator functions for sources and credentials lose their household argument and log without one.
drop function hs.admin_set_source_policy(uuid,jsonb);
create function hs.admin_set_source_policy(p_policy jsonb) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
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
end; $$;

drop function hs.admin_issue_credential(uuid,text,text[],timestamptz);
create function hs.admin_issue_credential(p_key_id text,p_source_ids text[],p_expires_at timestamptz) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$ begin
 perform hs.lock_catalog();
 if p_key_id is null or p_key_id !~ '^[a-zA-Z0-9_-]{1,80}$' or p_source_ids is null or array_ndims(p_source_ids) is distinct from 1 or cardinality(p_source_ids) not between 1 and 20 or
  exists(select 1 from unnest(p_source_ids) s where s is null) or cardinality(p_source_ids)<>(select count(distinct s) from unnest(p_source_ids) s) or
  p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '2160 hours' then raise exception 'Invalid credential'; end if;
 if (select count(*) from hs.source_policies where source_id=any(p_source_ids))<>cardinality(p_source_ids) then raise exception 'Unknown source'; end if;
 if exists(select 1 from hs.ingest_credentials where key_id=p_key_id) then raise exception 'Credential key id already used'; end if;
 insert into hs.ingest_credentials(key_id,source_ids,expires_at) values(p_key_id,p_source_ids,p_expires_at);
 insert into hs.admin_log(household_id,action,detail) values(null,'issue_credential',jsonb_build_object('keyId',p_key_id,'sourceIds',to_jsonb(p_source_ids),'expiresAt',p_expires_at));
 return jsonb_build_object('keyId',p_key_id,'sourceIds',to_jsonb(p_source_ids),'expiresAt',p_expires_at);
end; $$;

create or replace function hs.admin_revoke_credential(p_key_id text) returns jsonb language plpgsql set search_path=pg_catalog,hs as $$
declare v_revoked timestamptz;
begin
 perform 1 from hs.ingest_credentials where key_id=p_key_id for update;
 if not found then raise exception 'Credential unavailable'; end if;
 perform hs.lock_catalog();
 update hs.ingest_credentials set revoked_at=now() where key_id=p_key_id and revoked_at is null returning revoked_at into v_revoked;
 if v_revoked is null then raise exception 'Credential already revoked'; end if;
 insert into hs.admin_log(household_id,action,detail) values(null,'revoke_credential',jsonb_build_object('keyId',p_key_id));
 return jsonb_build_object('keyId',p_key_id,'revokedAt',v_revoked);
end; $$;

-- Retention is hide-only now; the household-scoped purge has nothing left to scope by.
drop function public.hs_purge_expired(uuid,integer,boolean);
drop function hs.purge_expired(uuid,integer,boolean);

-- New functions default to PUBLIC execute. Public functions above were replaced in place and keep their grants.
revoke all on all functions in schema hs from public,anon,authenticated,service_role;

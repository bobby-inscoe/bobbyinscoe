-- Bounded retention purge. Read-time redaction in hs_snapshot stays as the second line of defense.
-- The purge removes only what that read path already hides, so snapshots are the same before and after it.
-- A listing with a favorite or a non-blank note (hs.listing_interacted) is kept with its stored content, and so is its
-- history: no class below deletes, scrubs or rewrites it. Once the last favorite and note are removed it is an ordinary
-- expired listing and the next pass deletes it. Manual listings, favorites, non-blank notes, profiles, members,
-- credentials, policies, batches and editions are never written. A blank note row goes only with its listing.
-- The only write to runs closes a staging run that lost a staged row, so it cannot publish a partial batch.

-- How long source content may outlive reviewDueAt before it is purged. Zero purges as soon as the review lapses.
create function hs.lapse_grace() returns interval language sql immutable set search_path=pg_catalog as $$ select interval '0 seconds'; $$;
-- A consumed nonce can only be replayed while its signed timestamp is inside the 300 s window on either side of the
-- server clock, so a nonce stops mattering 600 s after use. One hour keeps a wide margin for clock drift.
create function hs.nonce_retention() returns interval language sql immutable set search_path=pg_catalog as $$ select interval '1 hour'; $$;

create function hs.policy_live(p jsonb) returns boolean language sql stable set search_path=pg_catalog,hs as $$
 select hs.policy_current(case when hs.lapse_grace()=interval '0 seconds' then p
  else jsonb_set(p,'{reviewDueAt}',to_jsonb(((p->>'reviewDueAt')::timestamptz+hs.lapse_grace())::text)) end);
$$;

-- The row-level predicate of the hs_snapshot read path. Purge condition is its negation, with null treated as expired.
create function hs.source_row_live(p jsonb,source_url text,seen_at timestamptz) returns boolean language sql stable set search_path=pg_catalog,hs as $$
 select coalesce(hs.policy_live(p) and p->'listingOrigins' ? hs.origin(source_url) and seen_at>=now()-make_interval(days=>(p->>'retentionDays')::int),false);
$$;

-- The previousAskingPriceSek predicate of the hs_snapshot read path.
create function hs.price_history_visible(p jsonb,v jsonb,prior_at timestamptz) returns boolean language sql stable set search_path=pg_catalog,hs as $$
 select coalesce(p->'allowedFactFields' ? 'askingPriceSek' and not(v->'conflicts' ? 'askingPriceSek') and prior_at>=now()-make_interval(days=>(p->>'retentionDays')::int),false);
$$;

-- Nested paths are scrubbed independently with the same predicates hs_snapshot uses for each path.
-- Conflicts, title, sourceUrl and publishedAt are left alone. A value whose policy is not live is returned unchanged.
create function hs.scrub_value(v jsonb,p jsonb) returns jsonb language plpgsql stable set search_path=pg_catalog,hs as $$
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
end; $$;

-- One bounded pass for one household. p_limit is a shared budget for rows removed or rewritten by this call (1 to 1000).
-- Each class is selected once, so a dry run reports what a real run would do. The household row is locked first, as in hs_ingest.
create function hs.purge_expired(p_household_id uuid,p_limit integer,p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
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

create function public.hs_purge_expired(p_household_id uuid,p_limit integer,p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 return hs.purge_expired(p_household_id,p_limit,p_dry_run);
end; $$;

-- New functions default to PUBLIC execute, so every grant is revoked explicitly before the one intended grant.
revoke all on all functions in schema hs from public,anon,authenticated,service_role;
revoke all on function public.hs_purge_expired(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.hs_purge_expired(uuid,integer,boolean) to service_role;

-- Household rows (spec: house-scanner-data-foundation, S3).
-- The snapshot decides which catalog homes a household sees by testing every catalog listing against the household's
-- profiles, favorites, notes and hides on every request. hs.household_listings records, per household, the catalog
-- homes it could see and why: an enabled profile's hard rules pass on an allowed origin (`matches`), a member saved it
-- or noted it with text (`touched`), or a member hid it (`hidden`). A row exists only while one of these holds. The rows
-- change when a card, profile, favorite, note or hide does, so finding a household's homes costs in proportion to its
-- rows. Nothing reads them yet.
-- The clock still decides at read time, in hs.visible_listings: a touched home always shows; otherwise its source
-- policy must be current and the listing within retention, and it shows when hidden, or when it matches and is not
-- delisted. Rows of homes past retention that nobody saved, noted or hid are removed when their source publishes.

create table hs.household_listings (
 household_id uuid not null references hs.households(id) on delete cascade,
 listing_id uuid not null references hs.listings(id) on delete cascade,
 matches boolean not null default false,
 touched boolean not null default false,
 hidden boolean not null default false,
 changed_seq bigint not null default nextval('hs.change_seq'),
 primary key (household_id,listing_id)
);
create index household_listings_listing on hs.household_listings(listing_id);
alter table hs.household_listings enable row level security;
revoke all on hs.household_listings from public,anon,authenticated,service_role;

-- Sets `matches` for the given households and cards, null meaning all, and removes rows left with no reason.
create function hs.refresh_household_matches(p_households uuid[],p_listings uuid[]) returns void language plpgsql
set search_path=pg_catalog,hs as $$
begin
 with target as materialized (
  select h.id household_id,c.listing_id,
   c.listed and exists(select 1 from hs.profiles r where r.household_id=h.id and r.enabled
    and not hs.fails_hard_rule(c.facts,c.conflicts,r.criteria,c.source_id)) matches
  from hs.households h cross join hs.listing_cards c
  where (p_households is null or h.id=any(p_households)) and (p_listings is null or c.listing_id=any(p_listings))),
 matched as (
  insert into hs.household_listings(household_id,listing_id,matches) select household_id,listing_id,true from target where matches
  on conflict (household_id,listing_id) do update set matches=true,changed_seq=nextval('hs.change_seq') where not household_listings.matches)
 update hs.household_listings h set matches=false,changed_seq=nextval('hs.change_seq') from target t
 where t.household_id=h.household_id and t.listing_id=h.listing_id and not t.matches and h.matches;
 delete from hs.household_listings h
 where (p_households is null or h.household_id=any(p_households)) and (p_listings is null or h.listing_id=any(p_listings))
  and not (h.matches or h.touched or h.hidden);
end; $$;

-- Sets `touched` and `hidden` for one household and catalog listing from its favorites, notes and hides.
create function hs.refresh_household_marks(p_household uuid,p_listing uuid) returns void language plpgsql
set search_path=pg_catalog,hs as $$
declare is_touched boolean; is_hidden boolean;
begin
 is_touched:=exists(select 1 from hs.favorites where household_id=p_household and listing_id=p_listing)
  or exists(select 1 from hs.notes where household_id=p_household and listing_id=p_listing and body ~ '\S');
 is_hidden:=exists(select 1 from hs.hidden_listings where household_id=p_household and listing_id=p_listing);
 if is_touched or is_hidden then
  -- A new row learns `matches` too: the row may have been removed while the home was past retention.
  insert into hs.household_listings(household_id,listing_id,matches,touched,hidden)
  values(p_household,p_listing,coalesce((select c.listed and exists(select 1 from hs.profiles r where r.household_id=p_household and r.enabled
    and not hs.fails_hard_rule(c.facts,c.conflicts,r.criteria,c.source_id)) from hs.listing_cards c where c.listing_id=p_listing),false),
   is_touched,is_hidden)
  on conflict (household_id,listing_id) do update set touched=excluded.touched,hidden=excluded.hidden,changed_seq=nextval('hs.change_seq')
  where (household_listings.touched,household_listings.hidden) is distinct from (excluded.touched,excluded.hidden);
 else
  update hs.household_listings set touched=false,hidden=false,changed_seq=nextval('hs.change_seq')
  where household_id=p_household and listing_id=p_listing and (touched or hidden);
  delete from hs.household_listings where household_id=p_household and listing_id=p_listing and not matches;
 end if;
end; $$;

-- The catalog homes a household sees now. The one definition of visibility for the read model; it equals the source
-- homes of today's snapshot. A SQL-standard body, so the planner can inline it into a caller.
create function hs.visible_listings(p_household_id uuid) returns table(listing_id uuid) language sql stable
begin atomic
 select h.listing_id from hs.household_listings h join hs.listing_cards c on c.listing_id=h.listing_id
  join hs.source_policies p on p.source_id=c.source_id
 where h.household_id=p_household_id and (h.touched or (hs.policy_current(p.policy) and c.listed and c.observed_at>=now()-c.retention
  and (h.hidden or (h.matches and c.delisted_at is null))));
end;

-- Rows that differ from a fresh computation over every household and card, ignoring rows of homes past retention that
-- nobody saved, noted or hid, which wait for their source's next publish. Empty when the triggers kept up. Read-only.
create function hs.household_drift() returns table(household_id uuid,listing_id uuid) language sql stable
set search_path=pg_catalog,hs as $$
 with fresh as (
  select h.id household_id,c.listing_id,
   c.listed and exists(select 1 from hs.profiles r where r.household_id=h.id and r.enabled
    and not hs.fails_hard_rule(c.facts,c.conflicts,r.criteria,c.source_id)) matches,
   exists(select 1 from hs.favorites f where f.household_id=h.id and f.listing_id=c.listing_id)
    or exists(select 1 from hs.notes n where n.household_id=h.id and n.listing_id=c.listing_id and n.body ~ '\S') touched,
   exists(select 1 from hs.hidden_listings x where x.household_id=h.id and x.listing_id=c.listing_id) hidden,
   c.observed_at<now()-c.retention expired
  from hs.households h cross join hs.listing_cards c),
 wanted as (select household_id,listing_id,matches,touched,hidden from fresh where touched or hidden or (matches and not expired)),
 stored as (select h.household_id,h.listing_id,h.matches,h.touched,h.hidden from hs.household_listings h
  join hs.listing_cards c on c.listing_id=h.listing_id where h.touched or h.hidden or (h.matches and not c.observed_at<now()-c.retention))
 select coalesce(w.household_id,s.household_id),coalesce(w.listing_id,s.listing_id) from wanted w
 full join stored s on s.household_id=w.household_id and s.listing_id=w.listing_id
 where w.listing_id is null or s.listing_id is null or (w.matches,w.touched,w.hidden) is distinct from (s.matches,s.touched,s.hidden)
$$;

-- A changed card can change `matches` for every household; one refresh per statement over the cards it wrote.
create function hs.card_households_follow() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 perform hs.refresh_household_matches(null,array(select listing_id from written));
 return null;
end; $$;
create trigger card_households_insert after insert on hs.listing_cards referencing new table as written
 for each statement execute function hs.card_households_follow();
create trigger card_households_update after update on hs.listing_cards referencing new table as written
 for each statement execute function hs.card_households_follow();

-- A profile's rules or switch decide `matches` for its household's whole catalog.
create function hs.profile_households_follow() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 perform hs.refresh_household_matches(array(select distinct x from unnest(array[
  case when tg_op<>'INSERT' then old.household_id end,case when tg_op<>'DELETE' then new.household_id end]) x where x is not null),null);
 return null;
end; $$;
create trigger profile_households after insert or delete or update of criteria,enabled,household_id on hs.profiles
 for each row execute function hs.profile_households_follow();

-- Favorites, notes and hides of catalog listings set `touched` and `hidden`. Manual listings have no rows here.
create function hs.household_marks_follow() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 if tg_op<>'INSERT' and old.listing_id is not null then perform hs.refresh_household_marks(old.household_id,old.listing_id); end if;
 if tg_op<>'DELETE' and new.listing_id is not null then perform hs.refresh_household_marks(new.household_id,new.listing_id); end if;
 return null;
end; $$;
create trigger favorite_households after insert or update or delete on hs.favorites
 for each row execute function hs.household_marks_follow();
create trigger note_households after insert or update or delete on hs.notes
 for each row execute function hs.household_marks_follow();
create trigger hide_households after insert or update or delete on hs.hidden_listings
 for each row execute function hs.household_marks_follow();

-- A publish removes the rows its sources no longer need: homes past retention that nobody saved, noted or hid.
create function hs.expire_household_listings() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 delete from hs.household_listings h using hs.listing_cards c
 where c.listing_id=h.listing_id and not h.touched and not h.hidden and c.observed_at<now()-c.retention
  and c.source_id in (select r->>'sourceId' from jsonb_array_elements(new.results) r where r->>'status' in ('success','partial'));
 return new;
end; $$;
create trigger expire_household_listings after update of state on hs.runs
 for each row when (old.state='staging' and new.state='published') execute function hs.expire_household_listings();

revoke all on function hs.refresh_household_matches(uuid[],uuid[]),hs.refresh_household_marks(uuid,uuid),hs.visible_listings(uuid),
 hs.household_drift(),hs.card_households_follow(),hs.profile_households_follow(),hs.household_marks_follow(),hs.expire_household_listings()
 from public,anon,authenticated,service_role;

select hs.refresh_household_matches(null,null);
select hs.refresh_household_marks(household_id,listing_id) from (
 select household_id,listing_id from hs.favorites where listing_id is not null
 union select household_id,listing_id from hs.notes where listing_id is not null
 union select household_id,listing_id from hs.hidden_listings where listing_id is not null) marked;

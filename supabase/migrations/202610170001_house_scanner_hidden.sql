-- Personal hide: one row per member per listing, written only by that member and returned only to them.
-- A hidden row never pins a listing (hs.listing_interacted ignores it), so the retention purge still deletes the
-- listing; the cascade below removes the hidden rows with it. Migration 0002 is already applied, so the purge is untouched.
-- The estimated coordinate flag needs no SQL: coordinates are jsonb inside the listing value and every read and
-- scrub path passes their keys through. The ingest function validates the key against the contract.
create table hs.hidden_listings (
 household_id uuid not null, listing_id uuid not null, user_id uuid not null, hidden_at timestamptz not null default now(),
 primary key(household_id,listing_id,user_id),
 foreign key(listing_id,household_id) references hs.listings(id,household_id) on delete cascade,
 foreign key(household_id,user_id) references hs.members(household_id,user_id)
);
alter table hs.hidden_listings enable row level security;
revoke all on hs.hidden_listings from public,anon,authenticated,service_role;
-- Unlike favorites, a member's hides are not shared with the household.
create policy own_read on hs.hidden_listings for select to authenticated using(hs.is_member(household_id) and user_id=auth.uid());

-- The existing snapshot keeps its body under a private name, so this migration does not copy it.
alter function public.hs_snapshot(uuid) set schema hs;
alter function hs.hs_snapshot(uuid) rename to snapshot_base;
-- hiddenListingIds is left out when empty: the shipped app validates the snapshot with a strict schema, and nobody can
-- hide a home before the new app does, so the old app keeps parsing until it is replaced. Ids are limited to listings the
-- snapshot shows, as favorites are, and sorted so an unchanged refresh compares equal.
create function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; ids jsonb;
begin
 base:=hs.snapshot_base(p_household_id);
 select jsonb_agg(h.listing_id order by h.listing_id) into ids from hs.hidden_listings h
  where h.household_id=p_household_id and h.user_id=auth.uid() and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=h.listing_id::text);
 return case when ids is null then base else base||jsonb_build_object('hiddenListingIds',ids) end;
end; $$;

-- Takes the household lock first and re-checks membership after it, as hs_set_favorite does. An array lets the one-time
-- move of a browser's old hidden list happen in one call; a single hide sends one id. Every id must be a listing of the household.
create function public.hs_set_hidden(p_household_id uuid,p_listing_ids uuid[],p_hidden boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
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

-- New functions default to PUBLIC execute, and the moved function kept its old grant, so revoke everything first.
revoke all on all functions in schema hs from public,anon,authenticated,service_role;
revoke all on function public.hs_snapshot(uuid),public.hs_set_hidden(uuid,uuid[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.hs_snapshot(uuid),public.hs_set_hidden(uuid,uuid[],boolean) to authenticated;

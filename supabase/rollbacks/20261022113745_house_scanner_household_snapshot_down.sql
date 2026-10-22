-- Reverses 20261022113745_house_scanner_household_snapshot.sql. hs.visible_listings comes back as
-- 20261022105133_house_scanner_household_listings.sql defined it. A client on v2 falls back to hs_snapshot_neighborhoods
-- when the snapshot function is missing; bulk favorites have no fallback, so roll back the client first.
begin;
drop function public.hs_set_favorites(uuid,uuid[],boolean), public.hs_household_snapshot(uuid);
create or replace function hs.visible_listings(p_household_id uuid) returns table(listing_id uuid) language sql stable
begin atomic
 select h.listing_id from hs.household_listings h join hs.listing_cards c on c.listing_id=h.listing_id
  join hs.source_policies p on p.source_id=c.source_id
 where h.household_id=p_household_id and (h.touched or (hs.policy_current(p.policy) and c.listed and c.observed_at>=now()-c.retention
  and (h.hidden or (h.matches and c.delisted_at is null))));
end;
revoke all on function hs.visible_listings(uuid) from public,anon,authenticated,service_role;
commit;

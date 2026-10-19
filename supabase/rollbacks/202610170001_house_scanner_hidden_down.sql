-- Reverses 202610170001_house_scanner_hidden.sql. Run it in one transaction, as postgres, with the app and function
-- reverted or about to be. It deletes every member's hidden homes (that is the whole data loss) and puts the original
-- snapshot function back under its old name, schema and grant. Listings, favorites and notes are not touched.
begin;
drop function public.hs_snapshot(uuid);
drop function public.hs_set_hidden(uuid,uuid[],boolean);
alter function hs.snapshot_base(uuid) rename to hs_snapshot;
alter function hs.hs_snapshot(uuid) set schema public;
revoke all on function public.hs_snapshot(uuid) from public,anon,authenticated,service_role;
grant execute on function public.hs_snapshot(uuid) to authenticated;
drop table hs.hidden_listings;
commit;

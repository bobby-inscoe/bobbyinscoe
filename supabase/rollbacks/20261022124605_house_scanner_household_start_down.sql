-- Reverses 20261022124605_house_scanner_household_start.sql. The client falls back to hs_memberships and
-- hs_household_snapshot when the start function is missing, so the client can stay.
begin;
drop function public.hs_household_start(uuid);
commit;

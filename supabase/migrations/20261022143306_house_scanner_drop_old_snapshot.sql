-- Drop the old household read path (spec: house-scanner-v2-client, S2). The app reads the household only through
-- hs_household_start and hs_household_snapshot (contract version 2). The version 1 snapshot, its neighborhood wrapper and
-- the per-listing notes request have no caller left; hs_memberships stays.
drop function public.hs_snapshot_neighborhoods(uuid);
drop function public.hs_snapshot(uuid);
drop function public.hs_notes(uuid,uuid);
drop function hs.with_viewings(jsonb,uuid);
drop function hs.snapshot_base(uuid);

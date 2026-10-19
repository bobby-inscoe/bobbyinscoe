-- Revert the application first; it also falls back when this endpoint is absent.
-- Preserve the assignments and public reference data so rollback loses no records.
drop function if exists public.hs_snapshot_neighborhoods(uuid);
drop trigger if exists listing_neighborhood on hs.listings;
drop function if exists hs.assign_neighborhood();
drop function if exists hs.neighborhood_for_coordinates(jsonb);

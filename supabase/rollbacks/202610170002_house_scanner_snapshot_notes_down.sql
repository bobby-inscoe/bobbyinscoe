-- Reverses 202610170002_house_scanner_snapshot_notes.sql: the snapshot stops carrying notes and goes back to the
-- definition migration 202610170001 gave it. No data changes; notes are still read with hs_notes. Run it in one
-- transaction, as postgres. The function keeps its grants because it is replaced in place.
begin;
create or replace function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; ids jsonb;
begin
 base:=hs.snapshot_base(p_household_id);
 select jsonb_agg(h.listing_id order by h.listing_id) into ids from hs.hidden_listings h
  where h.household_id=p_household_id and h.user_id=auth.uid() and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=h.listing_id::text);
 return case when ids is null then base else base||jsonb_build_object('hiddenListingIds',ids) end;
end; $$;
commit;

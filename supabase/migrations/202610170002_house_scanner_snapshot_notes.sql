-- Notes join the snapshot, so opening a listing's details needs no request. Every active member could already read
-- every member's notes through hs_notes, so this exposes nothing new; it moves the read into the one call the app
-- already makes. Rows are limited to listings the snapshot shows. A blank note stays, because the owner of an emptied
-- note must name its revision to save over it. The key is left out when there are no notes, so an app built before it
-- (strict snapshot schema) keeps parsing until someone writes a note: apply this before the app that reads the field ships.
-- Ten members on 500 listings caps the rows at 5000, which the contract allows.
create or replace function public.hs_snapshot(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; ids jsonb; shared jsonb;
begin
 base:=hs.snapshot_base(p_household_id);
 select jsonb_agg(h.listing_id order by h.listing_id) into ids from hs.hidden_listings h
  where h.household_id=p_household_id and h.user_id=auth.uid() and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=h.listing_id::text);
 select jsonb_agg(jsonb_build_object('listingId',n.listing_id,'userId',n.user_id,'body',n.body,'revision',n.revision,'editedAt',n.edited_at) order by n.listing_id,n.user_id) into shared from hs.notes n
  where n.household_id=p_household_id and exists(select 1 from jsonb_array_elements(base->'listings') v where v->>'id'=n.listing_id::text);
 return base||case when ids is null then '{}'::jsonb else jsonb_build_object('hiddenListingIds',ids) end||case when shared is null then '{}'::jsonb else jsonb_build_object('notes',shared) end;
end; $$;

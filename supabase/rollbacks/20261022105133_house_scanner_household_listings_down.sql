-- Reverses 20261022105133_house_scanner_household_listings.sql. Nothing reads the rows, so dropping them changes no
-- response.
begin;
drop trigger card_households_insert on hs.listing_cards;
drop trigger card_households_update on hs.listing_cards;
drop trigger profile_households on hs.profiles;
drop trigger favorite_households on hs.favorites;
drop trigger note_households on hs.notes;
drop trigger hide_households on hs.hidden_listings;
drop trigger expire_household_listings on hs.runs;
drop function hs.card_households_follow(), hs.profile_households_follow(), hs.household_marks_follow(), hs.expire_household_listings(),
 hs.household_drift(), hs.visible_listings(uuid), hs.refresh_household_marks(uuid,uuid), hs.refresh_household_matches(uuid[],uuid[]);
drop table hs.household_listings;
commit;

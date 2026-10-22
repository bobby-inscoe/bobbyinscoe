-- Reverses 20261022103309_house_scanner_listing_cards.sql. Nothing reads the cards, so dropping them changes no response.
begin;
drop trigger listing_cards_insert on hs.listings;
drop trigger listing_cards_update on hs.listings;
drop trigger policy_cards on hs.source_policies;
drop function hs.listing_cards_follow(), hs.policy_cards_follow(), hs.card_drift(), hs.refresh_cards(uuid[]), hs.card_rows(uuid[]);
drop table hs.listing_cards;
drop sequence hs.change_seq;
commit;

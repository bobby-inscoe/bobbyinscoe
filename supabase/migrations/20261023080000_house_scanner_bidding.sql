-- Bidding flag (spec: house-scanner-bidding-flag, S1).
-- Facts gain `bidding`: true when the source says bidding is under way, otherwise null (unknown). The empty default is
-- null, so the household snapshot, which sends only facts that differ from it, is unchanged for every home that is not
-- bidding. A source may send it only once its policy allows the field.

create or replace function hs.empty_facts() returns jsonb language sql immutable set search_path=pg_catalog as $$
 select '{"propertyType":null,"tenure":"unknown","purchase":null,"livingAreaM2":null,"secondaryAreaM2":null,"rooms":null,"askingPriceSek":null,"groundFloor":null,"lift":null,"liftServesHome":null,"stepFree":null,"outdoor":null,"glazed":null,"largePrivateTerrace":null,"municipality":null,"baseFeeSek":null,"mandatoryMonthlySek":null,"status":"unknown","bidding":null}'::jsonb;
$$;

select hs.refresh_cards(null);

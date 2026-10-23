-- Highest bid (spec: house-scanner-bidding-flag).
-- Facts gain `highestBidSek`: the highest bid a broker publishes, as of the observation, and null otherwise. The
-- empty default is null, so the household snapshot is unchanged for every home without a published bid. A source may
-- send it only once its policy allows the field.

create or replace function hs.empty_facts() returns jsonb language sql immutable set search_path=pg_catalog as $$
 select '{"propertyType":null,"tenure":"unknown","purchase":null,"livingAreaM2":null,"secondaryAreaM2":null,"rooms":null,"askingPriceSek":null,"groundFloor":null,"lift":null,"liftServesHome":null,"stepFree":null,"outdoor":null,"glazed":null,"largePrivateTerrace":null,"municipality":null,"baseFeeSek":null,"mandatoryMonthlySek":null,"status":"unknown","bidding":null,"highestBidSek":null}'::jsonb;
$$;

select hs.refresh_cards(null);

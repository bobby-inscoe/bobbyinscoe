-- Rolls back 20261023090000_house_scanner_highest_bid: restores the empty facts with bidding only and rewrites the
-- cards. Policies that allow highestBidSek must be restored first, since a policy may only name known facts.

create or replace function hs.empty_facts() returns jsonb language sql immutable set search_path=pg_catalog as $$
 select '{"propertyType":null,"tenure":"unknown","purchase":null,"livingAreaM2":null,"secondaryAreaM2":null,"rooms":null,"askingPriceSek":null,"groundFloor":null,"lift":null,"liftServesHome":null,"stepFree":null,"outdoor":null,"glazed":null,"largePrivateTerrace":null,"municipality":null,"baseFeeSek":null,"mandatoryMonthlySek":null,"status":"unknown","bidding":null}'::jsonb;
$$;

select hs.refresh_cards(null);

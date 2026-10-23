-- Rolls back 20261023080000_house_scanner_bidding: restores the earlier empty facts and rewrites the cards. Stored
-- observations keep any bidding fact; policies that allow it must be restored first, since a policy may only name
-- known facts.

create or replace function hs.empty_facts() returns jsonb language sql immutable set search_path=pg_catalog as $$
 select '{"propertyType":null,"tenure":"unknown","purchase":null,"livingAreaM2":null,"secondaryAreaM2":null,"rooms":null,"askingPriceSek":null,"groundFloor":null,"lift":null,"liftServesHome":null,"stepFree":null,"outdoor":null,"glazed":null,"largePrivateTerrace":null,"municipality":null,"baseFeeSek":null,"mandatoryMonthlySek":null,"status":"unknown"}'::jsonb;
$$;

select hs.refresh_cards(null);

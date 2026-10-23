-- Rolls back 20261023200001_house_scanner_price_models: drops the stored models, their trigger and the check.

drop trigger store_price_models on hs.runs;
drop function hs.store_price_models();
drop table hs.price_models;
drop function hs.valid_price_model(jsonb);

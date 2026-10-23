-- Price models (spec: house-scanner-price-estimates, S2).
-- A publish result may carry priceModel: an asking-price model for apartments that the collector fitted from sold
-- homes it pooled across sources. It is numbers only: coefficients, the typical fee, the residual spread, and a level
-- per district with how many homes it comes from (at least 5). Ingest checks the shape; when the run publishes, each
-- valid model is kept here for the estimate step to read. A model that fails the check is left out rather than
-- failing the publish, so listings still land. Models older than 90 days are removed when a new one arrives.

create function hs.valid_price_model(m jsonb) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(m)='object'
  and m ?& array['version','fittedAt','homes','period','intercept','logArea','feePerM2','rooms','typicalFeePerM2','residualSd','levels']
  and (select count(*) from jsonb_object_keys(m))=11
  and m->'version'='1'::jsonb and jsonb_typeof(m->'homes')='number' and (m->>'homes')::numeric>=1
  and m->>'period' ~ '^\d{4}H[12]$'
  and jsonb_typeof(m->'intercept')='number' and jsonb_typeof(m->'logArea')='number' and jsonb_typeof(m->'feePerM2')='number'
  and jsonb_typeof(m->'rooms')='number' and jsonb_typeof(m->'typicalFeePerM2')='number' and jsonb_typeof(m->'residualSd')='number'
  and jsonb_typeof(m->'levels')='object' and (select count(*) from jsonb_object_keys(m->'levels'))<=300
  and not exists(select 1 from jsonb_each(m->'levels') l where case when jsonb_typeof(l.value)<>'object' then true
   else not (l.value ?& array['level','homes']) or (select count(*) from jsonb_object_keys(l.value))<>2
    or jsonb_typeof(l.value->'level')<>'number' or jsonb_typeof(l.value->'homes')<>'number' or (l.value->>'homes')::numeric<5 end),false);
$$;

create table hs.price_models (
 id bigint generated always as identity primary key,
 run_id uuid not null references hs.runs(id) on delete cascade,
 source_id text not null,
 fitted_at timestamptz not null,
 homes integer not null check(homes>0),
 model jsonb not null check(hs.valid_price_model(model)),
 created_at timestamptz not null default now()
);
create index price_models_fitted on hs.price_models(fitted_at desc);
alter table hs.price_models enable row level security;
revoke all on hs.price_models from public,anon,authenticated,service_role;

create function hs.store_price_models() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 insert into hs.price_models(run_id,source_id,fitted_at,homes,model)
 select new.id,result->>'sourceId',(result->'priceModel'->>'fittedAt')::timestamptz,(result->'priceModel'->>'homes')::integer,result->'priceModel'
 from jsonb_array_elements(new.results) result
 where result->>'status' in ('success','partial') and hs.valid_price_model(result->'priceModel');
 if found then delete from hs.price_models where fitted_at<now()-interval '90 days'; end if;
 return new;
end; $$;
revoke all on function hs.store_price_models() from public,anon,authenticated,service_role;
create trigger store_price_models after update of state on hs.runs
 for each row when (old.state='staging' and new.state='published') execute function hs.store_price_models();

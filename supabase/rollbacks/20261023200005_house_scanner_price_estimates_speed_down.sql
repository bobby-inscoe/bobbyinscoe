-- Rolls back 20261023200005_house_scanner_price_estimates_speed: restores the refresh without materialized steps.

create or replace function hs.refresh_price_estimates() returns void language plpgsql set search_path=pg_catalog,hs as $$
declare model_id bigint; model jsonb;
begin
 select id,p.model into model_id,model from hs.price_models p where fitted_at>now()-interval '30 days' order by fitted_at desc,id desc limit 1;
 delete from hs.listing_estimates where true;
 if model_id is null then return; end if;
 insert into hs.listing_estimates(listing_id,model_id,low_sek,high_sek,final_sek,nearby,farthest_m,level_used)
 with homes as materialized (
  select c.listing_id,(c.facts->>'livingAreaM2')::numeric area,
   nullif(coalesce(c.facts->>'baseFeeSek',c.facts->>'mandatoryMonthlySek')::numeric,0) fee,
   (c.facts->>'rooms')::numeric rooms,
   case when not c.conflicts ? 'askingPriceSek' then (c.facts->>'askingPriceSek')::numeric end price,
   c.facts->>'askingPriceSek' is null unpriced,
   (c.coordinates->>'latitude')::float8 lat,(c.coordinates->>'longitude')::float8 lon,
   hs.building_key(c.title) building,lower(n.name) neighbourhood
  from hs.listing_cards c left join hs.neighborhoods n on n.id=c.neighborhood_id
  where c.listed and c.facts->>'propertyType'='apartment' and (c.facts->>'livingAreaM2')::numeric>0
   and not c.conflicts ? 'livingAreaM2' and jsonb_typeof(c.coordinates)='object'
   and c.coordinates->>'precision'<>'approximate_area'),
 based as materialized (select h.*,hs.price_baseline(model,h.area,h.fee,h.rooms,h.neighbourhood) base from homes h),
 priced as materialized (select b.*,ln(b.price)-b.base residual from based b where b.price>0),
 near as (
  select t.listing_id,x.residual,x.d from based t
  cross join lateral (
   select p.residual,sqrt(power((t.lat-p.lat)*111320,2)+power((t.lon-p.lon)*111320*cos(radians((t.lat+p.lat)/2)),2)) d
   from priced p where p.building<>t.building order by d limit 8) x
  where t.unpriced and x.d<=2000),
 stats as (
  select listing_id,count(*) n,percentile_cont(0.5) within group (order by residual) med,max(d) far from near group by listing_id),
 spread as (
  select r.listing_id,percentile_cont(0.5) within group (order by abs(r.residual-s.med)) mad
  from near r join stats s using(listing_id) group by r.listing_id),
 est as (
  select t.listing_id,coalesce(s.n,0)::integer n,s.far,coalesce(model->'levels' ? t.neighbourhood,false) level_used,
   t.base+coalesce(s.med*s.n/(s.n+1),0) mid,
   case when coalesce(s.n,0)>=4 then greatest(1.4826*sp.mad,0.5*(model->>'residualSd')::float8) else (model->>'residualSd')::float8 end sd
  from based t left join stats s using(listing_id) left join spread sp using(listing_id) where t.unpriced)
 select listing_id,model_id,
  greatest(50000,floor(exp(mid-1.4*sd)/50000)*50000)::bigint,
  greatest(50000,ceil(exp(mid+1.4*sd)/50000)*50000)::bigint,
  greatest(10000,round(exp(mid+(model->>'finalPremium')::float8)/10000)*10000)::bigint,
  n,round(far)::integer,level_used
 from est where level_used or n>=4;
end; $$;

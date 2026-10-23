-- Estimates from up to 16 nearby priced homes instead of 8, the closer ones counting more (weight 1/(metres+150) in a
-- weighted median), and a range no wider than the model's own spread. Backtested on 411 priced catalog apartments on
-- 23 October 2026: median miss 11.5% to 9.1%, range holding the asking price 68% to 76%, the widest tenth of ranges
-- from 64% to 57% of the price, median width 31% to 36%. The app accepts nearby up to 16 since PR 98.

alter table hs.listing_estimates drop constraint listing_estimates_nearby_check,
 add constraint listing_estimates_nearby_check check(nearby between 0 and 16);

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
 near as materialized (
  select t.listing_id,x.residual,x.d,1/(x.d+150) w from based t
  cross join lateral (
   select p.residual,sqrt(power((t.lat-p.lat)*111320,2)+power((t.lon-p.lon)*111320*cos(radians((t.lat+p.lat)/2)),2)) d
   from priced p where p.building<>t.building order by d limit 16) x
  where t.unpriced and x.d<=2000),
 -- Weighted median: the residual where the running weight, in residual order, first reaches half the total.
 centre as materialized (
  select distinct on (listing_id) listing_id,residual med from (
   select listing_id,residual,sum(w) over (partition by listing_id order by residual rows unbounded preceding) run,
    sum(w) over (partition by listing_id) total from near) x
  where run>=total/2 order by listing_id,residual),
 stats as materialized (
  select r.listing_id,count(*) n,max(r.d) far,c.med from near r join centre c using(listing_id) group by r.listing_id,c.med),
 spread as materialized (
  select distinct on (listing_id) listing_id,dev mad from (
   select r.listing_id,abs(r.residual-s.med) dev,
    sum(r.w) over (partition by r.listing_id order by abs(r.residual-s.med) rows unbounded preceding) run,
    sum(r.w) over (partition by r.listing_id) total
   from near r join stats s using(listing_id)) x
  where run>=total/2 order by listing_id,dev),
 est as (
  select t.listing_id,coalesce(s.n,0)::integer n,s.far,coalesce(model->'levels' ? t.neighbourhood,false) level_used,
   t.base+coalesce(s.med*s.n/(s.n+1),0) mid,
   least((model->>'residualSd')::float8,
    case when coalesce(s.n,0)>=4 then greatest(1.4826*sp.mad,0.5*(model->>'residualSd')::float8) else (model->>'residualSd')::float8 end) sd
  from based t left join stats s using(listing_id) left join spread sp using(listing_id) where t.unpriced)
 select listing_id,model_id,
  greatest(50000,floor(exp(mid-1.4*sd)/50000)*50000)::bigint,
  greatest(50000,ceil(exp(mid+1.4*sd)/50000)*50000)::bigint,
  greatest(10000,round(exp(mid+(model->>'finalPremium')::float8)/10000)*10000)::bigint,
  n,round(far)::integer,level_used
 from est where level_used or n>=4;
end; $$;

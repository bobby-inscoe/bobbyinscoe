-- Estimates lean on the closest homes and the home's own street (spec: house-scanner-price-estimate-accuracy).
-- Up to 32 nearby priced homes instead of 16, weighted 1/(metres+150)² instead of 1/(metres+150). Priced homes on the
-- same street (the building key without its number) give a plain median that is blended in by n/(n+2). The range is
-- ±1.5 spreads instead of ±1.4. A home whose neighbourhood has no level takes the neighbourhood most homes on its
-- street within 500 m are in (at least two, other buildings), when that one has a level. Backtested on 410 priced
-- catalog apartments on 23 October 2026: median miss 9.4% to 8.6%, the worst tenth 30.2% to 25.4%, range holding the
-- asking price 76% to 80%, median width 37% to 35%. The app accepts nearby up to 32 first.

alter table hs.listing_estimates drop constraint listing_estimates_nearby_check,
 add constraint listing_estimates_nearby_check check(nearby between 0 and 32);

create or replace function hs.refresh_price_estimates() returns void language plpgsql set search_path=pg_catalog,hs as $$
declare model_id bigint; model jsonb;
begin
 select id,p.model into model_id,model from hs.price_models p where fitted_at>now()-interval '30 days' order by fitted_at desc,id desc limit 1;
 delete from hs.listing_estimates where true;
 if model_id is null then return; end if;
 insert into hs.listing_estimates(listing_id,model_id,low_sek,high_sek,final_sek,nearby,farthest_m,level_used)
 with cards as materialized (
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
 streets as materialized (
  select c.*,coalesce(nullif(regexp_replace(c.building,'\s*\d.*$',''),''),c.building) street,
   coalesce(model->'levels' ? c.neighbourhood,false) has_level from cards c),
 -- Neighbourhood outlines cut streets; an unpriced home without a level votes with its street.
 voted as materialized (
  select distinct on (t.listing_id) t.listing_id,o.neighbourhood
  from streets t join streets o on o.street=t.street and o.building<>t.building and o.has_level
  where t.unpriced and not t.has_level
   and sqrt(power((t.lat-o.lat)*111320,2)+power((t.lon-o.lon)*111320*cos(radians((t.lat+o.lat)/2)),2))<=500
  group by t.listing_id,o.neighbourhood having count(*)>=2
  order by t.listing_id,count(*) desc,o.neighbourhood),
 homes as materialized (
  select s.listing_id,s.area,s.fee,s.rooms,s.price,s.unpriced,s.lat,s.lon,s.building,s.street,
   coalesce(v.neighbourhood,s.neighbourhood) neighbourhood
  from streets s left join voted v using(listing_id)),
 based as materialized (select h.*,hs.price_baseline(model,h.area,h.fee,h.rooms,h.neighbourhood) base from homes h),
 priced as materialized (select b.*,ln(b.price)-b.base residual from based b where b.price>0),
 pairs as materialized (
  select t.listing_id,x.residual,x.d,1/power(x.d+150,2) w,x.street=t.street same_street from based t
  cross join lateral (
   select p.residual,p.street,sqrt(power((t.lat-p.lat)*111320,2)+power((t.lon-p.lon)*111320*cos(radians((t.lat+p.lat)/2)),2)) d
   from priced p where p.building<>t.building order by d limit 32) x
  where t.unpriced and x.d<=2000),
 -- Weighted medians: the smallest value whose running weight, in value order, reaches half the total. Windows, not
 -- joins, carry each home's median to its rows; a join on these steps ran as a nested loop on the hosted catalog.
 ranked as materialized (
  select p.*,sum(w) over (partition by listing_id order by residual rows unbounded preceding) run,
   sum(w) over (partition by listing_id) total from pairs p),
 near as materialized (
  select r.*,min(residual) filter (where run>=total/2) over (partition by listing_id) med from ranked r),
 stats as materialized (select listing_id,count(*) n,max(d) far,max(med) med from near group by listing_id),
 mates as materialized (
  select listing_id,count(*) n,percentile_cont(0.5) within group (order by residual) med from near where same_street group by listing_id),
 spread as materialized (
  select listing_id,min(dev) filter (where run>=total/2) mad from (
   select listing_id,dev,sum(w) over (partition by listing_id order by dev rows unbounded preceding) run,
    sum(w) over (partition by listing_id) total
   from (select listing_id,w,abs(residual-med) dev from near) d) x
  group by listing_id),
 est as (
  select t.listing_id,coalesce(s.n,0)::integer n,s.far,coalesce(model->'levels' ? t.neighbourhood,false) level_used,
   t.base+coalesce(st.n::float8/(st.n+2)*st.med+2::float8/(st.n+2)*s.med*s.n/(s.n+1),s.med*s.n/(s.n+1),0) mid,
   least((model->>'residualSd')::float8,
    case when coalesce(s.n,0)>=4 then greatest(1.4826*sp.mad,0.5*(model->>'residualSd')::float8) else (model->>'residualSd')::float8 end) sd
  from based t left join stats s using(listing_id) left join mates st using(listing_id) left join spread sp using(listing_id)
  where t.unpriced)
 select listing_id,model_id,
  greatest(50000,floor(exp(mid-1.5*sd)/50000)*50000)::bigint,
  greatest(50000,ceil(exp(mid+1.5*sd)/50000)*50000)::bigint,
  greatest(10000,round(exp(mid+(model->>'finalPremium')::float8)/10000)*10000)::bigint,
  n,round(far)::integer,level_used
 from est where level_used or n>=4;
end; $$;

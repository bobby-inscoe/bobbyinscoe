-- Rolls back 20261023200004_house_scanner_price_estimates_refresh: estimates are recomputed by a trigger again.

drop function public.hs_refresh_price_estimates();

create function hs.update_price_estimates() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 perform hs.refresh_price_estimates();
 return new;
end; $$;
revoke all on function hs.update_price_estimates() from public,anon,authenticated,service_role;
-- Named to fire after store_price_models, so a run's own model is used.
create trigger update_price_estimates after update of state on hs.runs
 for each row when (old.state='staging' and new.state='published') execute function hs.update_price_estimates();

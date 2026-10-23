-- Price estimates leave the publish transaction. Recomputing them in a trigger made a Lundin publish run past the
-- hosted 8 second statement timeout and fail. The ingest function now calls hs_refresh_price_estimates as a statement
-- of its own after a run publishes, so a slow or failing refresh leaves the previous estimates and never a failed
-- publish.

drop trigger update_price_estimates on hs.runs;
drop function hs.update_price_estimates();

create function public.hs_refresh_price_estimates() returns void language plpgsql security definer
set search_path=pg_catalog,hs as $$
begin
 perform hs.refresh_price_estimates();
end; $$;
revoke all on function public.hs_refresh_price_estimates() from public,anon,authenticated;
grant execute on function public.hs_refresh_price_estimates() to service_role;

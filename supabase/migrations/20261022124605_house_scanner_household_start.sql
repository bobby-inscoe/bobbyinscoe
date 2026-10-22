-- One request to open the app (spec: house-scanner-data-foundation, S8).
-- The client asked for the memberships and then, with the household they named, for the snapshot: two round trips in a
-- row, each slow on a cold connection. public.hs_household_start returns both. It reads the snapshot for the named
-- household when the caller belongs to it, or for the caller's only household when none is named; otherwise
-- (several households and none chosen yet, or none) the snapshot is null. The memberships and snapshot functions
-- are unchanged and keep their checks.
create function public.hs_household_start(p_household_id uuid default null) returns json
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare own jsonb := public.hs_memberships(); chosen uuid;
begin
 select (m->>'householdId')::uuid into chosen from jsonb_array_elements(own) m
 where (m->>'householdId')::uuid=p_household_id or (p_household_id is null and jsonb_array_length(own)=1);
 return json_build_object('memberships',own,'snapshot',case when chosen is not null then public.hs_household_snapshot(chosen) end);
end; $$;

revoke all on function public.hs_household_start(uuid) from public,anon,authenticated,service_role;
grant execute on function public.hs_household_start(uuid) to authenticated;

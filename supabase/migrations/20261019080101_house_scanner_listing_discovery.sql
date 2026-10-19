-- Discovery is separate from source observation time and from meaningful content changes.
alter table hs.listings
 add column first_seen_at timestamptz,
 add column last_changed_at timestamptz,
 add column first_seen_run_id uuid references hs.runs(id);

-- Observation rows are written only at discovery or meaningful changes. Unknown history stays unknown.
with history as (
 select distinct on (listing_id) listing_id,received_at,run_id,count(*) over (partition by listing_id) as entries
 from hs.observations order by listing_id,received_at,id
), changes as (
 select listing_id,max(received_at) as changed_at from hs.observations group by listing_id
)
update hs.listings l set first_seen_at=case when h.entries>=l.revision then h.received_at end,
 first_seen_run_id=case when h.entries>=l.revision then h.run_id end,last_changed_at=c.changed_at
from history h join changes c using(listing_id) where l.id=h.listing_id;
update hs.listings set first_seen_at=observed_at,last_changed_at=observed_at where origin='manual';

create function hs.track_listing_times() returns trigger
language plpgsql set search_path=pg_catalog,hs as $$
begin
 if tg_op='INSERT' then
  new.first_seen_at:=now();
  new.last_changed_at:=now();
  new.first_seen_run_id:=null;
 else
  new.first_seen_at:=old.first_seen_at;
  new.first_seen_run_id:=old.first_seen_run_id;
  -- Ingest already increments revision for meaningful source changes; retention scrubbing does not.
  new.last_changed_at:=case when
   (new.origin='source' and new.revision>old.revision) or
   (new.origin='manual' and hs.observation_content(new.value) is distinct from hs.observation_content(old.value))
   then now() else old.last_changed_at end;
 end if;
 return new;
end;
$$;
create trigger listing_times before insert or update of value on hs.listings
 for each row execute function hs.track_listing_times();

-- Ingest writes a discovery observation after inserting a listing, in the same transaction.
-- A later change to a legacy row without history must not turn it into a new discovery.
create function hs.record_discovery_run() returns trigger
language plpgsql set search_path=pg_catalog,hs as $$
begin
 update hs.listings set first_seen_run_id=new.run_id
 where id=new.listing_id and household_id=new.household_id and origin='source'
 and first_seen_run_id is null and first_seen_at=new.received_at;
 return new;
end;
$$;
create trigger observation_discovery after insert on hs.observations
 for each row execute function hs.record_discovery_run();

create or replace function hs.neighborhood_for_coordinates(coordinates jsonb) returns text
language sql stable set search_path=pg_catalog,hs as $$
 select s.neighborhood_id from hs.neighborhood_shapes s
 where coordinates->>'precision' in ('address','building','user_supplied')
 and (coalesce(coordinates->>'estimated','false')='false'
  or coordinates->>'source'='Estimated from the address (OpenStreetMap)')
 and s.outline @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision)
 and not exists(select 1 from unnest(s.holes) as hole
  where hole @> point((coordinates->>'longitude')::double precision,(coordinates->>'latitude')::double precision))
 order by s.neighborhood_id limit 1
$$;
update hs.listings set neighborhood_id=hs.neighborhood_for_coordinates(value->'coordinates')
 where value->'coordinates'->>'estimated'='true';

-- This endpoint belongs to the still-unmerged UI release. The deployed legacy endpoint is untouched.
create or replace function public.hs_snapshot_neighborhoods(p_household_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare base jsonb; homes jsonb;
begin
 base:=public.hs_snapshot(p_household_id);
 with latest_source_runs as (
  select distinct on (result->>'sourceId') result->>'sourceId' as source_id,r.id
  from hs.editions e join hs.runs r on r.id=e.run_id and r.household_id=e.household_id,
  lateral jsonb_array_elements(r.results) result
  where e.household_id=p_household_id and r.state='published' and result->>'status' in ('success','partial')
  order by result->>'sourceId',e.published_at desc,e.id desc
 )
 select coalesce(jsonb_agg(
  v.item || jsonb_build_object(
   'firstSeenAt',l.first_seen_at,'lastChangedAt',l.last_changed_at,'lastCheckedAt',l.last_checked_at,
   'isNew',coalesce(l.origin='source' and l.first_seen_run_id=latest.id,false)) ||
  case when n.id is not null and jsonb_typeof(v.item->'coordinates')='object'
   then jsonb_build_object('neighborhood',jsonb_build_object('id',n.id,'name',n.name,'method','polygon','datasetVersion',n.dataset_version))
   else '{}'::jsonb end order by v.position
 ),'[]'::jsonb) into homes
 from jsonb_array_elements(base->'listings') with ordinality v(item,position)
 join hs.listings l on l.id=(v.item->>'id')::uuid and l.household_id=p_household_id
 left join hs.neighborhoods n on n.id=l.neighborhood_id
 left join latest_source_runs latest on latest.source_id=l.source_id;
 return jsonb_set(base,'{listings}',homes);
end;
$$;
revoke all on function hs.track_listing_times(),hs.record_discovery_run() from public,anon,authenticated,service_role;

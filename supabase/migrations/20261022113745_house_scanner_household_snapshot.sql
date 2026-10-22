-- Household snapshot v2 (spec: house-scanner-data-foundation, S4).
-- public.hs_household_snapshot reads the read model: the household's rows (hs.visible_listings) joined to their cards,
-- plus manual homes, members, profiles, favorites, hides and notes, built in one statement. Its cost follows the homes
-- the household sees, not the catalog. The response sends each value once: photo credit text per source, neighborhood
-- names per area, and on each home only the facts that differ from the empty defaults and the keys that have a value.
-- The client expands it into the same in-memory snapshot as before. hs_snapshot and hs_snapshot_neighborhoods stay
-- unchanged until the client has moved.
-- public.hs_set_favorites saves or removes up to 500 favorites in one call, with hs_set_favorite's rules.

-- hs.visible_listings tested each row's source policy, which is stored out of line and was read again for every row:
-- 38 ms of a household's 485 homes on 22 October. Each policy is now tested once. The rule is unchanged.
create or replace function hs.visible_listings(p_household_id uuid) returns table(listing_id uuid) language sql stable
begin atomic
 with p as materialized (select source_id,hs.policy_current(policy) live from hs.source_policies)
 select h.listing_id from hs.household_listings h join hs.listing_cards c on c.listing_id=h.listing_id
  join p on p.source_id=c.source_id
 where h.household_id=p_household_id and (h.touched or (p.live and c.listed and c.observed_at>=now()-c.retention
  and (h.hidden or (h.matches and c.delisted_at is null))));
end;

create function public.hs_household_snapshot(p_household_id uuid) returns json
language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare edition json; result json; homes integer; people integer; rules integer; saved integer;
begin
 perform hs.require_member(p_household_id);
 select json_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition
 from hs.editions order by published_at desc,id desc limit 1;
 with p as materialized (select source_id,hs.policy_current(policy) live,latest_run_id from hs.source_policies),
 -- The household's catalog homes with the clock-dependent rules applied.
 seen as materialized (
  select c.*,p.live,p.latest_run_id,
   case when (c.coordinates->>'observedAt')::timestamptz>=now()-c.retention and (c.coordinates->>'observedAt')::timestamptz<=now()+interval '5 minutes'
    and jsonb_typeof(c.coordinates)='object' then c.coordinates end shown_coordinates,
   case when p.live and (c.photo->>'expiresAt')::timestamptz>now() and (c.photo->>'observedAt')::timestamptz>=now()-c.retention then c.photo end shown_photo
  from hs.visible_listings(p_household_id) v join hs.listing_cards c on c.listing_id=v.listing_id join p on p.source_id=c.source_id),
 -- Each source's usual photo credit, sent once. A photo with other text carries its own.
 credits as materialized (
  select source_id,mode() within group (order by shown_photo->>'attribution') attribution,mode() within group (order by shown_photo->>'rightsBasis') rights
  from seen where shown_photo is not null group by source_id),
 areas as materialized (
  select a.id,a.name,a.dataset_version from hs.neighborhoods a
  where a.id in (select s.neighborhood_id from seen s where s.shown_coordinates is not null
   union select x from seen s,unnest(s.neighborhood_candidates) x where s.shown_coordinates is not null)),
 -- jsonb_strip_nulls drops keys without a value. It also reaches into nested objects, which is safe for the trimmed
 -- facts, coordinates, photo and area ids; viewings and evidence keep nullable fields, so they are added after it.
 source_homes as (
  select s.listing_id id,s.observed_at,jsonb_strip_nulls(jsonb_build_object(
   'id',s.listing_id,'sourceId',s.source_id,'title',s.title,'url',s.source_url,
   'facts',s.facts - array(select key from jsonb_each(s.facts) where hs.empty_facts()->key=value),
   'conflicts',nullif(s.conflicts,'[]'::jsonb),'coordinates',s.shown_coordinates,
   'photo',case when s.shown_photo is not null then jsonb_build_object('url',s.shown_photo->'url','expiresAt',s.shown_photo->'expiresAt','observedAt',s.shown_photo->'observedAt')
    ||case when (s.shown_photo->>'attribution',s.shown_photo->>'rightsBasis') is distinct from (k.attribution,k.rights)
     then jsonb_build_object('attribution',s.shown_photo->'attribution','rightsBasis',s.shown_photo->'rightsBasis') else '{}'::jsonb end end,
   'previousAskingPriceSek',case when s.previous_price_observed_at>=now()-s.retention then s.previous_asking_price end,
   'observedAt',s.observed_at,'firstSeenAt',s.first_seen_at,'lastChangedAt',s.last_changed_at,'lastCheckedAt',s.last_checked_at,
   'isNew',case when s.first_seen_run_id=s.latest_run_id then true end,
   'delistedAt',s.delisted_at,
   'neighborhoodId',case when s.shown_coordinates is not null then (select a.id from areas a where a.id=s.neighborhood_id) end,
   'neighborhoodIds',case when s.shown_coordinates is not null then coalesce((select jsonb_agg(ids.id order by ids.position)
    from unnest(s.neighborhood_candidates) with ordinality ids(id,position) join areas a on a.id=ids.id),'[]'::jsonb) end,
   'neighborhoodRadiusM',case when s.shown_coordinates is not null then s.neighborhood_radius_m end))
   ||coalesce((select jsonb_build_object('viewings',jsonb_agg(x order by x->>'startsAt')) from jsonb_array_elements(s.viewings) x
     where s.live and (x->>'startsAt')::timestamptz>now() having count(*)>0),'{}'::jsonb)
   ||coalesce((select jsonb_build_object('evidence',jsonb_agg(e order by n)) from jsonb_array_elements(s.evidence) with ordinality y(e,n)
     where (e->>'observedAt')::timestamptz>=now()-s.retention having count(*)>0),'{}'::jsonb) item
  from seen s left join credits k on k.source_id=s.source_id),
 manual_homes as (
  select m.id,m.observed_at,jsonb_strip_nulls(jsonb_build_object(
   'id',m.id,'origin','manual','title',m.value->>'title','sourceUrls',m.value->'sourceUrls',
   'facts',(select f - array(select key from jsonb_each(f) where hs.empty_facts()->key=value) from (select hs.empty_facts()||coalesce(m.value->'facts','{}'::jsonb) f) x),
   'photos',case when m.value ? 'imageUrls' then (select jsonb_agg(jsonb_build_object('url',u.url#>>'{}') order by n) from jsonb_array_elements(m.value->'imageUrls') with ordinality u(url,n)) end,
   'photoExpiresAt',case when m.value ? 'imageUrls' then to_jsonb(m.observed_at+interval '1 year') end,
   'observedAt',m.observed_at,'firstSeenAt',m.first_seen_at,'lastChangedAt',m.last_changed_at,'lastCheckedAt',m.last_checked_at,
   'addedBy',m.added_by,'userTags',m.value->'userTags')) item
  from hs.manual_listings m where m.household_id=p_household_id),
 all_homes as materialized (select * from source_homes union all select * from manual_homes)
 select json_build_object(
  'contractVersion',2,'householdId',p_household_id,'edition',edition,
  'members',(select coalesce(json_agg(json_build_object('userId',user_id,'displayName',display_name,'role',role) order by user_id),'[]'::json)
   from hs.members where household_id=p_household_id),
  'profiles',(select coalesce(json_agg(json_build_object('id',id,'revision',revision,'name',name,'enabled',enabled,'criteria',criteria,'editedBy',edited_by,'editedAt',edited_at) order by id),'[]'::json)
   from hs.profiles where household_id=p_household_id),
  'sources',(select coalesce(json_object_agg(source_id,json_build_object('photoAttribution',attribution,'photoRightsBasis',rights)),'{}'::json) from credits),
  'neighborhoods',(select coalesce(json_object_agg(id,json_build_object('name',name,'datasetVersion',dataset_version)),'{}'::json) from areas),
  'listings',(select coalesce(json_agg(item order by observed_at desc,id),'[]'::json) from all_homes),
  'favorites',(select coalesce(json_agg(json_build_object('listingId',coalesce(f.listing_id,f.manual_listing_id),'userId',f.user_id,'savedAt',f.saved_at) order by f.saved_at),'[]'::json)
   from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id
   where f.household_id=p_household_id and coalesce(f.listing_id,f.manual_listing_id) in (select id from all_homes)),
  'hides',(select coalesce(json_agg(json_build_object('listingId',coalesce(h.listing_id,h.manual_listing_id),'userId',h.user_id,'hiddenAt',h.hidden_at) order by coalesce(h.listing_id,h.manual_listing_id)),'[]'::json)
   from hs.hidden_listings h where h.household_id=p_household_id and coalesce(h.listing_id,h.manual_listing_id) in (select id from all_homes)),
  'notes',(select coalesce(json_agg(json_build_object('listingId',coalesce(n.listing_id,n.manual_listing_id),'userId',n.user_id,'body',n.body,'revision',n.revision,'editedAt',n.edited_at) order by coalesce(n.listing_id,n.manual_listing_id),n.user_id),'[]'::json)
   from hs.notes n where n.household_id=p_household_id and coalesce(n.listing_id,n.manual_listing_id) in (select id from all_homes))),
  (select count(*) from all_homes),
  (select count(*) from hs.members where household_id=p_household_id),
  (select count(*) from hs.profiles where household_id=p_household_id),
  (select count(*) from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id
   where f.household_id=p_household_id and coalesce(f.listing_id,f.manual_listing_id) in (select id from all_homes))
 into result,homes,people,rules,saved;
 if homes>1500 or people>10 or rules>20 or saved>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return result;
end; $$;

-- hs_set_favorite for up to 500 listings at once, under one household lock.
create function public.hs_set_favorites(p_household_id uuid,p_listing_ids uuid[],p_saved boolean) returns jsonb language plpgsql security definer
set search_path=pg_catalog,hs as $$
declare ids uuid[];
begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 if p_saved is null or p_listing_ids is null or cardinality(p_listing_ids) not between 1 and 500 or array_position(p_listing_ids,null) is not null then
  raise exception 'Invalid favorite request'; end if;
 select array_agg(distinct x) into ids from unnest(p_listing_ids) x;
 if exists(select 1 from unnest(ids) x where not (exists(select 1 from hs.manual_listings where id=x and household_id=p_household_id)
  or (p_saved and hs.catalog_visible(p_household_id,x)) or (not p_saved and exists(select 1 from hs.listings where id=x)))) then
  raise exception 'Listing unavailable'; end if;
 if p_saved then
  insert into hs.favorites(household_id,listing_id,manual_listing_id,user_id,bookmark_url)
   select p_household_id,l.id,null,auth.uid(),l.value->>'sourceUrl' from hs.listings l where l.id=any(ids)
   union all select p_household_id,null,m.id,auth.uid(),m.value->'sourceUrls'->>0 from hs.manual_listings m where m.id=any(ids) and m.household_id=p_household_id
   on conflict do nothing;
 else delete from hs.favorites where household_id=p_household_id and coalesce(listing_id,manual_listing_id)=any(ids) and user_id=auth.uid(); end if;
 return jsonb_build_object('ok',true);
end; $$;

revoke all on function hs.visible_listings(uuid),public.hs_household_snapshot(uuid),public.hs_set_favorites(uuid,uuid[],boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.hs_household_snapshot(uuid),public.hs_set_favorites(uuid,uuid[],boolean) to authenticated;

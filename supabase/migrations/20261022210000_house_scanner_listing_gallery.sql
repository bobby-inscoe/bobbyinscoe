-- Listing gallery (spec: house-scanner-listing-gallery, S1).
-- An observation may carry up to three photos after the lead `photo` (`morePhotos`) and one `floorPlan`, each with
-- the photo's fields. Ingest checks every image as it checks the photo: the policy allows display and hotlinking from
-- its origin, it has not expired and it was seen within retention. Extra photos need a lead photo.
-- Cards keep the images their policy allows in `gallery`. The household snapshot sends the ones still valid: `photos`
-- (the lead first, addresses only, sharing the lead's credit and expiry) and `floorPlan` (with its own times).
-- Revisions follow tracked fields only since the listing history change, so a new image address adds no revision and
-- hs.observation_content stays as it is.

create or replace function hs.assert_observation(p jsonb,o jsonb) returns void language plpgsql set search_path=pg_catalog,hs as $$ declare img jsonb; begin
 perform hs.assert_observation_facts(p,o);
 if jsonb_typeof(o->'viewings')='array' and jsonb_array_length(o->'viewings')>0 and p->'viewings' is distinct from 'true'::jsonb then
  raise exception 'Viewing times not permitted'; end if;
 if o ? 'morePhotos' and (jsonb_typeof(o->'morePhotos') is distinct from 'array' or jsonb_array_length(o->'morePhotos') not between 1 and 3
  or jsonb_typeof(o->'photo') is distinct from 'object') then raise exception 'Photo not permitted'; end if;
 for img in select x from jsonb_array_elements(coalesce(o->'morePhotos','[]'::jsonb)) x union all select o->'floorPlan' where o ? 'floorPlan' loop
  if jsonb_typeof(img) is distinct from 'object' or not coalesce((p->>'imageDisplay')::boolean and (p->>'imageHotlink')::boolean
   and p->'imageOrigins' ? hs.origin(img->>'url') and (img->>'expiresAt')::timestamptz>now()
   and (img->>'observedAt')::timestamptz between now()-make_interval(days=>(p->>'retentionDays')::int) and now()+interval '5 minutes',false) then
   raise exception 'Photo not permitted'; end if;
 end loop;
end; $$;

alter table hs.listing_cards add column gallery jsonb;

-- As before, plus `gallery`: the extra photos and floor plan from origins the policy allows images from.
drop function hs.card_rows(uuid[]);
create function hs.card_rows(p_ids uuid[]) returns table (
 listing_id uuid, source_id text, title text, source_url text, facts jsonb, conflicts jsonb, coordinates jsonb, evidence jsonb,
 photo jsonb, viewings jsonb, previous_asking_price bigint, previous_price_observed_at timestamptz, observed_at timestamptz,
 first_seen_at timestamptz, last_changed_at timestamptz, last_checked_at timestamptz, first_seen_run_id uuid, delisted_at timestamptz,
 neighborhood_id text, neighborhood_candidates text[], neighborhood_radius_m integer, listed boolean, retention interval, gallery jsonb)
language sql stable set search_path=pg_catalog,hs as $$
 -- Policies are stored out of line; ||'{}' reads each once, where the bare column is read again at every reference.
 with p as materialized (select source_id,policy||'{}'::jsonb policy,make_interval(days=>(policy->>'retentionDays')::int) retention,
  coalesce((policy->>'imageDisplay')::boolean,false) and coalesce((policy->>'imageHotlink')::boolean,false) images from hs.source_policies)
 select l.id,l.source_id,l.value->>'title',l.value->>'sourceUrl',
  hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb),
  coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb),
  nullif(l.value->'coordinates','null'::jsonb),
  coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where p.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl'))),'[]'::jsonb),
  case when p.images and p.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') then l.value->'photo' end,
  case when p.policy->'viewings'='true'::jsonb then coalesce((select jsonb_agg(x order by x->>'startsAt') from jsonb_array_elements(case when jsonb_typeof(l.value->'viewings')='array' then l.value->'viewings' else '[]'::jsonb end) x),'[]'::jsonb) end,
  case when p.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') then l.previous_asking_price end,
  l.previous_price_observed_at,l.observed_at,l.first_seen_at,l.last_changed_at,l.last_checked_at,l.first_seen_run_id,l.delisted_at,
  l.neighborhood_id,l.neighborhood_candidates,l.neighborhood_radius_m,
  coalesce(p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl'),false),p.retention,
  case when p.images then nullif(jsonb_strip_nulls(jsonb_build_object(
   'morePhotos',(select jsonb_agg(x order by n) from jsonb_array_elements(case when jsonb_typeof(l.value->'morePhotos')='array' then l.value->'morePhotos' else '[]'::jsonb end) with ordinality y(x,n)
    where p.policy->'imageOrigins' ? hs.origin(x->>'url')),
   'floorPlan',case when jsonb_typeof(l.value->'floorPlan')='object' and p.policy->'imageOrigins' ? hs.origin(l.value->'floorPlan'->>'url') then l.value->'floorPlan' end)),'{}'::jsonb) end
 from hs.listings l join p on p.source_id=l.source_id
 where p_ids is null or l.id=any(p_ids)
$$;

create or replace function hs.refresh_cards(p_ids uuid[]) returns void language sql set search_path=pg_catalog,hs as $$
 insert into hs.listing_cards(listing_id,source_id,title,source_url,facts,conflicts,coordinates,evidence,photo,viewings,previous_asking_price,
  previous_price_observed_at,observed_at,first_seen_at,last_changed_at,last_checked_at,first_seen_run_id,delisted_at,neighborhood_id,
  neighborhood_candidates,neighborhood_radius_m,listed,retention,gallery)
 select * from hs.card_rows(p_ids)
 on conflict (listing_id) do update set (source_id,title,source_url,facts,conflicts,coordinates,evidence,photo,viewings,previous_asking_price,
  previous_price_observed_at,observed_at,first_seen_at,last_changed_at,last_checked_at,first_seen_run_id,delisted_at,neighborhood_id,
  neighborhood_candidates,neighborhood_radius_m,listed,retention,gallery,changed_seq)
 =(excluded.source_id,excluded.title,excluded.source_url,excluded.facts,excluded.conflicts,excluded.coordinates,excluded.evidence,excluded.photo,
  excluded.viewings,excluded.previous_asking_price,excluded.previous_price_observed_at,excluded.observed_at,excluded.first_seen_at,
  excluded.last_changed_at,excluded.last_checked_at,excluded.first_seen_run_id,excluded.delisted_at,excluded.neighborhood_id,
  excluded.neighborhood_candidates,excluded.neighborhood_radius_m,excluded.listed,excluded.retention,excluded.gallery,nextval('hs.change_seq'))
 where (listing_cards.source_id,listing_cards.title,listing_cards.source_url,listing_cards.facts,listing_cards.conflicts,listing_cards.coordinates,
  listing_cards.evidence,listing_cards.photo,listing_cards.viewings,listing_cards.previous_asking_price,listing_cards.previous_price_observed_at,
  listing_cards.observed_at,listing_cards.first_seen_at,listing_cards.last_changed_at,listing_cards.last_checked_at,listing_cards.first_seen_run_id,
  listing_cards.delisted_at,listing_cards.neighborhood_id,listing_cards.neighborhood_candidates,listing_cards.neighborhood_radius_m,
  listing_cards.listed,listing_cards.retention,listing_cards.gallery)
 is distinct from (excluded.source_id,excluded.title,excluded.source_url,excluded.facts,excluded.conflicts,excluded.coordinates,excluded.evidence,
  excluded.photo,excluded.viewings,excluded.previous_asking_price,excluded.previous_price_observed_at,excluded.observed_at,excluded.first_seen_at,
  excluded.last_changed_at,excluded.last_checked_at,excluded.first_seen_run_id,excluded.delisted_at,excluded.neighborhood_id,
  excluded.neighborhood_candidates,excluded.neighborhood_radius_m,excluded.listed,excluded.retention,excluded.gallery);
$$;

create or replace function hs.card_drift() returns setof uuid language sql stable set search_path=pg_catalog,hs as $$
 select coalesce(c.listing_id,r.listing_id) from hs.listing_cards c full join hs.card_rows(null) r on r.listing_id=c.listing_id
 where c.listing_id is null or r.listing_id is null
  or (c.source_id,c.title,c.source_url,c.facts,c.conflicts,c.coordinates,c.evidence,c.photo,c.viewings,c.previous_asking_price,
   c.previous_price_observed_at,c.observed_at,c.first_seen_at,c.last_changed_at,c.last_checked_at,c.first_seen_run_id,c.delisted_at,
   c.neighborhood_id,c.neighborhood_candidates,c.neighborhood_radius_m,c.listed,c.retention,c.gallery)
  is distinct from (r.source_id,r.title,r.source_url,r.facts,r.conflicts,r.coordinates,r.evidence,r.photo,r.viewings,r.previous_asking_price,
   r.previous_price_observed_at,r.observed_at,r.first_seen_at,r.last_changed_at,r.last_checked_at,r.first_seen_run_id,r.delisted_at,
   r.neighborhood_id,r.neighborhood_candidates,r.neighborhood_radius_m,r.listed,r.retention,r.gallery)
$$;

revoke all on function hs.card_rows(uuid[]) from public,anon,authenticated,service_role;

-- As before, plus `photos` and `floorPlan` on catalog homes.
create or replace function public.hs_household_snapshot(p_household_id uuid) returns json
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
   case when p.live and (c.photo->>'expiresAt')::timestamptz>now() and (c.photo->>'observedAt')::timestamptz>=now()-c.retention then c.photo end shown_photo,
   case when p.live then (select jsonb_agg(jsonb_build_object('url',x->'url') order by n) from jsonb_array_elements(c.gallery->'morePhotos') with ordinality y(x,n)
    where (x->>'expiresAt')::timestamptz>now() and (x->>'observedAt')::timestamptz>=now()-c.retention) end shown_more,
   case when p.live and (c.gallery->'floorPlan'->>'expiresAt')::timestamptz>now() and (c.gallery->'floorPlan'->>'observedAt')::timestamptz>=now()-c.retention
    then c.gallery->'floorPlan' end shown_plan
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
   'photos',case when s.shown_photo is not null and s.shown_more is not null then jsonb_build_array(jsonb_build_object('url',s.shown_photo->'url'))||s.shown_more end,
   'floorPlan',case when s.shown_plan is not null then jsonb_build_object('url',s.shown_plan->'url','expiresAt',s.shown_plan->'expiresAt','observedAt',s.shown_plan->'observedAt') end,
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

select hs.refresh_cards(null);

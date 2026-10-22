-- Listing cards (spec: house-scanner-data-foundation, S2).
-- The snapshot applies each source's policy to every catalog listing on every request: allowed facts and conflicts,
-- evidence subjects and origins, photo rights and the viewings switch. hs.listing_cards holds the result once per
-- listing, kept current when a listing is written or its source policy changes, so a later snapshot can read it instead
-- of recomputing it per household and request. Nothing reads the cards yet.
-- What depends on the clock stays a read-time test against values the card keeps: retention (`retention`), the policy
-- review window (the policy itself), photo expiry, coordinate and evidence observation times, and past viewings.
-- `changed_seq` rises whenever a card changes, for a later step that sends only what changed.

create sequence hs.change_seq;
create table hs.listing_cards (
 listing_id uuid primary key references hs.listings(id) on delete cascade,
 source_id text not null,
 title text,
 source_url text,
 -- hs.empty_facts() merged with the facts the policy allows, as the hard rules read them.
 facts jsonb not null,
 conflicts jsonb not null,
 coordinates jsonb,
 -- Items with an allowed subject, kind and origin; their observation times are tested at read time.
 evidence jsonb not null,
 -- The photo when the policy may display and hotlink images from its origin; expiry is tested at read time.
 photo jsonb,
 -- Every published viewing, sorted, when the policy shows viewings; null when it does not.
 viewings jsonb,
 -- The previous price when the policy allows prices and the listing's price is undisputed.
 previous_asking_price bigint,
 previous_price_observed_at timestamptz,
 observed_at timestamptz not null,
 first_seen_at timestamptz,
 last_changed_at timestamptz,
 last_checked_at timestamptz,
 first_seen_run_id uuid,
 delisted_at timestamptz,
 neighborhood_id text,
 neighborhood_candidates text[] not null,
 neighborhood_radius_m integer,
 -- Whether the listing's URL is on an origin the policy lists. Saved or noted listings show regardless.
 listed boolean not null,
 retention interval,
 changed_seq bigint not null default nextval('hs.change_seq')
);
alter table hs.listing_cards enable row level security;
revoke all on hs.listing_cards from public,anon,authenticated,service_role;
revoke all on sequence hs.change_seq from public,anon,authenticated,service_role;

-- The cards for the given listings, or for all of them, computed from the listings and policies. The one definition of
-- a card: writes and the drift check both use it.
create function hs.card_rows(p_ids uuid[]) returns table (
 listing_id uuid, source_id text, title text, source_url text, facts jsonb, conflicts jsonb, coordinates jsonb, evidence jsonb,
 photo jsonb, viewings jsonb, previous_asking_price bigint, previous_price_observed_at timestamptz, observed_at timestamptz,
 first_seen_at timestamptz, last_changed_at timestamptz, last_checked_at timestamptz, first_seen_run_id uuid, delisted_at timestamptz,
 neighborhood_id text, neighborhood_candidates text[], neighborhood_radius_m integer, listed boolean, retention interval)
language sql stable set search_path=pg_catalog,hs as $$
 -- Policies are stored out of line; ||'{}' reads each once, where the bare column is read again at every reference.
 with p as materialized (select source_id,policy||'{}'::jsonb policy,make_interval(days=>(policy->>'retentionDays')::int) retention from hs.source_policies)
 select l.id,l.source_id,l.value->>'title',l.value->>'sourceUrl',
  hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb),
  coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb),
  nullif(l.value->'coordinates','null'::jsonb),
  coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where p.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl'))),'[]'::jsonb),
  case when coalesce((p.policy->>'imageDisplay')::boolean,false) and coalesce((p.policy->>'imageHotlink')::boolean,false) and p.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') then l.value->'photo' end,
  case when p.policy->'viewings'='true'::jsonb then coalesce((select jsonb_agg(x order by x->>'startsAt') from jsonb_array_elements(case when jsonb_typeof(l.value->'viewings')='array' then l.value->'viewings' else '[]'::jsonb end) x),'[]'::jsonb) end,
  case when p.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') then l.previous_asking_price end,
  l.previous_price_observed_at,l.observed_at,l.first_seen_at,l.last_changed_at,l.last_checked_at,l.first_seen_run_id,l.delisted_at,
  l.neighborhood_id,l.neighborhood_candidates,l.neighborhood_radius_m,
  coalesce(p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl'),false),p.retention
 from hs.listings l join p on p.source_id=l.source_id
 where p_ids is null or l.id=any(p_ids)
$$;

-- Writes the cards of the given listings. A card that would not change keeps its row and its changed_seq.
create function hs.refresh_cards(p_ids uuid[]) returns void language sql set search_path=pg_catalog,hs as $$
 insert into hs.listing_cards(listing_id,source_id,title,source_url,facts,conflicts,coordinates,evidence,photo,viewings,previous_asking_price,
  previous_price_observed_at,observed_at,first_seen_at,last_changed_at,last_checked_at,first_seen_run_id,delisted_at,neighborhood_id,
  neighborhood_candidates,neighborhood_radius_m,listed,retention)
 select * from hs.card_rows(p_ids)
 on conflict (listing_id) do update set (source_id,title,source_url,facts,conflicts,coordinates,evidence,photo,viewings,previous_asking_price,
  previous_price_observed_at,observed_at,first_seen_at,last_changed_at,last_checked_at,first_seen_run_id,delisted_at,neighborhood_id,
  neighborhood_candidates,neighborhood_radius_m,listed,retention,changed_seq)
 =(excluded.source_id,excluded.title,excluded.source_url,excluded.facts,excluded.conflicts,excluded.coordinates,excluded.evidence,excluded.photo,
  excluded.viewings,excluded.previous_asking_price,excluded.previous_price_observed_at,excluded.observed_at,excluded.first_seen_at,
  excluded.last_changed_at,excluded.last_checked_at,excluded.first_seen_run_id,excluded.delisted_at,excluded.neighborhood_id,
  excluded.neighborhood_candidates,excluded.neighborhood_radius_m,excluded.listed,excluded.retention,nextval('hs.change_seq'))
 where (listing_cards.source_id,listing_cards.title,listing_cards.source_url,listing_cards.facts,listing_cards.conflicts,listing_cards.coordinates,
  listing_cards.evidence,listing_cards.photo,listing_cards.viewings,listing_cards.previous_asking_price,listing_cards.previous_price_observed_at,
  listing_cards.observed_at,listing_cards.first_seen_at,listing_cards.last_changed_at,listing_cards.last_checked_at,listing_cards.first_seen_run_id,
  listing_cards.delisted_at,listing_cards.neighborhood_id,listing_cards.neighborhood_candidates,listing_cards.neighborhood_radius_m,
  listing_cards.listed,listing_cards.retention)
 is distinct from (excluded.source_id,excluded.title,excluded.source_url,excluded.facts,excluded.conflicts,excluded.coordinates,excluded.evidence,
  excluded.photo,excluded.viewings,excluded.previous_asking_price,excluded.previous_price_observed_at,excluded.observed_at,excluded.first_seen_at,
  excluded.last_changed_at,excluded.last_checked_at,excluded.first_seen_run_id,excluded.delisted_at,excluded.neighborhood_id,
  excluded.neighborhood_candidates,excluded.neighborhood_radius_m,excluded.listed,excluded.retention);
$$;

-- Listings whose stored card differs from a fresh computation, or is missing or left over. Empty when the triggers kept
-- up. Read-only; safe to run on the hosted project.
create function hs.card_drift() returns setof uuid language sql stable set search_path=pg_catalog,hs as $$
 select coalesce(c.listing_id,r.listing_id) from hs.listing_cards c full join hs.card_rows(null) r on r.listing_id=c.listing_id
 where c.listing_id is null or r.listing_id is null
  or (c.source_id,c.title,c.source_url,c.facts,c.conflicts,c.coordinates,c.evidence,c.photo,c.viewings,c.previous_asking_price,
   c.previous_price_observed_at,c.observed_at,c.first_seen_at,c.last_changed_at,c.last_checked_at,c.first_seen_run_id,c.delisted_at,
   c.neighborhood_id,c.neighborhood_candidates,c.neighborhood_radius_m,c.listed,c.retention)
  is distinct from (r.source_id,r.title,r.source_url,r.facts,r.conflicts,r.coordinates,r.evidence,r.photo,r.viewings,r.previous_asking_price,
   r.previous_price_observed_at,r.observed_at,r.first_seen_at,r.last_changed_at,r.last_checked_at,r.first_seen_run_id,r.delisted_at,
   r.neighborhood_id,r.neighborhood_candidates,r.neighborhood_radius_m,r.listed,r.retention)
$$;

-- One refresh per statement over the rows it wrote: publish inserts new homes and updates known ones in a statement
-- each, and delisting marks a source's homes in one more.
create function hs.listing_cards_follow() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 perform hs.refresh_cards(array(select id from written));
 return null;
end; $$;
create trigger listing_cards_insert after insert on hs.listings referencing new table as written
 for each statement execute function hs.listing_cards_follow();
create trigger listing_cards_update after update on hs.listings referencing new table as written
 for each statement execute function hs.listing_cards_follow();

-- A changed policy rewrites its source's cards. Other updates of the row, such as the latest run, leave them alone.
create function hs.policy_cards_follow() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
begin
 perform hs.refresh_cards(array(select l.id from hs.listings l join new_policies n on n.source_id=l.source_id
  join old_policies o on o.source_id=n.source_id where o.policy is distinct from n.policy));
 return null;
end; $$;
create trigger policy_cards after update on hs.source_policies referencing old table as old_policies new table as new_policies
 for each statement execute function hs.policy_cards_follow();

revoke all on function hs.card_rows(uuid[]),hs.refresh_cards(uuid[]),hs.card_drift(),hs.listing_cards_follow(),hs.policy_cards_follow()
 from public,anon,authenticated,service_role;

select hs.refresh_cards(null);

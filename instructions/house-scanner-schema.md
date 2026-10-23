# House Scanner schema

The `hs` schema as the migrations in `supabase/migrations` build it, through
`20261022171317_house_scanner_location_mode.sql`. Read this before changing a table, a trigger or a `public.hs_*`
function, and update it in the same change. `instructions/house-scanner.md` has the operating rules.

- `hs` is not exposed through the API. Row-level security is on for every table, with no policies. The app, the
  Edge Functions and the collector reach the data only through `public.hs_*` functions, which are `security definer`
  and check membership or the ingest key themselves.
- 24 tables in five areas: households and people; search profiles; member marks (favorites, hides, notes, manual
  homes); the catalog and its ingest pipeline; and the read model that the snapshot reads.
- To check that this page is current, compare its tables and columns with
  `select table_name, column_name, data_type from information_schema.columns where table_schema='hs' order by 1, ordinal_position;`
  on a PGlite database built from all migrations (as the tests in `supabase/tests` do) or on hosted.

## Areas

`profiles.criteria.geography.mode` is optional: `municipalities` matches the
selected municipality names; `radius` matches the saved center and radius.
Missing mode keeps the earlier municipality-or-radius behavior. The client
applies geography; the database still returns candidates using its hard rules.
`hs.valid_criteria` validates the optional mode before applying the existing
strict checks. The migration changes no profile values or grants. Deploy the
client before allowing profiles to save the new field.

| Area | Tables | Written by | Read by |
| --- | --- | --- | --- |
| Households and people | `households`, `members`, `invitations`, `admin_log` | onboarding and settings functions (`hs_invitation_*`, `hs_household_*`, `hs_member_*`) | every member function checks `members`; `admin_log` is for the owner only |
| Search profiles | `profiles`, `profile_versions` | `hs_save_profile` (each save keeps the old version) | the read-model triggers, the snapshot |
| Member marks | `favorites`, `hidden_listings`, `notes`, `manual_listings` | `hs_set_favorite(s)`, `hs_set_hidden`, `hs_save_note`, `hs_add_manual`, `hs_update_manual`, `hs_delete_manual` | the snapshot |
| Catalog and ingest | `sources`, `source_policies_archive`, `ingest_credentials`, `ingest_nonces`, `runs`, `batches`, `staged_observations`, `editions`, `listings`, `listing_changes`, `observations`, `neighborhoods`, `neighborhood_shapes` | `hs_ingest` (called by the `house-scanner-ingest` Edge Function for the collector), operator policy changes | the read-model triggers |
| Read model | `listing_cards`, `household_listings` | triggers only, never written directly | `hs_household_snapshot`, `hs_household_start` |

## Households, people and member marks

`listings` and `auth_users` (Supabase `auth.users`) are shown only as references here; `listings` is detailed in the
catalog diagram.

```mermaid
erDiagram
  households {
    uuid id PK
    text name
    timestamptz archived_at
  }
  members {
    uuid household_id FK,PK
    uuid user_id FK,PK
    text display_name
    text role
    boolean active
  }
  invitations {
    uuid id PK
    text purpose
    uuid issued_by FK
    uuid household_id FK
    text email
    text token_hash UK
    timestamptz created_at
    timestamptz expires_at
    timestamptz revoked_at
    timestamptz redeemed_at
    uuid redeemed_by FK
  }
  profiles {
    uuid id PK,UK
    uuid household_id FK,UK
    integer revision
    text name
    boolean enabled
    jsonb criteria
    uuid edited_by FK
    timestamptz edited_at
  }
  profile_versions {
    uuid profile_id FK,PK
    uuid household_id FK
    integer revision PK
    jsonb value
  }
  manual_listings {
    uuid id PK,UK
    uuid household_id FK,UK
    uuid added_by FK
    text canonical_url UK
    jsonb value
    timestamptz observed_at
    timestamptz last_checked_at
    timestamptz first_seen_at
    timestamptz last_changed_at
  }
  favorites {
    uuid household_id FK
    uuid listing_id FK
    uuid user_id FK
    text bookmark_url
    timestamptz saved_at
    uuid manual_listing_id FK
  }
  hidden_listings {
    uuid household_id FK
    uuid listing_id FK
    uuid user_id FK
    timestamptz hidden_at
    uuid manual_listing_id FK
  }
  notes {
    uuid household_id FK
    uuid listing_id FK
    uuid user_id FK
    text bookmark_url
    text body
    integer revision
    timestamptz edited_at
    uuid manual_listing_id FK
  }
  household_listings {
    uuid household_id FK,PK
    uuid listing_id FK,PK
    boolean matches
    boolean touched
    boolean hidden
    bigint changed_seq
  }
  admin_log {
    bigint id PK
    timestamptz logged_at
    uuid household_id
    text action
    uuid subject_user_id
    jsonb detail
  }
  members ||--o{ favorites : "household_id+user_id"
  listings ||--o{ favorites : "listing_id"
  manual_listings ||--o{ favorites : "manual_listing_id+household_id"
  members ||--o{ hidden_listings : "household_id+user_id"
  listings ||--o{ hidden_listings : "listing_id"
  manual_listings ||--o{ hidden_listings : "manual_listing_id+household_id"
  households ||--o{ household_listings : "household_id"
  listings ||--o{ household_listings : "listing_id"
  households ||--o{ invitations : "household_id"
  auth_users ||--o{ invitations : "issued_by"
  auth_users ||--o{ invitations : "redeemed_by"
  members ||--o{ manual_listings : "household_id+added_by"
  households ||--o{ manual_listings : "household_id"
  households ||--o{ members : "household_id"
  auth_users ||--o{ members : "user_id"
  members ||--o{ notes : "household_id+user_id"
  listings ||--o{ notes : "listing_id"
  manual_listings ||--o{ notes : "manual_listing_id+household_id"
  profiles ||--o{ profile_versions : "profile_id+household_id"
  members ||--o{ profiles : "household_id+edited_by"
  households ||--o{ profiles : "household_id"
```

- A member is a `(household_id, user_id)` pair. Profiles, marks and manual homes reference that pair, so a row can only
  belong to someone who is a member of the same household.
- `favorites`, `hidden_listings` and `notes` point at either a catalog home (`listing_id`) or a household's own manual
  home (`manual_listing_id`, together with `household_id`). A check constraint requires exactly one of the two.
- `invitations.purpose` is `create` (a new household, no `household_id`) or `join` (an existing household, with an
  email). Only the token's hash is stored.
- `admin_log` has no foreign keys on purpose, so the history outlives what it names. It holds no emails, secrets or
  criteria.
- `household_listings` belongs to the read model below.

## Catalog, ingest and read model

```mermaid
erDiagram
  sources {
    text source_id PK
    boolean enabled
    array listing_origins
    array image_origins
    text cursor
    uuid latest_run_id FK
  }
  ingest_credentials {
    text key_id PK
    array source_ids
    array scopes
    timestamptz revoked_at
    timestamptz expires_at
  }
  ingest_nonces {
    text key_id FK,PK
    text nonce PK
    timestamptz used_at
  }
  runs {
    uuid id PK
    text key_id FK
    array source_ids
    text state
    text begin_hash
    text publish_hash
    jsonb results
    timestamptz created_at
  }
  batches {
    uuid id PK
    uuid run_id FK
    text source_id FK
    text body_hash
  }
  staged_observations {
    uuid run_id FK,PK
    text source_id FK,PK
    text source_listing_id PK
    text episode_id PK
    timestamptz observed_at PK
    jsonb value
    text content_hash
  }
  observations {
    uuid id PK
    uuid listing_id FK
    uuid run_id FK
    jsonb value
    timestamptz received_at
    text content_hash
  }
  editions {
    uuid id PK
    uuid run_id FK,UK
    timestamptz published_at
    text coverage
    text source_summary
  }
  listings {
    uuid id PK
    text source_id FK,UK
    text source_listing_id UK
    text episode_id UK
    jsonb value
    integer revision
    bigint previous_asking_price
    timestamptz previous_price_observed_at
    timestamptz observed_at
    timestamptz last_checked_at
    text neighborhood_id FK
    timestamptz first_seen_at
    timestamptz last_changed_at
    uuid first_seen_run_id FK
    array neighborhood_candidates
    integer neighborhood_radius_m
    integer missed_full_reads
    timestamptz delisted_at
    text content_hash
  }
  listing_changes {
    bigint id PK
    uuid listing_id FK
    uuid run_id FK
    timestamptz observed_at
    text field
    jsonb old_value
    jsonb new_value
  }
  listing_cards {
    uuid listing_id FK,PK
    text source_id
    text title
    text source_url
    jsonb facts
    jsonb conflicts
    jsonb coordinates
    jsonb evidence
    jsonb photo
    jsonb viewings
    bigint previous_asking_price
    timestamptz previous_price_observed_at
    timestamptz observed_at
    timestamptz first_seen_at
    timestamptz last_changed_at
    timestamptz last_checked_at
    uuid first_seen_run_id
    timestamptz delisted_at
    text neighborhood_id
    array neighborhood_candidates
    integer neighborhood_radius_m
    boolean listed
    interval retention
    bigint changed_seq
  }
  neighborhoods {
    text id PK
    text name
    text dataset_version
  }
  neighborhood_shapes {
    text neighborhood_id FK,PK
    integer part PK
    polygon outline
    array holes
    polygon outline_metres
    array holes_metres
    box outline_box
    box outline_metres_box
  }
  runs ||--o{ batches : "run_id"
  sources ||--o{ batches : "source_id"
  runs ||--o| editions : "run_id"
  ingest_credentials ||--o{ ingest_nonces : "key_id"
  listings ||--o| listing_cards : "listing_id"
  listings ||--o{ listing_changes : "listing_id"
  runs ||--o{ listing_changes : "run_id"
  runs ||--o{ listings : "first_seen_run_id"
  neighborhoods ||--o{ listings : "neighborhood_id"
  sources ||--o{ listings : "source_id"
  neighborhoods ||--o{ neighborhood_shapes : "neighborhood_id"
  listings ||--o{ observations : "listing_id"
  runs ||--o{ observations : "run_id"
  ingest_credentials ||--o{ runs : "key_id"
  runs ||--o{ sources : "latest_run_id"
  runs ||--o{ staged_observations : "run_id"
  sources ||--o{ staged_observations : "source_id"
```

- A collector run is `runs` (state `staging`, then `published` or `failed`). Each request body is recorded once in
  `batches`, keyed by its hash, so a retried request is not applied twice. `ingest_nonces` stops replays.
- Observations wait in `staged_observations` until publish. Publish upserts `listings`, records field-level changes
  in `listing_changes`, and writes one `editions` row for the run.
- `listings.value` is the source's JSON as the ingest contract defines it (facts, coordinates, photo, evidence,
  viewings). One home on one source is `(source_id, source_listing_id, episode_id)`; a relisting is a new episode.
- `observations` is legacy: publish wrote full copies there until 22 October 2026. It is read-only now, replaced by
  `listing_changes`, and due to be dropped.
- `sources` holds each source's on/off switch (`enabled`) and the hosts its listings and images may come from.
  `latest_run_id` is kept by a trigger on `runs`. `hs.admin_set_source` adds a source or switches one. The policies
  they replaced are kept in `source_policies_archive` for the rollback of 20261023150000.
- `neighborhood_shapes` stores each area's polygons in degrees and in metres, with bounding boxes for the GiST
  pre-filter. A trigger assigns `listings.neighborhood_id` and the candidates when coordinates change.

## How the read model stays current

`listing_cards` holds one card per listing, keeping only what its source's hosts allow. `household_listings` holds, per household, each listing it
could see and why: `matches` (passes an enabled profile's hard rules), `touched` (favorited or noted) and `hidden`.
Both tables are derived. Never write them directly.

| Change | Trigger | Effect |
| --- | --- | --- |
| `listings` insert or update | `listing_cards_insert`, `listing_cards_update` | rebuild the changed cards |
| `sources` hosts change | `source_cards` | rebuild that source's cards |
| `listing_cards` insert or update | `card_households_insert`, `card_households_update` | re-match those listings for every household |
| `profiles` change | `profile_households` | re-match that household |
| `favorites`, `notes`, `hidden_listings` change | `favorite_households`, `note_households`, `hide_households` | update `touched` and `hidden` |
| `runs` publish (`staging` to `published`) | `expire_household_listings`, `mark_delisted`, `record_latest_run` | remove rows past retention that nobody saved, noted or hid; mark delistings and relistings with the run that decided them; record the source's latest run |

- The card triggers run once per statement over its transition table, so a publish refreshes in a few set-based
  statements. The profile and mark triggers run per row. All of them write a row only when it differs.
- Manual homes have no rows in either table; the snapshot reads them from `manual_listings`.
- `changed_seq` on both tables stamps each change. Nothing reads it yet; it is there for sending only what changed.
- Rules that depend on the clock stay in the snapshot query, not in the stored rows: retention, photo expiry, when
  coordinates and evidence were observed, viewing start times, and whether the source is switched on. Retention is
  14 days for every source (`hs.retention()`).
- `hs.card_drift()` and `hs.household_drift()` compare the stored rows with a fresh computation. Both must return
  nothing after any migration or data repair that touches these tables.

## Entry points

All are `public.hs_*` functions; the tables are never queried directly by a client.

| Caller | Functions |
| --- | --- |
| Signed-in member (`authenticated`) | `hs_household_start`, `hs_household_snapshot`, `hs_memberships`, `hs_household_access`, `hs_set_favorite`, `hs_set_favorites`, `hs_set_hidden`, `hs_save_note`, `hs_save_profile`, `hs_add_manual`, `hs_update_manual`, `hs_delete_manual`, `hs_household_rename`, `hs_household_leave`, `hs_member_make_owner`, `hs_member_deactivate`, `hs_invitation_create`, `hs_invitation_preview`, `hs_invitation_redeem`, `hs_invitation_revoke` |
| Edge Functions (`service_role`) | `hs_ingest`, `hs_ingest_credential`, `hs_ingest_sources`, `hs_consume_nonce`, `hs_invitation_reserve` |

The operator's `hs.admin_*` functions are not granted to any API role; the owner runs them from the SQL editor.

Migration 20261023150017_house_scanner_eight_photos raises hs.assert_observation to accept a lead photo plus seven additional photos (eight total), with a separate floor plan. Its rollback restores the four-photo ingest limit without deleting stored galleries. Redeploy the ingest Edge Function before the migration and update the collector after it. The app already accepts up to ten photos.

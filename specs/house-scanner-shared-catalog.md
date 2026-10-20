# House Scanner shared listing catalog

Status: draft. S1 detailed below, awaiting owner confirmation.

## Goal

Collect each broker listing once and let independent households browse the same catalog through their own saved criteria. Household activity stays visible only to members of that household.

## Current behavior

- `hs.listings`, observations, source policies, runs, batches, editions, ingest credentials, and retention are scoped to a household. An ingest credential publishes into one household. Ingest, the retention purge, and favorite and note writes serialize on the household row lock.
- Manual listings share `hs.listings` with source listings (`origin = 'manual'`).
- `hs_snapshot` returns that household's listings before browser matching. Above 1,500 visible listings it raises, leaving the household unable to load its snapshot. The contract caps listings and hidden ids at 1,500 and favorites and notes at 5,000. The viewings, hides, notes, and neighborhood wrappers around the snapshot are also household-scoped.
- Favorites and notes belong to a member and are visible to their household. Hides belong to a member and are visible only to that member.
- The collector uses a local copy of household profiles to plan and pre-filter collection. `hs_ingest` checks enabled profile revisions at begin and publish.
- `hs_save_profile` updates an existing profile; nothing creates one outside operator bootstrap.
- `match-listing.ts` applies saved household criteria and computes labels. Listings and Map have separate temporary browse filters. The list renders cards in batches as the user scrolls, but the whole snapshot is loaded first.
- A listing past its source's retention leaves the snapshot but stays in storage. The purge function exists, but nothing schedules it.

## Acceptance cases

- Given two households, when the collector observes the same source listing and episode, the catalog stores one source listing and each household can see it if it meets that household's saved criteria.
- Given a household profile change, when its members load listings, their view reflects the new criteria without a collector run or profile revision sync. A listing outside all enabled profiles stays out of normal browse results.
- Given a household whose saved criteria select some sources, when its members load listings, only those sources' listings appear in normal browsing. Collection is unchanged.
- Given a listing with an unknown or disputed hard fact, household candidate selection keeps it for the existing Missing info behavior rather than silently excluding it.
- Given a favorite or note in one household, members of that household can see the person's attribution, while members of another household cannot see the activity.
- Given a hide by one member, the listing leaves normal browsing for every member of that household. A favorite remains accessible in Favorites with `Hidden by <member>` and either member can unhide it. Another household's view is unaffected.
- Given a manual listing, only its household can access it.
- Given a household whose result set exceeds the snapshot ceiling, members can still browse the full eligible set without a failed snapshot or silent truncation.
- Given a source listing past normal retention, a favorite or nonblank note keeps it accessible to the household that saved it without exposing that household's activity or expired content to another household.
- Given a listing that leaves its source, members see it marked as no longer listed, with sold or removed when the source says which. A listing missing from a partial or truncated run is not marked.

## Decisions and boundaries

- Broker listings and their observation history form a shared catalog. Source identity remains source ID, source listing ID, and episode; cross-source lookalikes are not merged merely because they resemble one home.
- Listing content belongs to its source. The app shows it for display only, with the source named and a link to the source's own page. A source policy's rights basis records that, not a household's personal-use claim.
- The collector collects from every approved source regardless of household settings. Source policies become rules about each source (allowed facts, retention, image display, origins) and no longer belong to a household. Households have no per-source access setting.
- Saved household criteria may include a set of source IDs, chosen from the sources the collector supports. It filters what the household sees and never affects collection.
- Households retain members, profiles, favorites, notes, and manual listings. Favorites and notes keep member attribution. Hides become one household state per listing, with the member and time of the latest hide.
- Manual listings move to their own household-owned table so the catalog holds no private rows. Favorites, notes, and hides reference either a catalog listing or a manual listing, exactly one.
- The collector's search criteria define catalog coverage independently of household criteria. Household filter criteria may request any range and are applied to available catalog data. No coverage warning or automatic collector expansion is required. Ingest stops checking profile revisions; the collector stops reading household profiles.
- The household listing response reads the household's saved criteria in the database and returns only candidates. It drops a listing only when a known, undisputed fact fails a hard rule of every enabled profile: property type, living area, rooms, stretch price, selected sources, rental, not for purchase, or sold or withdrawn. Soft preferences, caveats, and geography stay in the client matcher, so Missing info and Close to your criteria keep working. Favorited, noted, hidden, and manual listings are always returned. Temporary Listings and Map filters remain a separate client layer.
- The collector pre-filter, the client matcher, and the SQL candidate filter share one set of test cases so their hard rules cannot drift.
- Do not create a household-listing row for every matching catalog listing. Store household-to-listing references when a member favorites, notes, or hides a listing.
- A fixed snapshot ceiling must not make an otherwise valid household unusable. Delivery should load more as the user scrolls, like the current list batching, rather than numbered pages. Raising the ceiling alone does not solve growth.
- Retention is unchanged in this work: a listing past retention leaves browsing but stays in storage, so it can be shown again later. No garbage collection, no scheduled purge, and no automatic hiding of homes that are still listed.
- A household needs saved criteria before it can see catalog listings. Household creation in `specs/household-onboarding.md` must create them; invitations and accounts stay in that spec.
- This spec does not authorize hosted migration, live collection, or deployment.

## S1 in detail: the catalog migration

S1 moves storage and ingest to a shared catalog in one migration. The snapshot keeps its current output shape, so the shipped app needs no change and still sees exactly what it sees today. Filtering by saved criteria (S2), shared hides (S3), and the no-longer-listed state (S4) come later.

### Tables after S1

| Table | Change |
| --- | --- |
| `hs.source_policies` | Keyed by `source_id` alone; `household_id` dropped. Same policy JSON, checks and cursor. |
| `hs.ingest_credentials` | `household_id` dropped. Key ids, secrets, scopes, expiry and revocation unchanged. |
| `hs.runs` | `household_id` and `profile_versions` dropped. |
| `hs.batches`, `hs.staged_observations`, `hs.editions` | `household_id` dropped; foreign keys point at the catalog tables. |
| `hs.listings` | Becomes the catalog: source listings only. `household_id`, `origin`, `added_by` and `canonical_url` dropped. Unique on `(source_id, source_listing_id, episode_id)`. Neighborhood and discovery columns and triggers kept. |
| `hs.observations` | `household_id` dropped. |
| `hs.manual_listings` (new) | Household-owned: `id`, `household_id`, `value`, `added_by`, `canonical_url`, `observed_at`, discovery and neighborhood columns. Unique on `(household_id, canonical_url)`. Existing manual rows move here with their ids. |
| `hs.favorites`, `hs.notes`, `hs.hidden_listings` | Keep `household_id` and `user_id`. `listing_id` (catalog) and new `manual_listing_id` are both nullable with a check that exactly one is set, unique per household, member and listing. Hides stay per member until S3. |
| `hs.households`, `hs.members`, `hs.profiles`, `hs.profile_versions`, `hs.neighborhoods`, `hs.admin_log` | Unchanged. |

Row level security stays on every table and grants stay revoked; browser access goes through checked functions only, as today.

### Functions after S1

- `hs_ingest`, `hs_ingest_credential`, `hs_ingest_policies`, `hs_consume_nonce`: no household and no profile check. Ingest takes a catalog-wide transaction lock (`pg_advisory_xact_lock`) instead of the household row lock. Policy checks, staging, publish, price history and edition rules are otherwise unchanged.
- `hs.snapshot_base` and its wrappers (viewings, hides, notes, neighborhoods, `isNew`): household-scoped output as today. A catalog listing is included when its source policy is current and it is within retention, or when the household has a favorite or nonblank note on it. Manual listings come from the household's own table. `householdId` in each listing is the requesting household, so the contract does not change. `isNew` uses the latest catalog run per source.
- `hs_set_favorite`, `hs_save_note`, `hs_notes`, `hs_set_hidden`, `hs_add_manual`, `hs.listing_interacted`: accept a listing id from either table and write the matching column. A catalog listing can be favorited, noted or added only while the household can see it. They keep the household lock; with the purge gone, no catalog lock is needed there.
- Operator functions: `hs.admin_set_source_policy(policy)` and `hs.admin_issue_credential(key_id, source_ids, expires_at)` lose the household argument. `hs.admin_set_member` clears favorites and notes through the new columns.
- `hs.purge_expired` and `hs_purge_expired` are dropped. They are household-scoped, unscheduled, and retention is now hide-only. A catalog purge can be designed later if storage needs it.

### Ingest contract and collector

- The begin request's `profileVersions` becomes optional and is ignored, then removed after the collector stops sending it. The ingest function stops expecting `householdId` from the credential lookup.
- The collector no longer needs `--profiles`. Its bounds become constants beside the pre-filter: GÃ¶teborg, apartments and houses, at least 60 mÂ², known asking prices 2M through 6M SEK, any room count; unknown or disputed values pass. The query planner takes its municipality from the same constants. The private profiles file and the `--profiles` argument in `run-collector.ps1` are retired.

### Data move

Today one household holds every row, so the move is mechanical and keeps every id. The migration first asserts that exactly one household owns source listings and that no source identity repeats, and stops if either fails. Then it copies policies, moves manual listings to their table, rewrites activity references, and drops the household columns, all in one transaction.

### Release order

1. Ingest function that accepts requests and credential rows with or without the household and profile fields.
2. The migration, with its history row.
3. The collector without profiles; a no-send build check, then the next scheduled run.

The app needs no release for S1. Each hosted step needs the owner's go-ahead.

### Checks

- PGlite suites (`supabase/tests/`) updated: two households see the same catalog listing once; activity stays inside its household; manual listings stay private; a stale profile revision no longer rejects a run; the snapshot output for the existing household is unchanged before and after the data move.
- Ingest function tests, collector tests, `npm run typecheck`, `npm run house-scanner:typecheck`.
- A rollback that restores the household columns, valid while one household owns all data.

### Not in S1

Filtering by saved criteria and scroll loading (S2), shared hides with attribution and the source filter in Settings (S3), no-longer-listed (S4), onboarding (S5), any purge or retention change.

## Slices

| ID | Outcome | Depends on | Owned paths or boundary | Check | State |
| --- | --- | --- | --- | --- | --- |
| S1 | Store source listings and history once, with source policies and collection independent of households and profiles; manual listings in their own table | none | `supabase/migrations/`, ingest function, collector contract and CLI | See S1 checks above | built locally, not released |
| S2 | Deliver household candidates filtered by saved criteria in the database, loaded as the user scrolls, without a fixed-count failure | S1 | listing RPCs, client API and contract, browse loading | Two households receive their own eligible results; saved listings outside criteria are included; results above the ceiling remain browsable | pending |
| S3 | Shared hides with attribution and a source filter in saved criteria | S1, S2 | hides, criteria schema, Settings, cards | Cross-household isolation and favorite/hide conflict cases | pending |
| S4 | Mark listings that leave their source | S1 | ingest publish, listing contract, cards | Sold, removed, and merely unseen cases; partial runs mark nothing | pending |
| S5 | Reconcile household creation and verify end-to-end behavior | S1, S2, S3 | `specs/household-onboarding.md`, onboarding, integration checks | A new household gets saved criteria and browses existing eligible catalog listings | pending |

## Open questions

- S2 delivery: counts, sections and the map need every candidate, while cards only need the visible ones. One shape is a light row per candidate (id, facts, coordinates, source) loaded at once, with photos, evidence, viewings and neighborhood candidates fetched as cards scroll into view. A household's 547 listings were about 1 MB uncompressed and took 441 ms on 20 October 2026; measure again after the 60 mÂ² collector bounds run.
- How to tell sold from removed per source: some report a sold status, others only stop listing the home. Every source currently publishes partial coverage, so absence needs a rule, such as several consecutive runs that reached the source's reported total.
- Policies' existing rights basis text should be reworded to the display-only basis above when S1 copies them.

## Progress

- 19 October 2026: the current schema, ingest path, matcher, snapshot limit, and retention rules were inspected.
- 20 October 2026: claims above were verified against the migrations, the ingest function, the purge, the snapshot RPCs, and the matcher. The owner decided the source, filtering, manual listing, retention, display-only and no-longer-listed rules above.
- 20 October 2026: as a stopgap, the snapshot ceiling was raised from 1,000 to 1,500 (PR #7, migration `20261020120000_house_scanner_snapshot_limit_1500`), deployed and applied to the hosted project. The household loaded 547 listings afterwards.
- 20 October 2026: S1 built on branch `codex/house-scanner-shared-catalog` (commit 39e72c9, PR #8), local only. Migration `20261020150000_house_scanner_catalog.sql` with rollback; ingest function accepts both credential shapes and an optional `profileVersions`; collector bounds are constants in `tools/house-scanner/prefilter.ts`, `--profiles` is accepted and ignored, `--print-policy-sql` no longer takes `--household`. New suite `supabase/tests/house-scanner-catalog.test.ts` seeds one household on the old schema, applies the migration and checks every member's snapshot is identical, then covers a second household, isolation, ingest without profiles, admin functions, grants, the one-household guard and the rollback. The older suites still pin the migrations before the catalog. All 1,501 tests and four typechecks pass. Not done: the rights-basis rewording (an operator policy update), purging consumed ingest nonces (the dropped purge did it; the table grows by a few rows per run).
- 20 October 2026, released with the owner's go-ahead: the ingest function deployed as version 12 (boots; unsigned requests still get 405 and 401). All hosted `hs` rows were copied to a private local backup first. The migration was applied in one transaction with its `schema_migrations` row. Every active member's `hs_snapshot` and `hs_snapshot_neighborhoods` output hashed the same before and after (four members, 547 listings), and `hs_ingest_credential` returns the catalog shape. The security advisor shows only the intended no-policy `hs` tables and household RPCs, plus two findings that predate this work: `public.rls_auto_enable()` executable by anon and leaked password protection off. Step 3 below is still open.
- Release, each step with the owner's go-ahead: (1) deploy the ingest function; (2) apply the migration and add its `schema_migrations` row; (3) merge to main and remove `--profiles` from `run-collector.ps1`. The collector must not run from this code before step 2, because the old database requires profile versions.

# Göteborg neighborhood polygons

Source: Göteborgs Stad, Statistik och analys, [Göteborgs områdesindelning](https://goteborg.se/wps/portal/enheter/statistik-och-analys/geografi-och-kartor/goteborgs-omradesindelning).

The source page publishes the 96 official primärområden as shapefiles under CC0 1.0. This copy uses the boundaries valid from 1 January 2025, downloaded on 19 October 2026 (ZIP SHA-256 `b472ee6b722f71edf4324d1c4bc72ab21e48c194a18fd75ac7f39753f7285702`). Names and three-digit area codes are kept unchanged. IDs prefix the official code with `goteborg-`.

Download: [Primärområde_shp.zip](https://goteborg.se/wps/wcm/connect/bb19f99a-0a4a-43b1-ab9d-2ee89818ed4b/Prim%C3%A4romr%C3%A5de_shp.zip?MOD=AJPERES).

`goteborg-neighborhoods.geojson` is the full polygon and multipolygon geometry, including holes. The source projection is SWEREF 99 12 00 (EPSG:3007). Coordinates were transformed to WGS84 longitude/latitude (EPSG:4326) and rounded to seven decimals, without simplifying boundaries. The browser imports only the small `assets/neighborhoods.json` name catalog; geometry stays out of the app bundle.

To regenerate from the official ZIP, install Python `pyshp` and `pyproj` in a temporary environment and run `python tools/house-scanner/import-neighborhoods.py <download.zip>` from the repository root, then format the name catalog with `npx biome format --write src/features/house-scanner/assets/neighborhoods.json`. No listing data is needed.

## Apply and verify

The schema migration adds a nullable `neighborhood_id` and a trigger for inserts and coordinate updates. The original `hs_snapshot` response stays unchanged. New clients call `hs_snapshot_neighborhoods`; they fall back to `hs_snapshot` only when the new function is missing.

1. Apply `supabase/migrations/20261019073251_house_scanner_neighborhoods.sql` as a migration.
2. Generate the reference-data load and backfill outside the repository:
   `node tools/house-scanner/neighborhoods-sql.mjs <temporary-output.sql>`
3. Review it, then apply using `supabase db query --linked --project-ref <project-ref> --file <temporary-output.sql>`. It replaces reference shapes and recalculates assignments in one transaction, and can be repeated safely.
The Management API rejects the full 3.7 MB seed. For that route, run `node tools/house-scanner/neighborhoods-sql.mjs --chunked <temporary-directory>` and apply its SQL files in filename order with the same CLI flags. Uploads contain public reference SQL only, in a private table with browser access revoked. The last file verifies that the complete upload matches its expected hash, runs the original reference load and backfill in one transaction, and removes the upload table. An interrupted upload changes no assignments; rerun from `000-start.sql`.

4. Check `select count(*) from hs.neighborhoods;` returns 96, then `select count(*) filter (where neighborhood_id is not null) as assigned, count(*) as total from hs.listings;`.
5. Verify old and new snapshots as an active member; the new response includes area names and the old one omits them. Anonymous users and nonmembers must be denied.

Source address/building and precise user-supplied coordinates qualify. The legacy primary area chooses the lowest official code on a shared boundary; it remains for older clients. Candidate assignments below preserve all intersecting areas. Generic approximate-area centroids, missing coordinates and positions whose point/buffer misses the official boundaries stay unassigned. PostgreSQL's native geometry handles polygon parts and holes without PostGIS. All neighborhood fields are omitted whenever coordinate retention hides the position.

Future collector updates are assigned by the database trigger. Collectors, source policies, ingest requests and Edge function secrets need no changes. The filter combines selected neighborhoods with OR and other filters with AND. Unassigned homes have their own inclusion option.

Rollback: revert the client and apply `supabase/rollbacks/20261019073251_house_scanner_neighborhoods_down.sql`. It removes the new endpoint and assignment trigger, preserving stored assignments and reference data. Reapply the migration functions and trigger to resume; do not rerun its `create table` and `add column` statements over existing tables.


## Discovery dates and address estimates

After the reference-data seed, apply `supabase/migrations/20261019080101_house_scanner_listing_discovery.sql`. It backfills discovery and change dates from the retained observation history, records future discoveries and changes with database triggers, and assigns neighborhoods to existing address estimates. It leaves the deployed `hs_snapshot` response unchanged. The still-unmerged `hs_snapshot_neighborhoods` release adds optional lifecycle fields alongside neighborhoods.

No collector run or Edge secret change is needed for this backfill. Future collectors reuse the geocoder cache. The latest source run is derived from published editions and successful/partial source results; failed runs do not clear New flags.

The rollback at `supabase/rollbacks/20261019080101_house_scanner_listing_discovery_down.sql` restores the previous endpoint and polygon eligibility, removes the lifecycle triggers and preserves the stored dates. See [stored listings, saves and changes](../../tools/house-scanner/README.md#stored-listings-saves-and-changes) for timestamp and price-history semantics.

Production update, 19 October 2026: both migrations are applied. Neighborhoods are assigned for 495 of 532 listings, including 51 address estimates. The remaining 37 comprise 20 street-only estimates, 16 missing positions and one outside the official boundaries. Discovery and change history was complete for all 532 records and was backfilled. The latest per-source discovery flags currently cover 182 homes. The deployed legacy response remains unchanged.

## Candidate neighborhoods

Apply `supabase/migrations/20261019083126_house_scanner_neighborhood_candidates.sql` after discovery dates. It caches every area intersecting a source point (0 m), an OpenStreetMap address estimate (50 m) or a street estimate (250 m). One, two or more areas can qualify. Filters match any candidate, and cards/details label buffered or multiple matches approximate. An explicit empty candidate list means unassigned; only an absent field falls back to the legacy primary area.

The buffers are browsing assumptions, not measured geocoding errors, confidence intervals or whole-street geometry. A long street can extend beyond the buffer. The small distances use a local planar conversion centered on 57.7° N, 12° E, with 111320 metres per latitude degree and longitude scaled by cos(57.7°). Original WGS84 geometry remains authoritative for zero-radius containment. The full public polygons stay unchanged; projected outlines/holes are private caches maintained during future seeds.

The migration backfills candidates without changing listing values, discovery dates, revisions or collector observations. Future coordinate updates recalculate them through the existing trigger. It also adds database field comments for assignment, timestamps and price history. No extra collector request, source policy, Edge deployment or secret rotation is needed.

Candidate rollback: revert the client and apply `supabase/rollbacks/20261019083126_house_scanner_neighborhood_candidates_down.sql`. This restores the preceding snapshot endpoint and single-area assignment. Candidate columns, geometry caches and their maintenance trigger remain to preserve data and support reference reseeding; candidate listing caches stop updating and are not returned. To resume, restore the candidate assignment/snapshot functions and rerun the candidate backfill, rather than the migration's additive DDL.


Candidate backfill, 19 October 2026: migration 20261019083126 is applied. Of 532 stored homes, 515 have candidates, including all 20 street estimates; 17 homes have two candidates. The remaining 17 have no qualifying intersection. The legacy primary count remains 495. Listing revisions and discovery/change/check dates are unchanged by the backfill. Authenticated SQL readback found identical 532-listing legacy content after stripping enrichment fields, with no derived-area fields exposed on redacted positions. Tests were not rerun at the owner's request.

# House Scanner browse controls and card labels

Status: draft

## Goal

Make list order explicit, put Match, Sort, and Filters together, and reduce card labels that repeat missing or routine facts.

## Current behavior

- The default sort keeps the snapshot order: collector `observed_at` descending, then listing ID. The other sorts use asking price.
- Filters already include "New in latest scan per source". This uses `isNew`, which compares the listing's discovery run with that source's latest published successful or partial run.
- `firstSeenAt` records scanner discovery. `lastCheckedAt` records when a newer observation was accepted. Neither means the broker's publication date.
- Match and Filters occupy the upper toolbar. Sort is on a lower row. The Match help button sits beside the selector.
- Card labels come from three places: known amenity facts, one matching caveat, and status badges. The status badge currently shows `unknown` because it displays every status except `available`. The card also repeats some missing facts in its text.

## Acceptance cases

- On first opening Listings, sort is Newest: known `firstSeenAt` dates descending. Missing discovery dates come last, with deterministic ties.
- Oldest reverses the known discovery dates while still putting missing dates last.
- Latest sorts by `lastCheckedAt` descending. Its label explains that this is the scanner's latest accepted check, not discovery.
- Alphabetical sorts by listing title A–Z using Swedish text order. Existing price sorts remain.
- Match, Sort, and Filters share a toolbar row when they fit. On narrow screens they wrap without horizontal overflow. The Match help control sits immediately after the Match label; its tooltip works on pointer, keyboard, and touch. Hover adds no visual background or movement; keyboard focus remains visible.
- The New-only filter remains in Filters. Newest does not use `isNew`, and changing sort does not alter the visible set.
- Compact cards do not show an `Unknown` status badge. Missing status remains available in details.

## Decisions and boundaries

- Newest, Oldest, Latest, Alphabetical, and the two price directions are the proposed sort choices. Newest is the default.
- The toolbar change affects the list controls; the map does not gain a spatial sort.
- Sorting and card presentation stay client-side. Discovery, checking, matching, and the `New` badge keep their current database meanings.
- The card's amenity chips currently include Balcony, Terrace, Balcony and terrace, Lift, Above ground floor, and Glazed. Its one caveat can be fee or monthly total above reference, lift not serving the home, access not step-free, or unglazed outdoor space. Status badges include New, non-available status, Added by, Not in latest scan, and Hidden. `Unknown` also appears as a placeholder for missing values in the facts and details.

## Slices

| ID | Outcome | Depends on | Owned paths or boundary | Check | State |
| --- | --- | --- | --- | --- | --- |
| S1 | Add the chosen list sorts and default, with stable missing-date behavior | none | `utils/browse-search.ts`, `components/listings-panel.tsx`, sorting tests | Unit and browser sort checks | pending |
| S2 | Consolidate toolbar and place Match help by its label | S1 | `components/listings-panel.tsx`, toolbar CSS, browser layout and accessibility checks | Wide and narrow browser checks | pending |
| S3 | Apply the agreed compact-card label rules | none | `utils/match-listing.ts`, `components/listing-card.tsx`, summary and tests | Card and matching checks | pending |

## Open questions

- Which compact-card labels should remain beyond positive amenities and meaningful status? In particular, should Above ground floor and fee-related caveats move to details only?
- Should alphabetical offer Z–A as well as A–Z? A–Z alone is the smaller starting option.

## Progress

Current code and hosted aggregate counts were inspected on 2026-10-19. No UI implementation has started.

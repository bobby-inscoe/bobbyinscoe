## Bobby Inscoe Site

Repository for the site at bobbyinscoe.com, built with React, TypeScript, and Vite.

## Working on the site

Start with [AGENTS.md](AGENTS.md) for the repository workflow and
[architecture](instructions/architecture.md) for code placement. Feature ideas become
specs under `specs/` when their behavior is clear enough to review. Specs stay on
the working machine and are not committed. An agent there can continue a ready
spec from a new conversation without a pasted implementation prompt.

## Local development

Install dependencies, then start the Vite development server:

```sh
npm install
npm run dev
```

Open http://localhost:5173. The page reloads automatically as source files change.

Other useful commands:

```sh
npm run build    # Create a production build in dist/
npm run preview  # Serve the production build at http://localhost:4173
npm run start    # Alias for npm run dev
npm run typecheck # Check TypeScript types
```

GitHub Pages hosts the deployed production build; it is not used for local development.

## Textile workshop experiment

The experimental portfolio opens at `/`; Duck Feed remains playable at
`/duck-feed`. The workshop code and content live in `src/features/workshop/`.

## House Scanner browsing

House Scanner opens at `/projects/house-scanner/listings`. Favorites, viewings,
adding links, sources and settings have their own routes. Listing titles and
photos open `/projects/house-scanner/listings/:listingId`; private details still
require household access. Filters, sort order and list/map mode live in the URL.
Browser Back closes detail and filter views before returning to earlier results.

Use **Select** to hide up to 500 matching homes at once. **Select unsaved** excludes
every household member's favorites; explicitly selected favorites remain saved
when hidden. Hides are personal. **Undo hide** restores the last batch during the
session, and **Filters → Hidden homes** provides recovery later. Undo uses the
existing last-write-wins endpoint, so it cannot detect a newer hide on another
device. Street view is the default map; filled and outlined stars distinguish
your favorites from those saved by other household members.

On phones, Map fills the screen with List, Filters and selection controls above
it. The compact preview opens full details; List restores normal page browsing.
Homes without a precise position appear under **Not located**, with no invented
pin or influence on the map bounds. Selecting one leaves the camera in place.

Nearby homes share a count marker when zoomed out. Pin fill shows whether you
or another household member saved any home in the group. Tap it or press Enter to zoom in. Homes at the exact same
position keep their individual picker. Map selection always uses each home's
original position, even when its marker is part of a cluster.

In map selection mode, tapping an individual pin toggles its checkbox and updates
its preview. A shared pin opens a chooser with photos and facts. Save
adds the selected homes to your favorites; Hide affects only your account and
keeps Undo. Existing favorites are never toggled off by bulk save. Bulk save uses
the existing per-home API and refreshes the snapshot once after the batch; a
failure reports confirmed saves and lets you retry the remaining homes. Save
feedback stays visible across tabs. Bulk Save waits for pending favorite changes
on checked homes.

Use **Review this area** to capture homes clear of the map controls and preview
for a separate hide review. Review the checkboxes before hiding. Saved homes
start unchecked; estimated and missing locations are excluded. The captured set
does not grow when the map moves, and each batch is limited to 500 homes.

Open **Pin guide** for examples: dark fill means saved by you; pale fill means
saved by another member; plain pins are unsaved. A checkmark shows batch
selection, with a dash for partially selected groups. Opening a preview adds no
ring. The guide explains prices and unknown values on separate lines.

Filters includes a searchable multi-select for Göteborg's 96 official
primärområden. Approximate positions can have several candidate neighborhoods; selecting any candidate includes the home. Address and street estimates use documented browsing buffers. Selected neighborhoods combine with OR; other filters still apply.
Unassigned homes have a separate include option. Names appear on cards and the
selection stays in the URL. The [polygon data and rollout notes](supabase/data/readme.md)
cover provenance, database backfill and rollback.

New marks homes first found in the latest scan of their source. Filters → Latest
can select that group or homes first found in the last 1, 3 or 7 days. Discovery,
change and check times appear in details; a refresh does not make an old home new.
See [collector persistence](tools/house-scanner/README.md#stored-listings-saves-and-changes)
for saved/hidden behavior and price history.

Run `npm test` for unit checks and `npm run test:browser` for desktop and mobile
browser checks. The browser suite requires Microsoft Edge and uses fictional
household data. Its output is excluded from Vite's file watcher to prevent test
artifacts from reloading the app.

## UI components

Use [Mantine Core](https://mantine.dev/core/package/) for controls and layouts.
The provider is already installed for every route. Import components directly
from `@mantine/core` and hooks from `@mantine/hooks`.

- Theme and component defaults: `src/app/theme.ts`.
- Responsive dialog and layout example: `src/features/workshop/components/project-folio.tsx`.
- Radio groups, buttons, and a tooltip: `src/features/duck-feed/components/start-screen.tsx`.

Use component props for spacing, sizing, colours, and typography. Keep custom CSS
for the workshop's perspective, material treatment, and game motion. No additional
Mantine styles import is needed when using another core component.

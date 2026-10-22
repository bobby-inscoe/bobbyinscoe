# Architecture

This is a React site organized by user-facing capability. This map describes
the current repository; update it when a boundary changes.

## Where code lives

| Path | Owner |
| --- | --- |
| `src/app/` | App shell, theme, and composition of top-level route trees |
| `src/features/workshop/` | Portfolio at `/` and its visual interaction |
| `src/features/duck-feed/` | Game at `/duck-feed` |
| `src/features/house-scanner/` | Shellter (House Scanner) browsing, household UI, and its nested theme |
| `src/assets/` | Assets shared by the application |
| `tools/house-scanner/` | Collector and its acceptance harness |
| `supabase/` | Database migrations, functions, and data notes |
| `verification/` | Types used by verification code |

Keep a feature's components, hooks, routes, data, types, utilities, assets, and
tests with that feature. Create only the subdirectories needed. The app may
import feature route trees. A feature may import shared code, but not another
feature's internal files. If two features need the same stable concept, move
that concept to an appropriate shared location; do not move feature behavior
just to avoid an import. Shared code must not import a feature or the app.

## Styling

Every project inherits the root Mantine theme. `src/app/theme.ts` holds it,
`src/app/colors.ts` holds its palettes and CSS variables, and
`src/app/theme.css` holds the rules that must be global (fonts, reset, link and
focus styling). `src/index.tsx` imports that file first so project stylesheets
cascade after it.

Shellter is the only project with a nested theme:
`src/features/house-scanner/theme/shellter-theme.ts` wraps the page in
`MantineThemeProvider`, and `shellter.module.css` beside it is its one CSS
module. The theme's `Portal` defaults carry Shellter's scope class onto every
dropdown, menu, modal, and drawer, so call sites do not set `withinPortal`.
Shellter components take layout classes from the theme file as `classes` and
do not import CSS. Shellter is a standalone brand: its module defines its own
palette and its font (Nunito Sans, in `src/assets/fonts/nunito-sans/`) inside
its scope. The workshop and Duck Feed keep their own stylesheets, scoped
to their root class.

## Shellter translations

`src/features/house-scanner/i18n/` owns Shellter's React Intl provider,
local language preference, and translations. `en.ts` and `sv.ts` export matching
nested language objects. Their shapes are composed from separate capability
types under `i18n/types/`. Keys stay in English in both languages, with paths
such as `listings.list`, `listings.map`, `viewings`, `settings.criteria` and
`common`. `catalogs.ts` flattens those objects once for React Intl.

Use `FormattedMessage` for JSX text and `useIntl().formatMessage` for strings.
Store message IDs and values in feedback state so existing messages can change
language. Pass the active intl object to presentation helpers. Domain values,
user content, broker text, and legal attribution keep their original values.
The provider wraps only Shellter, and `shellter.language` is independent of
household data and authentication storage.

## Routing

`src/app/router.ts` creates the root route and composes the workshop, Duck Feed,
and House Scanner route trees. Each routed feature owns its route modules and
`routes/route-tree.ts`. House Scanner composes its child routes inside its own
tree. Route modules are `.ts` files that reference components; JSX stays in
components.

Route factories accept the parent route as a generic type parameter:
`<TParent extends AnyRoute>(parentRoute: TParent)`. Using bare `AnyRoute` for
the parameter erases the literal path types used by links and navigation.
Keep the parent-to-child dependency direction. When adding a route, follow the
nearest route tree and verify navigation and not-found behavior.

## Data and verification

House Scanner's client contract and schemas live under
`src/features/house-scanner/types/` and its API code under `api/`. Hosted
database and ingestion changes also touch `supabase/` or `tools/house-scanner/`;
read their READMEs and `instructions/house-scanner.md` before changing them.
Tests use synthetic household data. Private profiles and local notes stay in
ignored files, not tracked specs.

Vitest tests sit beside units and components. Browser flows live with House
Scanner components and use Playwright. `package.json` lists the commands; the
GitHub Pages workflow checks formatting, application and verification types,
unit tests, and the build before deploy.

Record a durable architectural decision here when it changes where future work
belongs. Keep feature-specific alternatives and acceptance cases in that
feature's spec.

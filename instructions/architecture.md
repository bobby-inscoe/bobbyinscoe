# Architecture

This is a React site organized by user-facing capability. This map describes
the current repository; update it when a boundary changes.

## Where code lives

| Path | Owner |
| --- | --- |
| `src/app/` | App shell, theme, and composition of top-level route trees |
| `src/features/workshop/` | Portfolio at `/` and its visual interaction |
| `src/features/duck-feed/` | Game at `/duck-feed` |
| `src/features/house-scanner/` | House Scanner browsing and household UI |
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

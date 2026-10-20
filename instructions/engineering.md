# Engineering standards

Always loaded and authoritative. This file is the one you edit per project.
Delete rules that do not apply rather than leaving them aspirational, because a
rule nobody enforces teaches agents that rules are optional.

## Stack

- Language and version: TypeScript
- Framework and bundler: React, bundled with Vite
- UI components: Mantine Core and Hooks 9; shared theme in `src/app/theme.ts`
- Runtime and version: Node.js `>=20.19.0`
- Package manager: npm
- Test runners: Vitest for behavior/privacy; Playwright for local browser flows
- Formatter and linter: Biome

Version constraints that agents keep getting wrong belong here. If a library is
installed but must not be used, or a major version changed the API an agent was
trained on, say so explicitly:

- All source imports use the `@/*` path alias, mapped to `./src/*` in
  `tsconfig.json` and `vite.config.ts`. Never use relative imports
  (`../../`) or a bare `src/` import.
- React 19 is installed.
- TanStack Router v1 is installed. Use its code-based route tree; route modules
  are owned by their features and composed by the application route tree.

## Commands

Agents run these instead of guessing. Keep them accurate. A wrong command here
costs more than a missing one.

```bash
# install
npm install
# run locally
npm run dev
# test (whole suite)
npm test
# browser flows (installed Microsoft Edge, local server)
npm run test:browser
# verification-code typecheck
npm run test:typecheck
# test (single file)
npm test -- path/to/file.test.ts
# lint and format
npm run check
# typecheck
npm run typecheck
# build
npm run build
```

Prefer the narrowest command that covers the change. Run the full suite before
declaring a task complete, not after every edit.

## Architecture

Organize by feature, not by file type. A feature owns its own components, data
access, types, and tests, so that deleting a feature is deleting a directory.

```
src/
  app/                 application shell and top-level route-tree composition
  features/
    <feature>/
      api/             API calls for the feature
      assets/          assets used by the feature
      components/      components used by the feature or its sub-features
      context/         contexts used by the feature
      features/        sub-features using this same structure
      hooks/           hooks used by the feature
      mock/            mock data used by the feature
      routes/          route modules and route-tree owned by the feature
      types/           types used by the feature or its sub-features
      utils/           utility functions used by the feature
  assets/              shared images and bundled fonts
  components/          shared UI, when needed
  hooks/               shared hooks, when needed
  types/               shared types, when needed
  utils/               shared utilities, when needed
  lib/                 third-party wrappers and adapters
```

Dependencies point one way. Features may use shared top-level folders and `lib`. Shared code must not
import a feature or the application layer. When two features need the same thing, move it to
`shared` in its own change, before the change that needs it.

Feature-to-feature imports are the thing to watch. One is a shortcut, five is a
tangle that cannot be unpicked. If feature A needs feature B, either the shared
part moves to a shared top-level folder or A and B are one feature.

Project-specific boundaries go here:

- Feature-owned routes live in each feature's `routes/` directory, composed
  recursively. See Routing below; it is the rule most likely to drift.
- Components do not call network APIs directly. They use feature hooks or API
  modules, and remote data/cache state belongs to the owning feature.
- Features must not import another feature directly. Move shared code to
  the appropriate top-level folder instead.

## Routing

TanStack Router v1, code-based tree. Every routed feature owns its routes and
composes only its immediate children, identically at every depth. `docs/decisions.md`
has the reasoning; do not re-litigate it, and do not centralize composition.

- A routed feature has one `routes/<name>-route.ts` per route and exactly one
  `routes/route-tree.ts` — including when it has a single route. The tree file is
  what keeps a parent's import stable when the second route arrives.
- `route-tree.ts` composes the feature's own route with the `route-tree` of each
  immediate child feature. Never import a descendant's route module or a
  grandchild's tree. A parent knows its children, not its descendants.
- A feature with no URL of its own has no `routes/` directory. Do not add an
  empty one for symmetry.
- `src/app/router.ts` imports top-level feature route trees and nothing else.
- Everything under `routes/` is `.ts`, never `.tsx`. Route files reference
  components; they do not contain JSX. Needing JSX in a route file means that
  component belongs in the feature's `components/`.

Factories take the parent route as a **generic parameter**, never as a bare
`AnyRoute`:

```ts
export function createThingRoute<TParent extends AnyRoute>(parentRoute: TParent) {
```

`AnyRoute` in the parameter position compiles, typechecks, and lints clean while
silently erasing the literal path union that `Link to` and `router.navigate`
autocomplete depend on. Nothing fails; you just lose the safety. `AnyRoute` is
correct only as the generic's constraint, and it is a real library type rather
than an `any` escape hatch — leave it there.

Factories exist so the dependency points parent to child. Do not switch to the
TanStack docs' `getParentRoute: () => importedParentRoute` form, which makes
every feature import the app layer and risks a cycle with `router.ts`.

A leaf feature is live in `src/features/duck-feed/routes/`. The composing case:

```ts
// src/features/orders/routes/route-tree.ts
export function createOrdersRouteTree<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  const ordersRoute = createOrdersRoute(parentRoute);

  return ordersRoute.addChildren([
    createOrderHistoryRouteTree(ordersRoute),
    createReportingRouteTree(ordersRoute),
  ]);
}
```

Child `path` values are relative kebab-case segments with no leading slash; the
parent's path is always a prefix. For layout nesting without a URL segment, use a
pathless route (`id` set, `path` omitted). A subfeature whose URL must not nest
under its parent is composed by whichever feature owns that URL prefix instead.

Removing a parent's import of a child tree is the build-time switch that takes a
subfeature out of the application. Runtime or per-user gating belongs in the
route's `beforeLoad` as a `redirect`. Never compose routes conditionally: that
makes the tree's type depend on a runtime value, so the valid path union differs
between builds.

## Naming

- Files and directories: kebab-case
- Types and components: PascalCase
- Functions and variables: camelCase
- Custom hooks: file `use-thing.ts`, exporting `useThing`
- Constants: CONSTANT_VALUE
- Tests: `name.test.ext` beside the file it tests

Say it in one line and be consistent. Consistency matters more than which
convention you picked, and agents match surrounding code well when the
surrounding code agrees with itself.

No barrel files that re-export a directory. They hide dependencies, slow tooling,
and turn one import into a graph.

## Code

Write the boring version. Optimize for the person reading this in a year with no
memory of why it exists, because that person is usually you and sometimes an
agent with no context at all.

- Name things for what they mean, not what they hold. `pendingInvites` beats `data2`.
- Handle the error case near where it happens, or let it propagate deliberately.
  Never swallow an error to keep output clean.
- Make invalid states unrepresentable when the type system allows it. That
  removes whole categories of test.
- Validate data at the boundary where it enters the system. Inside the boundary,
  trust your own types.
- No dead code, no commented-out code, no speculative abstraction for a second
  case that does not exist yet.
- Comment why, never what. If a comment restates the code, delete it. If the code
  needs a comment to be understood, first try to make the code clearer.
- Mark a deliberate corner cut with a known ceiling (a global lock, an O(n²)
  scan, a naive heuristic) with a `ponytail:` comment naming the ceiling and the
  upgrade path. A silent shortcut is worse than a named one.
- React components are named function declarations (`export function UserCard()
  {}`), not arrow-function consts, and are not default exports. Prefer named
  exports for components, hooks, and utilities generally.

## Frontend

- Use semantic HTML, keyboard-accessible controls, visible focus states,
  labels, and meaningful alt text.
- Keep state close to where it is used. Handle loading, empty, and error
  states explicitly — do not let a component silently render nothing for any
  of them.
- Use Mantine components and style props for ordinary UI. Prefer `Stack`,
  `Group`, and `Flex` for layout, and the shared theme for colours and typography.
  Custom CSS remains appropriate for the workshop scene and game animations.
- Prefer flexbox and `gap` for layout. Do not use CSS `margin`; use parent
  layout, `gap`, and padding instead.

## Types

- TypeScript strict mode is enabled, including unused locals, unused parameters,
  and no fallthrough cases in switches.
- Use `import type` for imports that are only used as types.
- `any` is banned and Biome fails the build on it, as does `@ts-ignore`. Every
  value gets a real type.
- `unknown` is not the way around that ban. It is a boundary type, acceptable
  only where data genuinely enters the system untyped, and it must be narrowed by
  a type guard or validator before anything reads it. `unknown` that survives
  into application logic is `any` wearing a hat.
- `as unknown as X` defeats the checker and no linter catches it. Needing one
  means a type is wrong upstream. Fix that instead.
- A generic parameter is a real type. When a library exposes a wide catch-all
  type, prefer `<T extends Wide>(x: T)` over `(x: Wide)`. The wide type usually
  erases inference silently, with no error anywhere to tell you it happened.
- Derive types from a single source of truth rather than duplicating a shape in
  two places that can drift apart.

## Tests

Test what breaks. Do not chase a coverage number, because coverage measures lines
executed, not behavior checked.

- Test behavior through the public surface, not internal implementation. A test
  that breaks on every refactor is a liability.
- Every bug fix gets a test that fails before the fix and passes after. Verify
  both directions. A regression test you never watched fail proves nothing.
- Test the edges: empty, one, many, null, boundary values, and the failure path.
  The happy path is the least likely thing to break.
- Mock only what you do not own, like network and clock. Mocking your own code
  means the test asserts your assumptions rather than reality.
- A test with no assertion is not a test.

What must be tested in this project:

- Cover
  user-visible behavior and route transitions, including loading, empty, error,
  and not-found states.

## Dependencies

Adding one is a permanent decision, so treat it like one. Before adding, check
whether the standard library or an existing dependency already does it. Prefer a
few lines you own to a package you do not.

Adding a dependency needs approval. Say what it does, what it weighs, and what
you would do without it.

## Security

- Never commit secrets. Configuration comes from the environment.
- Never log credentials, tokens, or personal data.
- Parameterize every query. No string-built SQL.
- Validate and encode anything that came from a user before it reaches a
  database, a shell, or a page.
- Authorization is checked on the server, on every request. A hidden button is
  not a permission check.

## House Scanner hosted data

These rules cover the hosted House Scanner project and the collector in `tools/house-scanner`. Each exists because
skipping it broke the app once.

- Check the visible home count before a live run or a change that adds homes. The snapshot function and the contract
  both cap the household at 1500 visible listings, and above the cap `hs_snapshot` raises for every member, so the app
  shows nothing. Count what the snapshot would show (listings of sources whose policy is current and unexpired, plus any
  favorited or noted home, plus manual ones) and keep at least 100 of margin. A new source can add several hundred homes
  in one run: Svensk Fastighetsförmedling added 140 and took the household from 392 to 532 against the old cap of 500.
- If the snapshot is already failing, disable the newest source's policy at once (`hs.admin_set_source_policy` with the
  stored policy patched to status `disabled` and a higher revision). Its homes leave the snapshot immediately. Then
  raise the cap or narrow the source, and re-enable with a higher revision.
- Deploy in this order: the app (strict schemas reject unknown keys), the ingest function, the migration, then the
  policy revisions that switch a feature on. Never switch on first.
- A migration applied with `supabase db query --linked -f` leaves no row in `supabase_migrations.schema_migrations`;
  add it by hand so the history matches.
- Compare a new source's times and prices with another source's page for the same home before trusting a time zone or
  a unit. Boneo and Husman Hagberg label Stockholm wall-clock time with a Z.
- Live collector runs, hosted writes and key changes need the owner's go-ahead for the named steps. A grant for one
  session does not carry to the next.

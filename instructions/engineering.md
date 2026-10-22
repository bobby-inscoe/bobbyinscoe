# Engineering guide

## Stack and commands

This site uses React 19, TypeScript, Vite 8, TanStack Router v1, Mantine 9,
Vitest, Playwright, and Biome. Node.js is `>=20.19.0`; npm owns the lockfile.
Check `package.json` for exact versions and scripts.

| Need | Command |
| --- | --- |
| Install | `npm ci` |
| Run locally | `npm run dev` |
| Format and lint check | `npm run check` |
| Typecheck | `npm run typecheck` |
| Unit tests | `npm test` |
| One test file | `npm test -- path/to/file.test.ts` |
| Verification code types | `npm run test:typecheck` |
| Browser tests | `npm run test:browser` |
| Production build | `npm run build` |

Choose checks that cover the change. Browser tests need local Microsoft Edge;
see `playwright.config.ts`. The deploy workflow runs Biome, both TypeScript
checks, unit tests, and the build. Browser tests remain a local check for
affected flows.

## Code placement

Use `instructions/architecture.md` for the actual module map and route pattern. The
`@/*` import alias points to `src/*`; source files use it rather than long
relative paths. Keep tests beside the behavior they cover. Add a feature
subdirectory only when it contains code, not for symmetry. Avoid barrel files.

Feature components use feature hooks or API modules for remote data. Shared
code must not depend on a feature or the app. Keep state close to its owner.
Style through the theme, in this order: Mantine component and style props;
theme `defaultProps`, variants, and `styles`; theme `classNames` pointing into
the theme's CSS module for selectors a theme object cannot express; and a class
from that module used directly only for markup that is not a Mantine component.
Do not add per-project exceptions or selectors that reach another project.
`instructions/architecture.md` says where each theme lives.

Use semantic HTML, keyboard access, visible focus, labels, and meaningful alt
text. Handle loading, empty, error, and not-found states where they are possible.
Validate untrusted data at its entry point. Handle errors where they occur or
let them propagate deliberately. Do not add speculative abstractions or a new
dependency for a few lines the platform already provides.

## Tests and safety

Test behavior through a public surface. Add a focused regression check for a
non-trivial bug or new branch; test edge and failure cases that matter. Avoid
tests that merely repeat the implementation. Do not chase a coverage number.

Add a test only when it protects security or privacy, data loss, a contract,
a real source format, or behavior a member relies on, and no existing test
already fails for the same break. Before adding one, extend the nearest
existing test or table. Test a rule once, at the lowest layer that owns it.
Do not test copy, markup, CSS, framework behavior, or every value of a table
when two show the rule.

Never commit secrets or private household data. Never log credentials, tokens,
or personal data. Authorization belongs on the server, not in a hidden button.
Use parameterized queries and validate data before it reaches SQL or a shell.
For House Scanner or Supabase changes, read `instructions/house-scanner.md` and
verify current product behavior before changing hosted integration code.

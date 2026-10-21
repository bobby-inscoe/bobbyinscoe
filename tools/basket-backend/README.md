# Basket backend

Basket uses its own Supabase project: `basket`, ref `vphupcmgwbgxocwdqzgq`,
in Stockholm (`eu-north-1`). Its URL is
`https://vphupcmgwbgxocwdqzgq.supabase.co`. Never apply this workspace's
migrations or guest Auth settings to House Scanner or another project.

The foundation migration, guest Auth settings, and synthetic seed are installed.
The isolated worktree's `.env.local` already points at Basket. Run `npm run dev`
and open `/basket` to create your own guest basket.

## Local setup

1. Install Docker and the Supabase CLI.
2. Run `supabase start --workdir tools/basket-backend` from the repository root.
3. Read the publishable key with `supabase status --workdir tools/basket-backend`.
4. Copy the values in `.env.example` to the root `.env.local`, preserving other
   settings. Use `http://127.0.0.1:54331` and the local publishable key. Never put
   an administrative key in Vite configuration.
5. Set `VITE_BASKET_EMAIL_ENABLED=true` for local email testing. Run `npm run dev`
   and open `/basket`. Email codes appear at `http://127.0.0.1:54334`; Studio
   uses port 54333.

Without Basket configuration, the page shows a setup message. Shared data,
including guest baskets and personal kits, is always server-backed.

## Seed synthetic examples

For local setup, run `npm run basket:seed`. For the approved hosted project:

    npm run basket:seed -- --hosted --project-ref vphupcmgwbgxocwdqzgq

The script reads Basket settings from `.env.local` and refuses a hosted target
unless its exact project ref is supplied. It creates two synthetic guests,
a packing kit, a basket with an independent saved kit, and one extra item.
It verifies shared access and private personal kits. Repeated runs reuse the
fixture without duplicating it or resetting an edited example.

Private sessions and retry IDs stay in an ignored `*.private.json` beside the
script. Do not share or commit that file. The printed join link grants member
access. Create your own basket in the browser to test ownership.

## Finish hosted email setup

Guest collaboration works. Optional email access stays unavailable until
`VITE_BASKET_EMAIL_ENABLED=true` is set at build time. Supabase's free default
email provider refused custom code templates, so no real email flow is claimed.

1. Open the Basket project's Auth settings. Configure a custom SMTP provider
   with a sender you control. Do not copy another project's private credentials.
2. Preview the workspace settings with the explicit Basket target:

       npx supabase config diff --project-ref vphupcmgwbgxocwdqzgq --workdir tools/basket-backend

3. Apply those settings after SMTP is configured:

       npx supabase config push --project-ref vphupcmgwbgxocwdqzgq --workdir tools/basket-backend

   The config enables anonymous sign-in and manual linking, requires verified
   email, uses eight-digit codes lasting ten minutes, and supplies the magic-link
   and email-change code template in `supabase/templates/code.html`.
4. Test with an address you control: new account verification must retain the
   guest ID and data; existing-account sign-in must transfer guest access and
   retire the guest session. Test code expiry and retry after a lost response.
5. Set `VITE_BASKET_EMAIL_ENABLED=true`, then restart/rebuild the frontend.
   URL and publishable key are public configuration. Administrative keys are not.

For deployment, add the Basket URL, publishable key, and email flag as repository
build variables. Frontend deployment still requires authorization. Review signup
abuse controls before public exposure. CAPTCHA needs an accessible challenge
connected to `ensureGuest(captchaToken)` before enabling it in Auth.

Free-tier inactivity pausing, connection limits, email delivery, and backups need
review before relying on the app. Payments and native clients are out of scope.

## Data and security

Private rows live in `bk`. Browser roles have no table grants. Public invoker
wrappers call checked private functions with fixed search paths and explicit
grants. Every mutation verifies identity, membership, and role. Names and
browser-supplied IDs never grant authority. Verified account handover retires
the source guest and transfers its memberships and kits atomically.

Membership roles govern ownership. Shared writes serialize on the basket row.
Reset checks the preview revision, replaces current items with unchecked saved
starting items, and retains people, links, and saved kits. Personal kits and saved
starting kits are independent. Text edits check row revisions; completion uses a
desired state. Retry receipts prevent duplicate operations.

Join secrets are URL fragments, avoiding page-request access logs. The server
stores only hashes. A browser remembers its link and ID locally; another device
may need to replace it before sharing. Replacement preserves existing members.
A removed identity cannot rejoin, but a new guest holding a live link can. This
is not a verified person-level ban.

Realtime publishes only membership-protected basket revisions. Clients fetch
an authorized snapshot and also refresh every 15 seconds while visible, on focus,
and on reconnect. Removal blocks new reads; previously viewed data cannot be
recalled. Access controls do not hide data from the database administrator.

Limits: 50 active baskets per identity, 100 members per basket, 100 personal kits,
100 items per kit, 10 saved kits and 1,000 current items per basket, and 120
mutations per identity per minute. Handover preserves data even if its combined
collection exceeds a creation limit. Retry receipts last seven days. There is no
durable offline queue or automatic deletion of guest-owned data.

## Verification

- `npm run test:basket`: PostgreSQL rules in PGlite with database roles.
- `npm run test:basket:browser`: Edge at phone and desktop widths. Synthetic Auth
  calls the actual SQL API. Realtime is disabled in this harness, so collaboration
  tests exercise automatic refresh fallback.
- Standard formatting, both typechecks, unit tests, and production build apply.

Separate hosted checks passed for anonymous Auth, private reads, realtime delivery,
removal while subscribed, concurrent additions, and simultaneous owner demotions.
The hosted security advisor reported no warnings/errors. Its informational
RLS-without-policy notices describe the private tables deliberately denying
browser access. Performance notices identify optional foreign-key indexes;
existing indexes cover current reads, and permanent user deletion is out of scope.

Docker startup, real email verification, a real phone's software keyboard, and a
manual screen-reader pass remain unverified. Keyboard and named-control checks
do not establish accessibility conformance.

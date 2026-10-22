# House Scanner hosted data

These rules cover the hosted House Scanner project and the collector in `tools/house-scanner`. Each exists because
skipping it broke the app once.

Users see the app as Shellter at `/shellter`; code, tables and functions keep the house-scanner name. Hosted Auth
redirect URLs still allow only `/projects/house-scanner/...`, so invite and password emails return there and the app
redirects them. Add `/shellter/...` to those URLs before pointing Auth at the new path.

- Check the visible home count before a live run or a change that adds homes. The snapshot function and the contract
  both cap the household at 1500 visible listings, and above the cap `hs_household_snapshot` raises for every member, so the app
  shows nothing. Count what the snapshot would show (catalog listings of sources whose policy is current and unexpired
  that pass a hard rule of an enabled profile or that the household hid, plus any favorited or noted home, plus manual
  ones) and keep at least 100 of margin. Loosening a household's criteria can raise its count too. A new source can add several hundred homes
  in one run: Svensk Fastighetsförmedling added 140 and took the household from 392 to 532 against the old cap of 500.
- If the snapshot is already failing, disable the newest source's policy at once (`hs.admin_set_source_policy` with the
  stored policy patched to status `disabled` and a higher revision). Its homes leave the snapshot immediately. Then
  raise the cap or narrow the source, and re-enable with a higher revision.
- Deploy in this order: the app (strict schemas reject unknown keys), then any Edge Function that must accept new
  fields, the migration, then the policy revisions or collector change that switch a feature on. Never switch on first.
  The app reads the household from `hs_household_snapshot`, whose reader drops keys it does not know, so a field added
  there can ship before the app reads it; removing or retyping one still needs the app first. A value it cannot read
  shows an error rather than falling back: the old snapshot functions are gone. A load is one `hs_household_start`
  call, which returns the memberships and that same snapshot; a member of several households makes one more after
  choosing.
- That snapshot reads a read model kept by triggers: `hs.listing_cards` (one policy-filtered card per listing) and
  `hs.household_listings` (the homes each household could see, and why). After any migration or data repair that
  touches listings, policies, profiles, favorites, notes or hides, `select * from hs.card_drift()` and
  `select * from hs.household_drift()` must both be empty. Roll migrations back newest first.
- Name a new migration and its rollback with the UTC time you create them, to the second
  (`date -u +%Y%m%d%H%M%S`), never a rounded or future slot, and record that same version on the hosted project.
  The connector's `apply_migration` stamps its own apply time, so apply with `supabase db query --linked -f` or the
  SQL connector instead; both leave no row in `supabase_migrations.schema_migrations`, so insert one with the file's
  version and name. Files from before 19 October keep their old 12-digit names. Deploy functions with
  `npx supabase functions deploy <name> --project-ref <ref> --no-verify-jwt` from the main checkout.
- Some configuration lives outside the repository. Supabase Auth (dashboard): Site URL `https://bobbyinscoe.com`,
  redirect URLs for `/projects/house-scanner/invite**` and `/projects/house-scanner/listings`, public signup off, email
  confirmation on, custom SMTP through Resend from `no-reply@auth.bobbyinscoe.com`. Function secrets:
  `HS_INGEST_KEYS_JSON`, and `RESEND_API_KEY` for `house-scanner-invite`, which mails invitation links itself and
  creates accounts for people who open a link. The collector's keys, run scripts and Windows scheduled task are private to the owner's PC.
  A new page or domain that sends people back from Auth emails needs its address in the redirect list and in
  `ORIGINS` of `supabase/functions/house-scanner-invite`.
- Compare a new source's times and prices with another source's page for the same home before trusting a time zone or
  a unit. Boneo and Husman Hagberg label Stockholm wall-clock time with a Z.
- Live collector runs, hosted writes and key changes need the owner's go-ahead for the named steps. A grant for one
  session does not carry to the next.


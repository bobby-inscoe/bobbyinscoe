# House Scanner hosted data

These rules cover the hosted House Scanner project and the collector in `tools/house-scanner`. Each exists because
skipping it broke the app once.

- Check the visible home count before a live run or a change that adds homes. The snapshot function and the contract
  both cap the household at 1500 visible listings, and above the cap `hs_snapshot` raises for every member, so the app
  shows nothing. Count what the snapshot would show (catalog listings of sources whose policy is current and unexpired
  that pass a hard rule of an enabled profile or that the household hid, plus any favorited or noted home, plus manual
  ones) and keep at least 100 of margin. Loosening a household's criteria can raise its count too. A new source can add several hundred homes
  in one run: Svensk Fastighetsförmedling added 140 and took the household from 392 to 532 against the old cap of 500.
- If the snapshot is already failing, disable the newest source's policy at once (`hs.admin_set_source_policy` with the
  stored policy patched to status `disabled` and a higher revision). Its homes leave the snapshot immediately. Then
  raise the cap or narrow the source, and re-enable with a higher revision.
- Deploy in this order: the app (strict schemas reject unknown keys), then any Edge Function that must accept new
  fields, the migration, then the policy revisions or collector change that switch a feature on. Never switch on first.
- A migration applied with `supabase db query --linked -f` or the SQL connector leaves no row in
  `supabase_migrations.schema_migrations`; add it by hand so the history matches. Deploy functions with
  `npx supabase functions deploy <name> --project-ref <ref> --no-verify-jwt` from the main checkout.
- Some configuration lives outside the repository. Supabase Auth (dashboard): Site URL `https://bobbyinscoe.com`,
  redirect URLs for `/projects/house-scanner/invite**` and `/projects/house-scanner/listings`, public signup off, email
  confirmation on, custom SMTP through Resend from `no-reply@auth.bobbyinscoe.com`. Function secrets:
  `HS_INGEST_KEYS_JSON`. The collector's keys, run scripts and Windows scheduled task are private to the owner's PC.
  A new page or domain that sends people back from Auth emails needs its address in the redirect list and in
  `ORIGINS` of `supabase/functions/house-scanner-invite`.
- Compare a new source's times and prices with another source's page for the same home before trusting a time zone or
  a unit. Boneo and Husman Hagberg label Stockholm wall-clock time with a Z.
- Live collector runs, hosted writes and key changes need the owner's go-ahead for the named steps. A grant for one
  session does not carry to the next.


# House Scanner hosted data

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


# Hosted acceptance script

Local tests ran against PGlite with hand-made roles and a mocked client. They cannot show how a real Supabase project behaves. This script runs against a real project with real API keys and checks what they could not: PostgREST exposure, real sign-in, real grants and row security, and the real error shape.

It uses fictional data only, signs in as test users that exist for this purpose, and writes a few favorites and notes that it undoes.

## Prerequisites

1. A Supabase project with migrations 0001, 0002 and 0003 applied.
2. Three test users created in the dashboard (Authentication, Users) with a password and "auto confirm" on: owner of household A, owner of household B, and optionally a second member of A. Use throwaway passwords. Do not use your own account.
3. The seed SQL run once in the SQL editor: `npm run house-scanner:accept -- --print-seed-sql`, replace the UUID placeholders, run it. It creates two fictional households. It seeds no listing; the script adds one manual bookmark (`example.invalid`) per household through `hs_add_manual`, which is the supported path for a non-operator.
4. The project URL and publishable key (Settings, API). Never the secret or service key; the script refuses it.

## Running

Set variables in your shell, not on the command line. In PowerShell:

```powershell
$env:HS_ACCEPT_URL = 'https://<project-ref>.supabase.co'
$env:HS_ACCEPT_PUBLISHABLE_KEY = 'sb_publishable_...'
$env:HS_ACCEPT_A_EMAIL = '...'; $env:HS_ACCEPT_A_PASSWORD = '...'
$env:HS_ACCEPT_B_EMAIL = '...'; $env:HS_ACCEPT_B_PASSWORD = '...'
# optional second member of household A
$env:HS_ACCEPT_A2_EMAIL = '...'; $env:HS_ACCEPT_A2_PASSWORD = '...'
npm run house-scanner:accept -- --confirm-hosted --out house-scanner-acceptance.json
```

Flags:

- `--confirm-hosted` is required. The URL host must end in `.supabase.co` (or be localhost for a local stack).
- `--out <path>` writes the JSON report. Default is none.
- `--print-seed-sql` prints the seed and exits. It needs no environment.
- `--a2-deactivated` enables check 7. Use it only after you deactivated user A2 with `hs.admin_set_member(..., false)` (the seed prints the statement, commented out).

Exit code 0 means no check failed (skipped checks do not fail the run). 1 means at least one FAIL. 2 means the script refused or its input was wrong, and nothing was sent.

The table and the report show labels such as "user A" and "household B", statuses, Supabase error codes, short messages and timings. They never contain keys, emails, passwords, tokens or ids. Any configured value that appears in a server message is replaced with `[redacted]`.

## What each check proves

| Check | Proves |
|---|---|
| 0 setup | Real password sign-in works; each user has exactly the seeded household; each household has a listing. |
| 1 anon | The publishable key alone cannot run any public `hs_*` function, and the `hs` schema and a plain table read are refused. |
| 2 user A | `hs_memberships` returns exactly household A and `hs_snapshot` passes the app's `snapshotSchema`, with every row in household A. |
| 3 cross-household | User B is refused for snapshot, notes, favorite and note save in household A, gets nothing for A's listing through household B, and no identifier of A appears in B's responses. |
| 4 round trip | Favorite on and off, and note save at revision 0 then 1, persist and show in the snapshot. |
| 4b stale shape | A stale `hs_save_note` returns code `40001`, which `household-client.ts` turns into the note conflict path. The status, code and message are recorded as the real shape. |
| 5 concurrent | Two sessions of user A saving the same revision at once give one winner and one `40001`, and the final revision matches the winner. One attempt is evidence, not proof. |
| 6 privileged | A signed-in member cannot run `hs_purge_expired`, the ingest functions or any `admin_*` function, and cannot read `hs.admin_log`. |
| 7 deactivated | Only with A2 and `--a2-deactivated`: A2 is refused for snapshot, notes, favorite and note save. |
| 8 cleanup | The favorite is removed and the note body cleared. |

A denial counts only when the request is refused before a function body runs (`permission denied`, an unexposed schema, an unknown function). A function that ran and raised its own error is reported as NOT BLOCKED, because it means the grant exists.

## What it leaves behind

One manual listing per household (an `example.invalid` link) and user A's note row with an empty body. The API has no delete for either. Remove them as the operator if you want a clean project.

## What it cannot prove

- Real OTP or magic-link email delivery, and the sign-in screen of the app. It uses password sign-in only.
- That the `hs-ingest` Edge function is deployed, its secrets and its HMAC checks. The ingest SQL functions are only probed for denial.
- Free-tier limits, rate limits, cold starts or load.
- Behavior of any user or household other than the fictional ones above.
- Concurrency beyond one two-session attempt.

## Report back

Paste the JSON report file (or the table). Never paste the environment variables, keys, passwords or tokens. If a check fails, the observation lines give the status and code to start from.

## Development

Logic is unit tested with an in-memory fake that can leak across households, expose the `hs` schema, drop revision checks and more: `npm test -- tools/house-scanner/acceptance`. The test also compares each probe's argument names with the migrations, because a wrong name would look like a denial. Typecheck with `npm run house-scanner:accept:typecheck`.

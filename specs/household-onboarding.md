# House Scanner invitations and account recovery

Status: draft

The proposed empty-household behavior below predates the shared catalog decision. Reconcile it with `specs/house-scanner-shared-catalog.md` before implementation; a new household needs a way to set its first profile and browse eligible catalog listings.

## Goal

An existing user can invite a friend to create an independent House Scanner household. A household owner can also invite someone into their own household. A recipient chooses their own password, and anyone with a real email address can reset a forgotten password without operator help.

## Current behavior

- `HouseScannerAccess` only offers sign in. `useHouseholdSession` accepts a real email or a username mapped to a synthetic email address. There is no signup or password recovery screen.
- Local `supabase/config.toml` disables signup. The hosted Auth settings have not been verified. The browser Auth client has `detectSessionInUrl: false`, so email callbacks need handling.
- Supabase Auth stores users and passwords. `hs.members` grants household access; a signed-in nonmember sees no household data. Only operator SQL functions currently create households and memberships.
- The app can already choose among multiple household memberships. The snapshot includes inactive members and rejects more than ten member rows per household.
- Source policies and ingest credentials are configured per household. A newly created household has no automated listing collection. It can use manually added links. Settings cannot create a first search profile yet.

## One invitation model, two outcomes

| Link | Who can create it | Who can use it | Result |
| --- | --- | --- | --- |
| Create your own household | Any active user | One verified account holding the link | A new, separate household with that account as owner |
| Join this household | An active owner of that household | The verified account for the email the owner entered | An active member of that household |

Both links use the same `/invite` flow. The database stores the invitation purpose, issuer, optional target household, recipient email for a join link, expiry, and a hash of the one-use token. A create-household link is bound to the first email that starts account setup. The link never infers its destination from whichever household happens to be selected in the browser.

## Proposed experience

1. In Settings, any active user can copy a “Create your own household” link. An owner can also enter a person's email and copy a “Join this household” link. The user shares the app link themselves. Supabase Auth emails account setup links to new recipients; the app does not send the copied link by email.
2. Opening either link shows what it will grant. A new recipient enters their real email. A trusted server validates the link, binds it to that email, and asks Supabase Auth to send an account invitation. Public Auth signup stays disabled. The recipient opens the Auth email, sets their own password, and returns to the same app invitation. An existing account signs in and continues. The server rechecks the link and verified identity before making a change.
3. Redeeming a create-household link asks for a household name, then creates an empty household and owner membership in one transaction. It shares no data or automated sources with the issuer.
4. Redeeming a join-household link adds a `member` row to the named household, or reactivates that person's existing inactive row if the owner invited them back. The recipient can then choose among their households if they have more than one.
5. Owners can see and revoke pending join links and deactivate members. They cannot deactivate the last active owner. The existing ten-row household limit is shown and checked before a new member is added.
6. The sign-in screen offers password recovery through Supabase Auth. The person sets a new password from an email link. No operator handles that password.

## Acceptance cases

- Given an active user, when they create an independent-household link, then its recipient creates a separate household and cannot read the issuer's household.
- Given a recipient who has created their own household, when they invite another person to join it, then that second person receives membership only in the recipient's household.
- Given an active owner, when they create a join link for a specific email, then only that verified email's account can become a member of the specified household. Forwarding the link to a different account does not grant access.
- Given a new recipient with a valid link, when they enter their email, then only the trusted server can ask Supabase Auth to create and invite that account. A direct public `signUp` request is denied.
- Given a new or existing Auth account, when it opens a valid link, then the same invitation flow lets it finish account setup or sign in and accept exactly once.
- Given an invalid link, when someone submits an email to start account setup, then the server does not call the Auth admin invitation API or create an account.
- Given an expired, reused, or revoked link, or an issuer who has lost the required access, when someone tries to redeem it, then no household or membership is created.
- Given an Auth account invited through a valid link whose household redemption later fails, then it has no household access and sees a clear way to retry or request a fresh link.
- Given an Auth invitation email that fails to send or expires, then the app allows a retry for the same bound email without silently consuming the app link or creating household access.
- Given an inactive former member who accepts a fresh owner-issued join link, then their prior membership is reactivated without duplicating the row or losing saved data.
- Given a household with ten member rows, when an owner tries to add an eleventh person, then the app explains the limit and the snapshot stays usable.
- Given a member deactivation, when that person makes another data request, then the database denies it. The last active owner cannot be deactivated.
- Given an unknown email, when recovery is requested, then the UI does not disclose whether an account exists. A valid recovery link lets its holder set a new password.
- Given a newly created household, when its owner opens it, then manual links work and the UI does not imply automated collection is running.

## Decisions and boundaries

- Invitation purpose is explicit and immutable. A create-household link never joins the issuer's household. A join link never creates a new household. Joining gives the `member` role; owner promotion and transfer are outside this first version.
- A copied create-household link is a bearer invitation until the first recipient binds it to their email; that verified account can then create its own household. A join link is bound to the recipient's email when the owner issues it because it grants access to private household data.
- Use a high-entropy, one-use, expiring token. Store only its hash. Redeem and create the household or membership atomically. Recheck issuer permission and the ten-row cap at redemption. Check the recipient against the current confirmed Auth email, not editable user metadata. Keep tokens out of logs and snapshots. Expose private `hs` tables only through checked functions.
- Use Supabase Auth for password storage, account invitation, and recovery. Keep public signup disabled while leaving the email provider and password sign-in enabled. Configure custom SMTP, the production Site URL, and exact redirect URLs. Existing synthetic-address accounts cannot use email recovery until their addresses become deliverable.
- Require a valid app link before creating an Auth account. A trusted Edge Function validates the app token and email, reserves the link for that email, and calls the Auth admin invitation API with a secret key. The browser never sees the key. The app token remains unconsumed until the authenticated recipient creates or joins the household. A failed or expired Auth email can be resent to the same address.
- A confirmed existing Auth account signs in and redeems the link without another account invitation. Supabase's Auth admin invitation returns an error for a confirmed existing address, so the UI offers sign-in and recovery without exposing account existence to the inviter.
- New households start empty: no profile, source policy, or ingest credential. Automated source setup is a separate feature. There is no automatic invitation email sender.
- Hosted Auth and SMTP changes are external writes and need explicit authorization when implementing. This spec does not authorize them.

## Authentication choice

- Use email and password for the first version. Supabase Auth handles password storage, account invitations, and reset links; a small SMTP sending service handles delivery. Use `no-reply@auth.bobbyinscoe.com` as the sending address. This needs a verified sending subdomain but no separate inbox or email client for the app.
- A copied app invitation still decides whether the recipient may create or join a household. The Auth email only proves control of an address and lets a new person choose a password.
- Defer Google or Facebook sign-in. They would remove the app password for people using those providers, but they do not by themselves enforce the requirement to validate an app invitation before creating an Auth user. Google-only would also require every new person to use Google. Facebook requires its own app and email permission setup. A provider can be added later without changing the two invitation purposes or household membership model.
- Email magic links are not a way around sending email: they need delivery at every sign-in. With email and password, email is needed for initial setup and recovery.

## Email delivery setup

1. Create or access a Resend account and add `auth.bobbyinscoe.com` as a sending domain. Use the free plan while its limits fit the project.
2. Add the exact DNS verification and sending records Resend supplies in the Squarespace DNS zone for `bobbyinscoe.com`. The public nameservers point to Squarespace. Keep the existing root-domain Mailgun MX records intact. Verify the subdomain in Resend after DNS propagates.
3. Create a Resend key for SMTP and configure Supabase Auth custom SMTP with `no-reply@auth.bobbyinscoe.com` as the sender. Keep the key only in the hosted Auth configuration, never in the repository or a browser client. Confirm the hosted Site URL and exact invitation and recovery redirect URLs.
4. Test delivery to an external address controlled by the project owner, then test the full account invitation and password reset return paths. Only enable the user-facing flow after those checks pass.

As of 19 October 2026, Resend has verified `auth.bobbyinscoe.com` in Ireland (`eu-west-1`). Squarespace has one Resend DKIM TXT record and two sending CNAME records; its existing records were left intact. A Resend sending-only key scoped to this subdomain is stored in the hosted Supabase Auth custom SMTP configuration, which uses `no-reply@auth.bobbyinscoe.com`. The key is not in the repository. A test recovery email to an existing account reached Resend's `Delivered` status. Supabase's Site URL is still `http://localhost:3000`, and the app has no invitation or recovery callback yet. Set production redirects and test the full invitation and recovery flows when those routes exist. The Supabase database connector does not expose hosted Auth SMTP settings.

## Slices

| ID | Outcome | Depends on | Owned paths or boundary | Check | State |
| --- | --- | --- | --- | --- | --- |
| S1 | Add the two invitation purposes, checked issuance and redemption, and empty household creation | none | `hs` migration; SQL tests | Each purpose has one outcome; invalid links and cross-household attempts change nothing | pending |
| S2 | Validate a link before Auth account creation, then support account invitation, invitation return, and password recovery | S1 | Trusted Edge Function; Auth client; access and invite routes; local Auth config | Direct signup and invalid links create no account; new and existing users accept through one flow; recovery works | pending |
| S3 | Add Settings controls for copying links, pending join invites, and member deactivation | S1, S2 | House Scanner Settings; client contract | Only owners can manage household access; invite status and limits are clear | pending |
| S4 | Explain empty-household limits and verify the integrated flow | S1, S2, S3 | Empty state; operator docs; acceptance checks | New owner can add manual links and sees that collection is not configured | pending |

## Open questions

- Replace the empty-household inventory assumption with the shared-catalog flow and decide when a new owner creates the first saved profile.
- Confirm the hosted project's current Auth, SMTP, Site URL, and redirect settings before any hosted change.
- Verify that hosted Auth permits admin invitations while public signup is disabled, with email password sign-in still enabled. The local config currently disables both general and email signup; that distinction needs a local test before deployment.

## Progress

- Narrowed the earlier operator and automatic-email plan to copied links while retaining both distinct invitation outcomes and owner control of household access.
- Decisions: new households start empty with manual links; automated source onboarding is separate; a valid link is required before Auth account creation.
- The two invitation purposes and their acceptance cases are settled. Verify the local invite-only Auth configuration and hosted settings during implementation.
- Reviewed the local Auth client, membership model, settings UI, and per-household source setup. No hosted database data or schema changed; hosted Auth SMTP is now configured.
- Checked Supabase's current [signup](https://supabase.com/docs/reference/javascript/auth-signup), [password recovery](https://supabase.com/docs/guides/auth/passwords), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), and [redirect URL](https://supabase.com/docs/guides/auth/redirect-urls) guidance on 19 October 2026.

# SMA Stage 2: Security remediation, authentication protection and session hardening

Date: 22 Nov 2026. Starting point: *SMA Prompt 01: Codebase, Website, Database and System Audit*, findings F1 to F12.

No production data was changed and nothing was deployed. Migration 0008 was not run against production. Paystack and R2 were
not activated. No secret values appear in this document or in the repository.

## 1. Summary

| Finding (audit) | Status after Stage 2 | Needs from the owner |
| --- | --- | --- |
| F1 High: admin access by email link only; every admin has full access | **Code complete, inactive until approved.** Authenticator-app second step (TOTP) with recovery codes; seven administrator groups, default deny | Approve the design (sections 7 and 8); set `MFA_ENCRYPTION_KEY`; enrol; assign groups; then set `MFA_ENFORCE_ADMINS=true` |
| F2 Medium: CSP without `script-src` | **Done, in report-only mode.** Per-page hash-based policy generated from the real build; no `unsafe-inline` or `unsafe-eval` for scripts. Enforced locally with zero violations | Deploy, watch reports for 1 to 2 weeks, then build with `CSP_MODE=enforce` |
| F3 Medium: no backups | Out of scope for Stage 2 (backup automation is a later stage) | |
| F4 Medium: email return-path not pointing to Resend | Out of scope (DNS change) | Check the Resend dashboard |
| F5 Medium: predictable IP-hash salt | **Done.** Keyed HMAC; dedicated `IP_HASH_SALT` secret; no constant fallback | Set `IP_HASH_SALT` (works safely without it, see section 11) |
| F6 Low: uploads checked by extension only | **Done.** Content signatures, executable detection, archive inspection, generated storage keys, per-user rate | Malware scanning still to choose before R2 goes live |
| F7 Low: no retention rules | **Mechanism done; new rules off until approved.** Allow-listed, batch-limited, audited | Approve the periods in section 12; then switch categories on |
| F8 Low: 30-day sessions; no sign-out everywhere | **Done.** Students: 10-minute idle and 12-hour absolute limits. "Sign out of all devices" for everyone | Decide staff idle limits (section 6) |
| F9, F10, F11 | Not in Stage 2 scope (exchange-rate sanity checks, WAF review, CI) | |

## 2. Findings still outstanding

1. **Administrator MFA is not yet required in production.** It cannot be until the owner sets `MFA_ENCRYPTION_KEY`, enrols, and approves the requirement switch (section 7).
2. **Administrator groups are not yet assigned.** Existing administrators keep full access until the owner assigns groups (section 8).
3. **CSP ships in report-only mode.** It blocks nothing in production until the owner switches to enforce. Cloudflare zone features (Rocket Loader, Email Obfuscation, Web Analytics, Bot Fight Mode) can inject scripts that this repository cannot see. The report period exists to catch them.
4. **Not tested in this sandbox:** Cloudflare Turnstile loading under the CSP (the sandbox has no internet access; the Turnstile origin is allowed in the policy), Paystack's inline script (unused in production today), and real Cloudflare zone behaviour.
5. **No malware scanning** of uploads (section 10).
6. **New retention categories are off** pending approval; the privacy policy is unchanged (section 12).
7. **Staff idle limits are off** pending approval (section 6).
8. **Production migration status unknown.** There is no Cloudflare login in this environment, so whether 0007 is applied in production could not be checked (Part M). Run `npx wrangler d1 migrations list skillmountainacademy-db --remote` before deploying.
9. **Not in scope:** F3 backups, F4 email DNS, F9 to F11.
10. **QR codes for authenticator setup are not shown.** Setup uses the typed key or an `otpauth://` link, to avoid adding a dependency. A QR code is a small follow-up.

## 3. Files

**Added**

| File | Purpose |
| --- | --- |
| `migrations/0008_security.sql` | Additive columns and tables (section 4) |
| `src/server/privacy.ts` | Keyed IP pseudonyms |
| `src/server/lms/session-policy.ts` | Session lifetimes per role |
| `src/server/lms/permissions.ts` | Administrator groups and the route permission table (default deny) |
| `src/server/lms/mfa-crypto.ts` | TOTP (RFC 6238), AES-GCM secret encryption, recovery codes |
| `src/server/lms/data/mfa.ts` | MFA data access |
| `src/server/lms/routes/mfa.ts` | MFA endpoints |
| `src/server/lms/routes/security.ts` | Retention settings and security status endpoints |
| `src/server/lms/retention.ts` | Retention allow-list and runner |
| `src/server/routes/csp.ts` | `POST /api/csp-report` |
| `scripts/csp.mts` | Generates the per-page CSP after `next build` |
| `app/app/idle.tsx` | Activity reporting, idle warning, sign-out on expiry |
| `app/app/mfa.tsx` | Code prompt, setup and management screens |
| `app/app/security-admin.tsx` | Security status and retention settings |
| `tests/security.test.ts` | 29 behavioural security tests |
| `docs/SMA_SECURITY_REMEDIATION.md` | This document |

**Modified**

- **Server:** `src/server/env.ts`, `src/server/http.ts`, `src/server/cron.ts`, `src/worker.ts`; `src/server/lms/api.ts`, `index.ts`, `schedule.ts`, `upload-rules.ts`, `views.ts`; `src/server/lms/data/users.ts`; `src/server/lms/routes/auth.ts`, `coursework.ts`, `users.ts`; `src/server/routes/register.ts`, `payments.ts`, `hold.ts`.
- **Dashboard:** `app/app/admin.tsx`, `entry.tsx`, `page.tsx`, `shell.tsx`, `ui.tsx`.
- **Tests:**
  - `tests/lms1.test.ts`: the per-address sign-in limit is now 20.
  - `tests/lms3.test.ts` and `tests/admissions.test.ts`: the PNG fixtures now carry the full 8-byte signature.
  - `tests/lms7.test.ts`: the public-route list now includes `/api/auth/mfa/verify`.
- **Other:** `package.json` (postbuild), `.dev.vars.example` (placeholders), `docs/lms/API.md` (regenerated).

Nothing in programme data, prices, durations, curriculum, payments, enrolments or academic records was changed.

## 4. Migration 0008 (additive only)

- `auth_sessions`:
  - `last_activity_at`: last genuine activity.
  - `mfa_pending` (default 0).
  - `mfa_verified_at`.
- `users.admin_role` (NULL = unassigned, keeps today's full access).
- `mfa_factors`: the encrypted secret, status and last used step.
- `mfa_recovery_codes`: hashes only, single use.

The code tolerates the migration not being applied yet. Sign-in keeps working, and the idle and MFA checks apply only once the columns exist. Apply it after a verified backup, and only with owner approval (`npm run db:migrate` applies 0007 and 0008 together if 0007 is still pending).

## 5. Ten-minute student idle logout

**What counts as activity.** A click, tap, key press, typing, touch or deliberate scroll (`pointerdown`, `keydown`, `wheel`, `touchstart`, `touchmove`, `input`). Mouse movement, page loads, background polling (notifications every minute), automatic refreshes and the warning itself never count.

**Browser** (`app/app/idle.tsx`):

- Reports activity to `POST /api/auth/activity` at most every 30 seconds, with a trailing report.
- Each report states how long ago the action happened (`ago`, 0 to 30 s).
- Shows a warning in the last minute; only a genuine action dismisses it.
- At 10 minutes it signs out and opens the student entrance with "You were signed out because there was no activity for a while."
- After a device sleeps, the first action finds the limit passed and signs out without trying to revive the session.

**Server** (`resolveSession` in `src/server/lms/api.ts`), on every request:

- The session is looked up by the hash of the cookie.
- If `now - last_activity_at > 10 min` (students), the row is deleted and the response is `401 session_expired` with `Set-Cookie: Max-Age=0` and `x-session-expired: idle`.
- The same cookie can never work again: not after a refresh, a wake from sleep, a reopened browser or a copied cookie.
- The activity endpoint runs after this check, so it cannot revive an expired session.
- It only moves the timestamp forward, at most once per 20 seconds per session (few database writes).
- The browser's `ago` can only move the time back, never forward.
- Students also have a 12-hour absolute limit, even with constant activity. Student cookies carry `Max-Age=43200`.

Verified in a real browser on the local site:

- the warning appeared with 37 seconds left;
- a click recorded activity on the server;
- after 11 simulated idle minutes a reload went to the entrance with the notice;
- the session row was deleted and the cookie cleared.

## 6. Session management and staff policy

| Control | Implementation |
| --- | --- |
| Creation | 32 random bytes; only `sha256("s|"+token)` stored |
| Fixation | At sign-in, any session cookie the browser already had is deleted; a new token is issued. Passing the second factor issues another new token |
| Cookie | `HttpOnly; Secure; SameSite=Lax; Path=/`; Max-Age per role |
| Logout (this device) | `POST /api/auth/logout` deletes the row and clears the cookie |
| Logout (all devices) | `POST /api/auth/logout-all` (menu: "Sign out of all devices") |
| Revocation | Suspension, role change, administrator-group change, MFA enabled, disabled or reset delete the person's sessions |
| Stolen or expired cookies | Server checks lifetime, idle limit and account status on every request; expired rows are deleted |
| Concurrency | Single-statement updates (`UPDATE … WHERE`, `UPDATE … RETURNING` for one-time codes); deletion is idempotent |
| Logs | Session tokens and hashes are never logged; the audit log records events with a pseudonymous IP only |

**Staff (not changed without approval).** Instructors and administrators keep 30-day sliding sessions by default. Recommended, by setting plain Worker variables:

| Variable | Recommended | Effect |
| --- | --- | --- |
| `ADMIN_IDLE_MINUTES` | `15` | Administrators signed out after 15 minutes idle |
| `ADMIN_SESSION_HOURS` | `12` | Administrators sign in at least twice a day |
| `INSTRUCTOR_IDLE_MINUTES` | `30` | Allows a 45 to 60 minute live class with the dashboard in the background, with some margin: the instructor's activity in Meet does not count. Consider 60 if instructors keep the dashboard open but untouched during class |

Impact: staff will need new email links more often. An administrator with two-step sign-in also enters a code each time.

## 7. Administrator MFA: architecture and approval

**Chosen: TOTP (authenticator app) plus recovery codes.**

- **Code format and replay.** RFC 6238 (HMAC-SHA1, 6 digits, 30-second steps, plus or minus one step for clock drift). Each step is claimed atomically (`last_step`), so a code cannot be used twice.
- **Secret storage.** 160-bit secret, stored encrypted with AES-256-GCM under `MFA_ENCRYPTION_KEY`. Without the key, setup answers "not configured" and nothing is stored.
- **Sign-in flow.**
  1. The email link creates a session with `mfa_pending = 1`.
  2. That session can call only `/api/me`, `/api/auth/mfa/verify` and `/api/auth/logout`; everything else answers `403 mfa_required`. This is checked on the server, so URLs, request bodies or local storage cannot bypass it.
  3. A pending session lapses after 10 minutes.
  4. Success replaces the token.
- **Brute-force protection.** 5 attempts per account and 20 per network address per 10 minutes; 20 failures in a day end the pending session and email the administrator.
- **Recovery codes.** 10 codes of 60 bits each, shown once and stored as SHA-256 hashes. Each code is single use, enforced atomically. Using one emails a notice. Codes can be regenerated with a current code.
- **Events.** Every event is written to `audit_log`, for example `mfa.enabled`, `mfa.verify_failed`, `mfa.recovery_used`, `mfa.locked` and `mfa.reset_by_admin`. Notices are emailed for enable, disable, new codes, recovery use, lock and reset.

**Alternative: passkeys (WebAuthn).** They are phishing-resistant, need no code typing and are well supported on phones and laptops. They need:

- a `webauthn_credentials` table;
- challenge storage;
- careful origin and relying-party configuration;
- a fallback for administrators without a supported device.

Recommended as Stage 2b, alongside TOTP, not instead of it.

**Recovery procedures.**

1. **Lost phone, codes available.** Sign in by email, use a recovery code, then turn two-step sign-in off and on again with the new phone.
2. **Lost phone and codes, other administrators exist.** A Super Administrator uses "Reset two-step sign-in" in Security. It is audited and emailed, and signs the person out everywhere. Nobody can reset their own.
3. **Owner locked out with no other Super Administrator (break-glass).** With Cloudflare access:
   - Run `npx wrangler d1 execute skillmountainacademy-db --remote --command "DELETE FROM mfa_recovery_codes WHERE user_id = '<id>'; DELETE FROM mfa_factors WHERE user_id = '<id>'"`.
   - Then sign in by email and set it up again.
   - Keep at least two Super Administrators so this is rarely needed.

**Operational implications.** Each administrator needs an authenticator app and somewhere safe to keep recovery codes. Rotating `MFA_ENCRYPTION_KEY` invalidates every enrolled factor, and everyone must enrol again.

**Activation plan (needs owner approval).**

1. Set `MFA_ENCRYPTION_KEY`.
2. Deploy.
3. The owner enrols under Security, then "Two-step sign-in", and stores the recovery codes offline.
4. Every other administrator enrols.
5. Set `MFA_ENFORCE_ADMINS=true`.

Before step 5, MFA is optional, and the owner's access is never at risk. With enforcement on, an administrator without MFA can still sign in, but sees only the setup screen until they enrol. Nobody is locked out.

## 8. Administrator permission matrix and migration

Default deny: a route not in `src/server/lms/permissions.ts` is refused to every group. A test checks that all 81 routes an administrator can call are listed.

**Legend:** **W** = view and change; **R** = view only; blank = refused.

**Areas**

- **Admissions:** status, periods, admit, call requests, assistant enquiries.
- **Orders:** registrations and orders.
- **Finance:** payments, manual transfers, currency.
- **Academic:** programmes, enrolments, timetables, sessions, coursework, materials, monitoring settings.
- **Records:** a student's progress, grades, checklist, submissions.
- **Faculty:** recruitment, verification, teaching programmes.
- **Support:** student and guardian contact.
- **People:** user directory.
- **Users:** create, change, suspend, invite, groups, MFA reset.
- **Security:** audit log, platform, retention, test email.

| Area | Super | Admissions | Finance | Academic | Faculty | Student Support | Reporting |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Own profile, notifications | W | W | W | W | W | W | W |
| Overview | W | R | R | R | R | R | R |
| Admissions | W | W | | | | | R |
| Orders | W | R | R | | | | R |
| Finance | W | | W | | | | R |
| Academic | W | | | W | | | R |
| Records | W | | | R | | R | R |
| Faculty | W | | | | W | | R |
| Support | W | | | | | W | |
| People | W | R | R | R | R | R | |
| Users | W | | | | | | |
| Security | W | | | | | | |

**Rules**

- Only a Super Administrator, or an unassigned administrator (today: the owner), can assign groups. The only group anyone can give themselves is Super Administrator.
- A group change signs the person out at once.
- A new administrator created after this stage gets the group chosen when they are added, or Read-only Reporting if none is chosen.
- Dashboard tabs are hidden to match the groups, but the server is the control.

**Migration plan (needs owner approval)**

1. Deploy with migration 0008. All existing administrators show "Not assigned (full access, as before)". Nothing changes.
2. The owner assigns themselves Super Administrator, under Security, then All accounts, then Administrator group.
3. The owner reviews each other administrator and assigns the narrowest group. Each is signed out once when assigned.
4. Optionally add a second Super Administrator for recovery (section 7).

Nobody is promoted automatically and nobody loses access until the owner assigns them.

## 9. Content Security Policy

`scripts/csp.mts` runs after `next build`. For each of the 30 HTML pages it:

1. hashes the page's inline scripts (at most 3 per page);
2. writes a per-page rule into `out/_headers`.

The policy per page:

```
default-src 'self'; script-src 'self' 'sha256-…' (page's own) https://challenges.cloudflare.com [+ https://js.paystack.co on /checkout/ and programme pages];
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self';
connect-src 'self' [+ Paystack API and the legacy Google Form origins on /checkout/ only]; frame-src https://challenges.cloudflare.com [+ checkout.paystack.com on payment pages];
worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; upgrade-insecure-requests; report-uri /api/csp-report
```

- **Styles.** `style-src 'unsafe-inline'` is kept because React writes 101 `style=""` attributes in the current build. Style attributes cannot run code.
- **Scripts.** No `unsafe-inline` and no `unsafe-eval` for scripts.
- **Existing baseline.** The enforced baseline in `public/_headers` stays in both modes (`frame-ancestors`, `base-uri`, `object-src`, `form-action`). Browsers apply both policies.
- **Reports.** `POST /api/csp-report` stores only the directive, the blocked origin and the page path in `error_log` (route `csp`), rate limited.

**Evidence (local, enforce mode, Chrome):**

- 42 page loads covering all public pages, the sign-in and confirm pages, and student, instructor and administrator dashboards (5 tabs each): **0 violations**, no page errors, and all three roles signed in.
- An injected inline script was **blocked**, and an injected script from an unlisted origin was **blocked**.
- Framing is denied.
- `eval` could not be tested from DevTools, because DevTools evaluation is exempt from CSP. The policy omits `'unsafe-eval'`, so browsers refuse page-initiated `eval`.

**Rollout.** The default build is report-only. After 1 to 2 weeks with no unexpected reports, deploy a build made with `CSP_MODE=enforce npm run build`. Do not add an origin to make a report disappear unless it is a service the Academy chose.

## 10. Upload validation

All in `src/server/lms/upload-rules.ts` and `putUpload` (`src/server/lms/routes/coursework.ts`):

1. Allowed extensions per kind (documents, photos).
2. **File signature (magic bytes):**
   - PDF `%PDF-`; PNG, JPEG, GIF and WebP headers;
   - OLE for doc/xls/ppt;
   - ZIP for docx/xlsx/pptx, which must also contain `[Content_Types].xml` and the right folder;
   - text files must be valid UTF-8 with no NUL bytes and must not start as HTML, script, SVG or PHP.
3. MIME type comes from the server's own list, never from the browser.
4. Size: declared length checked first, then the body is read with a hard byte cap (25 MB documents, 3 MB photos).
5. Number of files: one file per submission, resource or photo (a new one replaces the old), and 30 uploads per user per hour.
6. Names:
   - refused if they contain path separators, `..`, control characters, or any executable extension anywhere (`cv.exe.pdf`);
   - otherwise cleaned and kept only as the download name.
7. Storage key: generated (`prefix/<uuid>`), with no part of the uploaded name or any user-supplied path.
8. Ownership: existing record checks (owner, assigned instructor, administrator with the Records or Academic area).
9. Executables refused whatever their name: Windows `MZ`, ELF, Mach-O and Java class headers, and `#!` scripts. Zip archives containing programs are refused.
10. Download: `Content-Disposition: attachment` (images inline), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private`.

Rejected uploads are written to the audit log.

**Malware scanning is not implemented.** Before R2 is switched on, choose one of:

- (a) a scanning service called from the Worker before `BUCKET.put` (for example an HTTP scanning API);
- (b) uploads into a quarantine prefix, scanned asynchronously, and released when clean;
- (c) accept the residual risk for PDF and Office files from enrolled students only.

Option (b) is recommended.

## 11. IP pseudonymisation

`ipPseudonym(env, ip)` = HMAC-SHA256 of the client IP under a secret key, used for audit logs, rate limits, registrations, holds and CSP reports. The key comes from, in order:

1. `IP_HASH_SALT`, a Wrangler secret used for nothing else;
2. otherwise a random 32-byte key generated once and kept in KV (`sec:ip-hash-key`);
3. otherwise a random per-isolate key held in memory only.

There is no constant fallback. `HOLD_SIGNING_KEY` is no longer used for IP hashing. Raw IP addresses are not stored. The key is never sent to the browser or logged; Security shows only which source is in use.

**Rate limits.**

- A single atomic upsert per hit (no read-then-write race). A test fires 10 parallel requests: exactly 4 pass.
- Keys are built on the server from the pseudonym, user id or normalised email, so a client cannot choose them.
- Counters are removed daily.
- Sign-in: 20 per address per 10 minutes (raised from 8 so a classroom behind one address is not blocked), and 4 per email per 10 minutes.
- **Recommended at the Cloudflare level:** a rate-limiting rule for `/api/auth/*` and `/api/assistant/ask`. It needs Cloudflare dashboard access and was not done here.

## 12. Retention policy

Configurable under Security, then Data retention (Super Administrator).

**How deletion runs**

- Deletion runs once a day.
- It deletes at most 500 rows per category, oldest first.
- Each run is idempotent, writes an audit entry with its counts, and runs only allow-listed SQL.
- Financial and academic tables cannot be added.

| Record | Group | Recommended | State now |
| --- | --- | --- | --- |
| Sign-in links | Authentication | 1 day after expiry | **On** (as before) |
| Sessions | Authentication | at expiry | **On** (as before) |
| Rate-limit counters | Authentication | 1 day | **On** (as before) |
| Admissions assistant questions | Admissions enquiries | 180 days | **On** (as before, stated in the privacy policy) |
| Error log | Operational | 90 days | Off: needs approval |
| Read notifications | Communications | 365 days | Off: needs approval |
| Student AI study-assistant chats | AI conversations | 365 days | Off: needs approval |
| Security audit log | Security logs | 730 days | Off: needs approval |
| Student-instructor messages | Conversations | Review by hand 2 years after the enrolment ends | Never automatic |
| Contact log | Support records | 3 years after the student leaves | Never automatic |
| Call requests | Admissions enquiries | 2 years | Never automatic (needs approval first) |
| Orders, instalments, payments, webhook events | Financial | Legal and accounting period | Never automatic |
| Enrolments, timetables, sessions, coursework, grades, attendance, checklist | Academic | Permanent academic record | Never automatic |
| Accounts and applications | Accounts | Only on a verified deletion request | Never automatic |

Update `/privacy/` only after the owner approves these periods.

## 13. Security regression tests added (`tests/security.test.ts`, 29 tests)

- **Student sessions:**
  - cookie attributes and 12-hour lifetime;
  - expiry after 10 idle minutes, with the row deleted, the cookie cleared and the old cookie refused;
  - activity resets the timer while polling and page loads do not;
  - throttling;
  - `ago` clamped and never in the future;
  - an expired session cannot be revived (device sleep);
  - the absolute limit;
  - staff unchanged by default, and the admin idle limit when configured;
  - logout of the current device versus all devices;
  - session fixation;
  - only token hashes are stored.
- **Admin MFA:**
  - RFC 6238 vectors;
  - setup with the secret encrypted at rest;
  - a wrong code refused;
  - enable returns 10 codes and signs out other devices;
  - the email link alone gives no access to 4 protected routes;
  - invalid and replayed codes refused;
  - the token is replaced after verification;
  - a recovery code works once;
  - the 6th attempt is refused (429);
  - a pending session lapses after 10 minutes;
  - disable needs a code;
  - Super Administrator reset works, self-reset is refused, a limited group cannot reset;
  - the enforcement switch blocks administration until enrolment without locking out;
  - with no key, setup is refused and sign-in still works.
- **Permissions:**
  - the table covers every route an administrator can call;
  - unknown routes and groups are denied;
  - a finance administrator is refused 6 restricted actions;
  - reporting is read-only;
  - nobody can raise their own group;
  - a group change ends sessions;
  - the unassigned owner keeps full access.
- **Isolation (Part J):**
  - a student is refused another student's profile, progress, grades, submission file, messages and checklist;
  - lists contain only the student's own work;
  - a student cannot submit to another student's assignment;
  - an instructor is refused unassigned students, another instructor's session, outcomes and tasks;
  - role, registration number and group cannot be changed through `PATCH /api/me`;
  - suspension ends sessions;
  - malformed identifiers are refused.
- **Uploads:**
  - 11 content cases: valid PDF, DOCX and text accepted; wrong signature, renamed executable, `.exe`, double extension, path trick, HTML-as-text, an archive with a program, and a fake DOCX refused;
  - the generated storage key;
  - download headers;
  - another student and a signed-out visitor are refused the download;
  - size limit;
  - control-character names;
  - empty files;
  - the per-user upload rate.
- **Privacy and limits:**
  - HMAC with `IP_HASH_SALT` verified;
  - no hash matches the old `sha256(ip|"sma")` or the hold key;
  - secrets never appear in API answers or headers;
  - the rate limit holds under 10 concurrent requests.
- **Retention:**
  - categories that are off delete nothing;
  - an enabled category deletes only old rows;
  - financial tables are refused;
  - protected tables are unchanged;
  - runs are audited;
  - batch limits are respected;
  - runs are idempotent;
  - settings are refused outside the Security area.
- **CSP:**
  - generated from the real build;
  - page hashes present;
  - no `unsafe-inline`, `unsafe-eval` or wildcard in `script-src` on any page;
  - Turnstile allowed;
  - Paystack only on payment pages;
  - reports stored without full URLs.

## 14. Test results (22 Nov 2026)

| Check | Result |
| --- | --- |
| Baseline before changes | 162/162 tests, TypeScript, ESLint pass; `npm audit` 0 vulnerabilities (matches the audit) |
| `npm test` after changes | **191/191 pass** (162 existing + 29 new). Four existing tests were updated for intended behaviour changes (section 3) |
| `tests/security.test.ts` repeated | 29/29 on three consecutive runs |
| TypeScript (site and Worker) | Pass |
| ESLint | Pass, 0 problems |
| `npm audit` | 0 vulnerabilities |
| Secret pattern scan | No secret values; placeholders only in `.dev.vars.example` |
| `npm run build` (+ CSP postbuild) | Pass; 30 pages, longest policy 725 characters |
| Browser, enforced CSP | 42 page loads, 0 violations, 0 page errors; injected inline and external scripts blocked |
| Browser, idle logout | Warning, activity recording, expiry, row deletion and cookie clearing verified |

**Not performed:** penetration testing, load or denial-of-service testing, any test against production, and Turnstile or Paystack under CSP (no internet in the sandbox). This is a code review plus automated and local browser testing, not a penetration test.

## 15. Owner actions (Cloudflare and secrets)

Do these in order, after reviewing this document. Never paste secret values into chat or the repository.

1. **Back up D1** (superseded by Stage 3A: use `npm run db:backup`, since `wrangler d1 export` refuses this database; see `docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md`): formerly `npx wrangler d1 export …`, stored off-machine.
2. **Check migrations:** `npx wrangler d1 migrations list skillmountainacademy-db --remote`.
3. **Apply migrations** (with approval): through the gated Stage 3A procedure (`docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md`); `npm run db:migrate` now refuses unless every gate passes.
4. **Secrets:**
   - `openssl rand -base64 36`, then `npx wrangler secret put IP_HASH_SALT`;
   - `openssl rand -base64 32`, then `npx wrangler secret put MFA_ENCRYPTION_KEY`. Keep a copy in a password manager: losing it disables every enrolled factor.
5. **Deploy** the default build (CSP report-only): `npm run build && npm run deploy`.
6. **Check Cloudflare zone features** that inject scripts (Rocket Loader, Email Obfuscation, Web Analytics, Bot Fight Mode) and watch Security, then error log entries with route `csp`, for 1 to 2 weeks.
7. **Enrol yourself** in two-step sign-in, store the recovery codes offline, and assign yourself Super Administrator.
8. **Assign groups** to other administrators (section 8). Add a second Super Administrator.
9. **When everyone is enrolled:** `npx wrangler secret put MFA_ENFORCE_ADMINS` (value `true`), or set it as a plain variable.
10. **Optional staff idle limits** (section 6): `ADMIN_IDLE_MINUTES`, `ADMIN_SESSION_HOURS`, `INSTRUCTOR_IDLE_MINUTES`.
11. **When CSP reports are clean:** `CSP_MODE=enforce npm run build && npm run deploy`.
12. **Approve the retention periods** (section 12), then switch them on under Security and update the privacy policy.
13. **Optional:** add a Cloudflare rate-limiting rule for `/api/auth/*` and `/api/assistant/ask`.

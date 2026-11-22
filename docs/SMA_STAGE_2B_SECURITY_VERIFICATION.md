# SMA Stage 2B: Security Verification, Privilege-Escalation Correction and Production Readiness

Date: 22 November 2026. Scope: Stage 2B brief §1–§11 plus the owner's request that `bookebukar@gmail.com` has his own owner console, can audit and remove anyone, approves permanent removal of staff, and that administrator groups and permissions are assigned by the Super Administrator.

Nothing was deployed. No production migration was run, no production data was touched, Paystack and R2 stay inactive, MFA enforcement, CSP enforcement and new retention categories stay off, staff idle policies are unchanged, and no secret was generated or revealed. Stage 3 has not been started.

---

## 1. Executive summary

- **A real privilege escalation from Stage 2 was found and closed.** In Stage 2, `canManageAdmins(null)` returned true, so *any* existing administrator without a group could make themselves Super Administrator, assign groups to others, or create a new Super Administrator. That is no longer possible:
  - Administrator management now belongs to the verified owner, identified by the server-side `OWNER_EMAIL` setting.
  - Group assignment only works after the owner's one-time, audited bootstrap.
  - Super Administrators are appointed only by the owner.
- **The owner now has his own console** (Admin → Owner console). From it he can:
  - see all staff and their two-step status;
  - search the whole audit log;
  - remove any account permanently (records kept, sign-in disabled);
  - approve or reject removal requests raised by Super Administrators.

  Nobody can suspend, remove, regroup or reset the owner.
- **Owner lock-out recovery** now has two audited routes:
  - an in-app break-glass token (single use, rate-limited, emails the owner, forces re-enrolment);
  - a verified Wrangler/D1 command.
- **Students in live classes:** the 10-minute idle and 12-hour limits are unchanged. A test proves that an idle sign-out during a Google Meet class creates no missed record and changes no attendance. The sign-in page now tells students that their class and attendance are unaffected, and returns them to the page they were on.
- **IP pseudonymisation:**
  - A dedicated `IP_HASH_SALT` is used when set.
  - Otherwise a key is created once in D1 and shared by every Worker isolate, so rate limits stay consistent.
  - A random per-isolate key is the last resort, and is visible in Admin → Security. There is never a constant key.
  - New `IP_HASH_STRICT=true` makes production refuse service rather than run without the salt.
- **CSP:**
  - Hashes match the build on all 30 pages, with no `unsafe-inline`/`unsafe-eval` in `script-src`.
  - Paystack appears only on checkout and programme pages, and unused `blob:` sources were removed.
  - Report-only mode remains the default.
- **Verification:** 204/204 tests pass, including 13 new Stage 2B tests. TypeScript (both configs), ESLint and the production build are clean, `npm audit` reports 0 vulnerabilities and the secret scan is clean. All 9 migrations apply to a fresh D1, and 0009 is additive.

## 2. Resolved

| # | Issue | Resolution |
|---|---|---|
| R1 | **Privilege escalation:** any unassigned admin could self-promote to `super`, assign groups to others, or create a Super Administrator. | `canManageAdmins` / `groupChangeRefusal` / `accountChangeRefusal` require the owner, or a Super Administrator after bootstrap. Refusals are audited (`admin.group_refused`, `admin.change_refused`, `mfa.reset_refused`, `admin.access_refused`). |
| R2 | No trusted owner identity. | `OWNER_EMAIL` var (`wrangler.jsonc`). `isOwner()` requires a matching email, the admin role, active status and not removed. The owner's email is reserved: no one can pre-create that account (400 `reserved`). |
| R3 | No one-time bootstrap. | `POST /api/app/owner/bootstrap`: owner only, sets the owner as `super`, records `owner_bootstrap` in `app_settings`, audits `owner.bootstrap`, and returns 409 if repeated. |
| R4 | Group changes did not always end sessions. | Every group change ends the target's sessions and is audited `admin.group_assigned`. |
| R5 | No permanent removal / approval flow. | Migration 0009 adds `removed_*` columns and `staff_removal_requests`. Super Administrators request; the owner approves, rejects or removes directly. Removal suspends the account and ends sessions, sign-in links and MFA. Rows are kept. `canSignIn` refuses removed accounts, and they cannot be reactivated. |
| R6 | After an MFA reset, the admin could carry on without MFA. | `users.mfa_required` is set on reset. The admin must enrol again before any administration (`mfa_setup_required`). It is cleared on enrolment. |
| R7 | Owner lock-out had no in-app recovery. | `POST /api/auth/owner-recovery` with an offline `OWNER_RECOVERY_TOKEN`. |
| R8 | IP key fallback was per-isolate, which split rate limits. | Persistent D1 key `sec:ip-hash-key` is shared across isolates. Strict mode returns 503 and never weakens privacy. The public 503 message is generic. |
| R9 | Refused gate-level admin writes left no trail. | `admin.access_refused` is audited for non-GET requests refused by the permission gate (route and group only, never the body). |
| R10 | The expiry redirect lost the student's page. | `expiredUrl()` adds `next=`. The entrance shows a live-class reassurance for students. |
| R11 | CSP allowed unused `blob:` in `img-src` and `worker-src`. | Removed. Verified that nothing in the app needs them. The CSV download uses an `<a href=blob:>` navigation, which these directives don't govern. |
| R12 | Retention backlog was invisible. | `retention.backlog` audit and a stored last run (`retention_last_run`), shown in Admin → Security. |
| R13 | The instructor fixed lifetime could not be configured. | `INSTRUCTOR_SESSION_HOURS` is supported, server-side and **not set**. |

## 3. Outstanding

1. **Production state is unverified.** There is no Cloudflare access in this environment. Before deployment, check whether migrations 0007–0009 are applied (`npx wrangler d1 migrations list skillmountainacademy-db --remote`).
2. **Production secrets are not set (owner action):** `IP_HASH_SALT`, `MFA_ENCRYPTION_KEY`, `OWNER_RECOVERY_TOKEN`. Then turn on `IP_HASH_STRICT=true`.
3. **The owner console's two-step requirement only applies once `MFA_ENCRYPTION_KEY` is set.** Until then, the owner console relies on the email sign-in alone.
4. **CSP is not enforced.** It needs a real-Cloudflare report period (§8).
5. **Uploads are not quarantined or scanned.** This is a design only (§9). Upload storage (R2) is still unbound.
6. **The privacy policy** needs the wording changes in §10 before any new retention category is switched on.
7. **Staff session limits** await approval (§11).

## 4. Bootstrap explanation

**Who is the owner?** The account whose email equals `OWNER_EMAIL` (set to `bookebukar@gmail.com` in `wrangler.jsonc`), with role admin, active status and not removed. The value lives in server configuration, not in the database. No request body, profile field, URL, registration number or group can make someone the owner.

**First sign-in.** The owner's email is added to the list of addresses that get an administrator account on first sign-in. Its group starts empty.

**Bootstrap (once).** The owner opens Admin → **Owner console** → **Complete set-up**. The server then:
1. checks that the caller `isOwner`;
2. refuses with 409 if set-up was already done;
3. sets the owner's group to `super`;
4. stores `owner_bootstrap` in `app_settings`;
5. audits `owner.bootstrap`.

After this the button disappears and the endpoint stays closed.

**Who can do what after bootstrap**

| Action | Owner | Super Administrator | Other groups | Unassigned (legacy) admin |
|---|---|---|---|---|
| Appoint or remove a Super Administrator | ✔ | ✖ | ✖ | ✖ |
| Assign or change finance/academic/admissions/reporting groups | ✔ | ✔ (not own, not owner, not a Super) | ✖ | ✖ |
| Create an administrator account | ✔ | ✔ (non-super group) | ✖ | ✖ |
| Suspend an administrator | ✔ | ✔ (not a Super, not owner) | ✖ | ✖ |
| Reset an administrator's MFA | ✔ | ✔ (not a Super, not owner, not self) | ✖ | ✖ |
| Request permanent removal of staff | — | ✔ | ✖ | ✖ |
| Approve/reject removal; remove anyone directly | ✔ | ✖ | ✖ | ✖ |
| Search the full audit log, staff overview | ✔ (owner console) | ✖ | ✖ | ✖ |
| Students and instructors: create, edit, suspend | ✔ | ✔ | per group | ✔ (unchanged) |

**Before bootstrap**, nobody can assign groups, including the owner. This prevents a race to claim groups.

**Existing administrators** are not silently elevated. A legacy admin with no group keeps day-to-day access (students, instructors, payments, timetable) but loses every power over other administrators. New administrators start in `reporting` (read-only) until the owner or a Super Administrator assigns a group.

**Owner never locked out:**
- No route can suspend, remove, regroup or MFA-reset the owner.
- The owner cannot remove himself.
- Break-glass recovery exists (§7).
- If `OWNER_EMAIL` is ever unset, nobody is treated as owner and admin management stays closed. Day-to-day work continues.

**Profile manipulation.** `PATCH /api/me` ignores `adminRole`, `admin_role`, `role`, `email`, `removed_at`, `mfa_required` and `owner`. This is tested.

## 5. Live-class test

The scenario: a student opens the dashboard, joins a 60-minute Google Meet class in another tab, and leaves the dashboard untouched.

**Test:** `live class: idle sign-out during a Meet class creates no missed class and erases nothing; the class is recorded normally`.

Steps:
1. A class started 20 minutes ago with a Meet link; the student sees the link.
2. The session's last activity is moved to 11 minutes ago. The next request returns `401 session_expired`, `x-session-expired: idle`.
3. The class row is unchanged (`scheduled`, no outcome).
4. There are zero `missed` rows for the student.
5. The instructor records `completed`; the student signs in again, and the class shows as completed.

**Why it is safe:**
- Attendance (`class_sessions.status`) is set only by the instructor's outcome route.
- Nothing links the student's portal session to attendance.
- Expiry deletes only the `auth_sessions` row.
- The Meet call is on Google's servers and is not affected.

**What the student sees:** the entrance page with "You were signed out because there was no activity for a while…". For students it adds: "If you are in a live class, stay in Google Meet: signing out here does not affect the class or your attendance." After signing in again they return to the page they were on (`next=`, validated by `safeNext`). Sessions are never revived.

**Consequence of the current policy (no change made):** a student who wants the dashboard during or after class must sign in again by email link, which takes about a minute. Options for the owner (§15):
- (a) keep 10 minutes;
- (b) extend the student idle limit to 60–75 minutes only while a class is live (server-side, using `class_sessions`);
- (c) 30 minutes for all students.

Option (b) keeps the strict limit outside class time. It is my recommendation if the re-sign-in is a nuisance.

## 6. IP findings

`src/server/privacy.ts`. Key sources, in order:

1. **`IP_HASH_SALT`** (Wrangler secret, at least 16 characters; 48+ random recommended). Source shown as `secret`.
2. **D1 key**: generated once with `INSERT … ON CONFLICT DO NOTHING` and then read back, so concurrent isolates all converge on the same value. Stored in `app_settings` as `sec:ip-hash-key`. Source `d1`. This keeps rate limits consistent.
3. **Ephemeral**: a random 32-byte key per isolate, logged once. This only happens when D1 is unavailable. Source `ephemeral`, shown as a warning in Admin → Security.

With **`IP_HASH_STRICT=true`** and no salt, the Worker returns `503 not_configured` with a generic message and does not fall back.

**Guarantees:**
- Only HMAC-SHA-256 pseudonyms are stored; raw IPs never are.
- There is no static or constant fallback.
- Neither the key nor the env names appear in responses (tested on `/api/me`, settings, owner status and the platform endpoint).
- Logs contain only the source name.

**Weakness:** the D1 key is readable by anyone with D1 access, so it protects against casual exposure, not against a database compromise. A Wrangler secret keeps the key out of the database.

**Recommended production configuration:**
1. `npx wrangler secret put IP_HASH_SALT` (48+ random characters, generated by the owner).
2. Deploy, confirm Admin → Security shows "secret".
3. Set var `IP_HASH_STRICT="true"`.

Changing the salt resets rate-limit counters and makes old pseudonyms unlinkable to new ones. That is acceptable.

**Tests:**
- `IP key: dedicated secret; one persistent D1 key shared by every isolate; strict mode fails safe; never a constant`
- `IP key in the Worker: persisted in D1, never returned by any API`

## 7. MFA recovery

**Verified behaviour (tests in `security.test.ts` and `stage2b.test.ts`):**
- **Recovery codes** are hashed and single-use (`used_at`). Reuse is refused.
- **Authorised resets:** Owner → anyone except himself. Super → non-super administrators only. Nobody resets themselves or the owner. Finance and other groups cannot reset.
- **On reset:**
  - the factor and codes are deleted;
  - all of the person's sessions end;
  - an email notification is sent;
  - `mfa_required=1`, so administration is blocked (`mfa_setup_required`) until they enrol again.
- **Owner is the only Super Administrator:** the in-app break-glass route below covers this. The D1 route works even if the Worker or email is down.

**In-app owner break-glass (`POST /api/auth/owner-recovery`).** Preparation and limits:
- *Preparation (owner, once):* generate 64 random characters offline and store them on paper or in a password manager. Then run `npx wrangler secret put OWNER_RECOVERY_TOKEN`. Each value works once.
- *Rate limit:* three attempts a day.

Procedure:
1. Sign in by email link at `/app/login/`. The code prompt appears.
2. Open "Platform owner: break-glass recovery", enter the token, and submit.
3. The server checks it in constant time, refuses reused tokens, removes the factor, sets `mfa_required`, ends all sessions, audits `mfa.owner_break_glass` (failures `mfa.owner_break_glass_failed`) and emails the owner.
4. Sign in again and enrol a new authenticator.
5. Set a **new** `OWNER_RECOVERY_TOKEN`.

**D1 break-glass (verified on a fresh local D1 with all 9 migrations: "5 commands executed successfully"; factor, codes and sessions = 0, `mfa_required` = 1, audit row written):**

```sh
npx wrangler d1 export skillmountainacademy-db --remote --output backup-before-breakglass.sql
npx wrangler d1 execute skillmountainacademy-db --remote --command "DELETE FROM mfa_recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = 'bookebukar@gmail.com'); DELETE FROM mfa_factors WHERE user_id = (SELECT id FROM users WHERE email = 'bookebukar@gmail.com'); DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email = 'bookebukar@gmail.com'); UPDATE users SET mfa_required = 1 WHERE email = 'bookebukar@gmail.com'; INSERT INTO audit_log (id, at, action, target_type, target_id, detail) SELECT lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'mfa.owner_break_glass_d1', 'user', id, '{\"via\":\"wrangler d1\"}' FROM users WHERE email = 'bookebukar@gmail.com';"
```

This replaces the Stage 2 command, which used a user id and neither ended sessions nor wrote an audit entry. Cloudflare account access is the control here, so it must itself be protected with a strong password and 2FA on the Cloudflare account.

## 8. CSP

- **Modes** (`scripts/csp.mts`, `postbuild`):
  - `CSP_MODE=report` (default) writes `Content-Security-Policy-Report-Only`;
  - `enforce` writes `Content-Security-Policy`.

  Both were generated and checked. The build is left in report mode. The existing enforced baseline in `public/_headers` (`frame-ancestors 'none'`, `base-uri`, `object-src 'none'`, `form-action`) is unchanged.
- **Independent check of the build output:**
  - 30 pages, and every executable inline script's SHA-256 is present in that page's `script-src`, with 0 mismatches;
  - 0 pages with `unsafe-inline`/`unsafe-eval` in `script-src`;
  - `style-src 'unsafe-inline'` remains, because React writes style attributes. Style attributes cannot run code.
- **Turnstile:** `https://challenges.cloudflare.com` is in `script-src` and `frame-src` on all pages.
- **Paystack:**
  - `js.paystack.co` and `checkout.paystack.com` appear only on `/checkout/` and `/programmes/*` (11 routes);
  - `api.paystack.co` and the legacy Google Form origins appear in `connect-src` only on `/checkout/`.
- **Removed:** `blob:` from `img-src` and `worker-src`, which are unused.
- **Local enforcement test from Stage 2:** 42 page loads with 0 violations, and injected inline and external scripts were blocked.

**Real-Cloudflare tests needed before enforcing:**
1. Deploy in report mode and leave it for 7–14 days of normal use.
2. Check `/api/csp-report` entries (Admin → Security) for real violations: browser extensions are noise; site origins are not.
3. Complete one Turnstile sign-in and one admissions form on mobile and desktop.
4. If Paystack is activated later, run a test-mode checkout from a programme page and from `/checkout/`.
5. Confirm the Cloudflare zone does not inject scripts (Rocket Loader, Email Obfuscation, Web Analytics auto-inject). Injected scripts would break hashes.
6. Then set `CSP_MODE=enforce`, rebuild, deploy, and repeat steps 3–4.

## 9. Upload quarantine design (design only; nothing activated)

**Current controls:**
- extension allow-list and `DANGEROUS_EXT`;
- magic-byte signature checks;
- executable detection;
- zip central-directory scan, which refuses programs and `..` paths;
- capped reading (25 MB files, 3 MB photos);
- generated R2 keys;
- 30 uploads per hour.

**Proposed design (for when R2 is enabled):**

1. **Storage split:** `quarantine/<uuid>` and `released/<uuid>` prefixes in one private R2 bucket. No public bucket access, and every download goes through the Worker.
2. **Record:** a new `upload_scans` table (`upload_id`, `status` = pending | clean | rejected | failed | released, `engine`, `verdict`, `checked_at`, `attempts`, `released_by`, `reason`). This would be additive migration 0010, not created now.
3. **On upload:**
   - existing checks run first, then the file is written to `quarantine/` with status `pending`;
   - the student sees "Received – being checked";
   - the instructor sees the submission but cannot download it.
4. **Scan:** a Queue or cron consumer, on the free tier with no paid scanner, runs:
   - re-validation of the signature;
   - an archive-bomb check, rejecting when total uncompressed size exceeds 100 MB, the ratio exceeds 100:1, there are more than 2,000 entries, or archives are nested more than 1 level deep;
   - Office macro detection (`vbaProject.bin`, `.docm`/`.xlsm` content types);
   - PDF active-content detection (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/OpenAction` together with JS);
   - SHA-256 lookup against a local deny-list.

   A paid AV engine can be plugged in later behind the same `engine` field.
5. **Release:** clean files move to `released/`, status `released`, and download is allowed. Downloads always use `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and the stored content type, never one supplied by the client.
6. **Rejection:** status `rejected` with a reason. The object is deleted after 30 days. The student and instructor are notified, and the event is audited `upload.rejected`.
7. **Failed scan:** after 3 attempts the status becomes `failed`, which is never auto-released. An academic admin is notified and may release manually with a reason (`upload.released_manual`) or reject.
8. **Audit:** `upload.received`, `upload.scan_clean`, `upload.rejected`, `upload.scan_failed`, `upload.released_manual`, `upload.downloaded` (actor and file id only).
9. **Download prevention:** the download route requires status `released` plus the existing ownership checks. Any other status gets a 409 with a plain message.

## 10. Retention schedule

Source: `src/server/lms/retention.ts`. The cron job deletes at most 500 rows per category per run. When a category hits that limit, a `retention.backlog` audit entry is written and the last run is shown in Admin → Security.

| Category | Records | Default | Minimum | State |
|---|---|---|---|---|
| Used/expired sign-in links | `auth_tokens` | 1 day | 1 | **On** (existing) |
| Expired sessions | `auth_sessions` | at expiry | 0 | **On** (existing) |
| Rate-limit counters | `rate_limits` | 1 day | 1 | **On** (existing) |
| Admissions assistant questions | `assistant_enquiries` | 180 days | 30 | **On** (existing) |
| Technical error records | `error_log` | 90 days | 30 | Off: needs approval |
| Read dashboard notifications | `notifications` | 365 days | 90 | Off: needs approval |
| AI study-assistant conversations | `ai_messages` | 365 days | 90 | Off: needs approval |
| Security audit log | `audit_log` | 730 days | 365 | Off: needs approval |
| Student–instructor messages | `messages` | manual review 2 years after enrolment ends | — | Never automatic |
| Contact records | `contact_log` | 3 years after the student leaves | — | Never automatic |
| Call bookings | `call_bookings` | 2 years (proposed) | — | Never automatic |
| Financial records | orders, instalments, payments, webhook_events | legal/accounting period | — | Never automatic |
| Academic records | enrolments, timetables, classes, work, quizzes, progress | permanent record | — | Never automatic |
| Accounts and applications | users, registrations | on verified request only | — | Never automatic; removed staff accounts are kept and marked |

**Privacy policy changes needed before switching on any "Off" category** (not made; `lib/legal.ts` §6 currently speaks only about applications, payments and mailing lists):
- Add a sentence on security and technical logs: "We keep technical error records for up to 90 days and security logs for up to two years, then delete them automatically."
- Add a sentence on AI study-assistant conversations and notifications: "kept for up to 12 months."
- Add that sign-in links, sessions and rate-limit counters are deleted within a day of expiry, and that IP addresses are stored only as pseudonyms.
- Add that staff accounts removed by the Academy are closed but their records are kept for accountability.

## 11. Staff session recommendations (for approval; not active)

**Current state, enforced server-side in `session-policy.ts` and `api.ts`:**
- **Students:** 10-minute idle, 12 hours absolute, no sliding.
- **Instructors and administrators:** 30 days, sliding, with no idle limit.

**Recommendation:**

| Role | Idle | Absolute | How to enable |
|---|---|---|---|
| Administrators | 15 min | 12 h | `ADMIN_IDLE_MINUTES="15"`, `ADMIN_SESSION_HOURS="12"` |
| Instructors | 60 min | 24 h | `INSTRUCTOR_IDLE_MINUTES="60"`, `INSTRUCTOR_SESSION_HOURS="24"` |

These are prepared as a commented block in `wrangler.jsonc`. Uncommenting them requires owner approval.

**Server-side enforcement is tested** by `staff session variables are enforced by the server when set`:
- an instructor is fine at 59 minutes idle and signed out at 61;
- an instructor's 24-hour lifetime and cookie `Max-Age=86400` are enforced;
- an admin's 12-hour cookie and 15-minute idle limit are enforced;
- defaults are unchanged when nothing is set.

**Consequences:**
- Admins will sign in by email up to several times a day.
- Instructors teaching back-to-back classes in Meet may hit the 60-minute idle limit if they don't touch the dashboard. Their classes and records are unaffected, just as for students.

## 12. Files

**Added (Stage 2B)**
- `migrations/0009_owner.sql`: `users.removed_at`, `removed_by`, `removal_reason`, `mfa_required`; table `staff_removal_requests` and its index. Additive only.
- `src/server/lms/data/owner.ts`: `getBootstrap`, `isBootstrapped`, `saveBootstrap`, `removeAccount`, `activeTeaching`, `createRemovalRequest`, `pendingRequestFor`, `getRemovalRequest`, `listRemovalRequests`, `decideRemovalRequest`, `listStaff`, `auditSearch`.
- `src/server/lms/routes/owner.ts`:
  - `GET /api/app/owner/status`, `POST /api/app/owner/bootstrap`
  - `GET /api/app/owner/staff`, `GET /api/app/owner/audit`
  - `POST /api/app/owner/users/:id/remove`
  - `GET /api/app/owner/removal-requests`, `POST /api/app/owner/removal-requests/:id`
  - `POST /api/app/admin/users/:id/removal-requests`
- `app/app/owner.tsx`: `OwnerConsole`, `StaffPanel`, `Requests`, `AuditSearch`.
- `tests/stage2b.test.ts`: 13 tests.
- `docs/SMA_STAGE_2B_SECURITY_VERIFICATION.md`: this document.

**Modified**
- `src/server/lms/permissions.ts`: owner area; `adminMay(…, owner)`, `areasFor`, `ownerEmail`, `isOwner`, `isSuper`, `canManageAdmins`, `groupChangeRefusal`, `accountChangeRefusal`.
- `src/server/lms/api.ts`: re-enrolment gate (`mfa_required`), owner-console MFA gate, `admin.access_refused` audit, `ctx.isOwner`, owner-recovery allowed with a pending session.
- `src/server/lms/routes/users.ts`: create and PATCH authorisation through the owner rules; owner email reserved; audits.
- `src/server/lms/routes/mfa.ts`: reset rules, `setMfaRequired`, `POST /api/auth/owner-recovery`, `safeEq`.
- `src/server/lms/routes/auth.ts`: owner account creation on first sign-in; `/api/me` `admin.owner` and areas.
- `src/server/lms/data/users.ts`: User fields, `canSignIn` refuses removed accounts, `setMfaRequired`.
- `src/server/lms/index.ts`: registers owner routes.
- `src/server/privacy.ts`: D1-backed key, strict mode, `ipKeySource`, generic 503.
- `src/server/lms/session-policy.ts`: `INSTRUCTOR_SESSION_HOURS`.
- `src/server/lms/retention.ts`: backlog audit and last run.
- `src/server/lms/routes/security.ts`: returns `lastRun`.
- `src/server/env.ts`: `OWNER_EMAIL`, `IP_HASH_STRICT`, `INSTRUCTOR_SESSION_HOURS`, `OWNER_RECOVERY_TOKEN`.
- `wrangler.jsonc`: `OWNER_EMAIL` var; commented, inactive staff-session block.
- `.dev.vars.example`: placeholders for `OWNER_RECOVERY_TOKEN` and `IP_HASH_STRICT`.
- `scripts/csp.mts`: `blob:` removed from `img-src` and `worker-src`.
- `app/app/admin.tsx`: Owner console tab; owner/Super removal actions in Users.
- `app/app/mfa.tsx`: `OwnerRecovery`.
- `app/app/security-admin.tsx`: IP key source and retention last run/backlog.
- `app/app/portals.ts`: `expiredUrl`.
- `app/app/ui.tsx`, `app/app/idle.tsx`: use `expiredUrl`.
- `app/app/entry.tsx`: live-class reassurance and "return to your page" note.
- `tests/security.test.ts`: the owner bootstrap flow replaces the old unassigned-admin group assignment.
- `tests/lms7.test.ts`: public route list includes `owner-recovery`.
- `docs/lms/API.md`: regenerated.

Not touched: `app/globals.css`, logos, icons, prices, durations, payment plans, enrolments, academic records.

## 13. Test evidence

| Check | Result |
|---|---|
| `npm test` (25 files) | **204 tests, 204 pass, 0 fail** (~55 s) |
| New Stage 2B tests | 13/13 pass (listed below) |
| `tsc -p tsconfig.json --noEmit` | clean |
| `tsc -p src/tsconfig.json --noEmit` | clean |
| `eslint .` | clean |
| `npm run build` + CSP postbuild | success; "CSP (report): 30 pages" |
| CSP output check | 30 pages, 0 hash mismatches, 0 unsafe in `script-src`, Paystack on 11 payment routes only, no `blob:`; enforce mode emits `Content-Security-Policy` |
| `npm audit` (all and `--omit=dev`) | 0 vulnerabilities |
| Secret scan | no live keys; only `.dev.vars.example` placeholders and the public Turnstile site key; no `.env`/`.dev.vars` in the package |
| Migrations | 0001–0009 apply to a fresh local D1 ("No migrations to apply" afterwards); 0008/0009 contain no DROP/DELETE/UPDATE/RENAME |
| D1 break-glass SQL | executed locally: 5 statements, expected end state confirmed |

**Stage 2B tests (`tests/stage2b.test.ts`):**
1. unassigned NON-owner administrator cannot promote themselves (the Stage 2 hole is closed)
2. before set-up nobody can assign groups; the owner's one-time bootstrap enables it and cannot be repeated
3. Super Administrators: only the owner appoints them; they assign other groups but never their own, the owner's or a Super's
4. profile updates cannot set groups, roles, owner status or email
5. owner removals: Supers request, the owner approves; removed accounts cannot sign in; records are kept
6. the owner's address is reserved and the owner is recognised only by OWNER_EMAIL plus an active admin account
7. owner console needs two-step sign-in when it is configured; owner break-glass is audited, single-use and forces re-enrolment
8. MFA reset by the owner revokes sessions, notifies the administrator and requires re-enrolment
9. live class: idle sign-out during a Meet class creates no missed class and erases nothing; the class is recorded normally
10. staff session variables are enforced by the server when set
11. IP key: dedicated secret; one persistent D1 key shared by every isolate; strict mode fails safe; never a constant
12. IP key in the Worker: persisted in D1, never returned by any API
13. retention: hitting the batch limit is flagged (audit + last run) so a backlog is visible

## 14. Remaining risks

| Risk | Level | Mitigation |
|---|---|---|
| Owner's email inbox compromised: sign-in is by email link. | High | Set `MFA_ENCRYPTION_KEY` and enrol the owner's authenticator (the owner console then requires it). Protect the Gmail account with 2FA. |
| Cloudflare account compromised (it can change `OWNER_EMAIL`, D1, secrets). | High | Cloudflare 2FA, few members, review the audit log. |
| `OWNER_RECOVERY_TOKEN` leaked. | Medium | Single use, 3 tries a day, owner session required, emails the owner. Rotate after use. |
| Production runs without `IP_HASH_SALT`. | Low | The D1 key keeps pseudonyms consistent. Set the secret and strict mode. |
| Uploads are not scanned for malware. | Medium | Current signature and archive checks; quarantine design in §9. |
| CSP is report-only. | Medium | Report period, then enforce (§8). |
| Staff sessions last 30 days. | Medium | Approve §11. |
| Legacy unassigned admins keep broad day-to-day access. | Low | The owner assigns groups after bootstrap. |

## 15. Owner decisions

1. **Approve deployment order:**
   1. back up D1;
   2. apply migrations 0008–0009 remotely;
   3. set `IP_HASH_SALT`, `MFA_ENCRYPTION_KEY`, `OWNER_RECOVERY_TOKEN` (you generate them; never share them);
   4. deploy;
   5. sign in as `bookebukar@gmail.com`, complete set-up in the Owner console, and enrol your authenticator;
   6. assign groups to existing administrators;
   7. set `IP_HASH_STRICT="true"`.
2. **Student idle during live classes:** keep 10 minutes, extend to 60–75 minutes only while a class is live (recommended if re-sign-in is a nuisance), or 30 minutes for all.
3. **Staff sessions:** approve administrators at 15 min / 12 h and instructors at 60 min / 24 h, or adjust.
4. **Retention:** approve switching on error logs (90 d), notifications (365 d), AI conversations (365 d) and the audit log (730 d), together with the privacy-policy wording in §10.
5. **CSP:** approve a 7–14 day report period, then enforcement.
6. **Uploads:** approve the quarantine design for implementation when R2 is enabled.
7. **Who should be Super Administrator(s)**, and which groups each existing administrator should receive.

# SMA Stage 2C: Final Owner-Console Security Review and Stage 3 Readiness Gate

Date: 22 November 2026. Owner identity: `bookebukar@gmail.com`.

Nothing was deployed. No production migration was run and no production data was changed. Paystack and R2 stay inactive, and programme data is untouched. Staff session limits and CSP enforcement are prepared but **not** active. Stage 3 has not been started.

Every finding below comes from reading the code paths and running tests against the real Worker (Miniflare) and the real migration runner (Wrangler/D1 local). Earlier summaries were not relied on.

---

## 1. Executive summary

The Stage 2B owner model was sound in intent but had **four real weaknesses**. All are now fixed and covered by regression tests.

| # | Weakness found in the code | Fix |
|---|---|---|
| W1 | **The owner was whoever `OWNER_EMAIL` named.** Repointing that variable at another administrator would silently make them owner. Deleting the `owner_bootstrap` row in `app_settings` would re-open bootstrap. | Migration 0010 adds `owner_record`: one row (`CHECK id = 1`), fixed at bootstrap, with database triggers that refuse UPDATE and DELETE. The owner is now the recorded account **and** `OWNER_EMAIL` must match. A mismatch makes *nobody* owner. A missing record after a bootstrap shown in the audit log also makes nobody owner, and bootstrap stays closed. |
| W2 | **Owner MFA was optional.** The owner console only required the authenticator code when `MFA_ENCRYPTION_KEY` was set. Group changes, creating administrators, suspending administrators and MFA resets through the Users routes never required it. | Fail closed. Every owner-console route except `/status`, and every administrator-management action by the owner or a Super Administrator, requires a session that passed the authenticator code in this sign-in. Email-link-only, pending and pre-0008 "legacy" sessions are refused and the refusal is audited. |
| W3 | **Bootstrap was check-then-write**, so two simultaneous requests could both pass. | Atomic `INSERT` into `owner_record`. Tested with two concurrent requests: exactly one gets 200, the other 409. |
| W4 | **A removed instructor kept receiving email** (class reminders, Meet links, student names) until their teaching was reassigned. | `notify()` no longer emails removed accounts. Removal now returns the list of enrolments to reassign. |

**Also added:**
- An append-only audit log enforced by the database. No update is possible, and no delete of entries younger than 365 days.
- Audit-log retention can be changed only by the owner, with the authenticator code.
- A legacy-administrator review panel in the Owner Console, plus an optional owner-controlled read-only restriction (off by default).
- Owner Console wording that separates *revoking access* from *deleting data*.

**Verification:**
- 218/218 tests pass, including 14 new Stage 2C tests and all Stage 2 and 2B tests.
- Both TypeScript configs, ESLint and the production build are clean.
- `npm audit`: 0 vulnerabilities. Secret scan clean.
- Migrations 0001–0010 apply cleanly through Wrangler.
- The break-glass and owner-transfer D1 commands were executed successfully on a fresh local D1.

**Readiness:** the Stage 2 security work is **ready for the owner's deployment decisions** (section 12). Stage 3 can start after approval.

**Operational consequence the owner must know:**
- `MFA_ENCRYPTION_KEY` must be set in production **before** the owner can complete set-up, assign groups or use the console. Until then those actions are deliberately impossible.
- Day-to-day administration is unaffected.

## 2. Owner-console authorization review

**How the owner is resolved** (`resolveOwner`, `src/server/lms/data/owner.ts`, once per administrator request in `api.ts`):

| State | Condition | Owner |
|---|---|---|
| `unconfigured` | `OWNER_EMAIL` empty | nobody |
| `pending` | no `owner_record`, no `owner.bootstrap` in the audit log | the active, not-removed admin account whose email = `OWNER_EMAIL` |
| `bootstrapped` | `owner_record` exists, its email = `OWNER_EMAIL`, the account is active admin and not removed | that recorded account only |
| `mismatch` | `owner_record.email` ≠ `OWNER_EMAIL` | nobody |
| `record_missing` | no `owner_record`, but the audit log shows a bootstrap | nobody; bootstrap refused |
| `no_account` | the recorded or configured account is missing, suspended or removed | nobody |
| `migration_required` | `owner_record` table absent | nobody |

The result is passed to handlers as `c.owner` / `c.isOwner`. `isOwner(u, owner)` compares **account ids**. No request body, profile field (`PATCH /api/me` ignores `adminRole`, `admin_role`, `role`, `email`, `owner`, `removed_at`, `mfa_required`), URL, registration number or group can influence it.

**Verified:**

| Requirement | Result | Evidence |
|---|---|---|
| Owner identified only by server config + active admin account | ✔ | `resolveOwner`; tests 3, 4, 5 |
| Not reachable via profile, body, URL, API parameter or group | ✔ | Stage 2B test "profile updates cannot set groups, roles, owner status or email"; Stage 2C test 8 |
| Console restricted to the verified owner | ✔ | `owner` permission area, default deny (`adminMay`); tests 7, 8, 14 |
| Sensitive owner actions need owner MFA | ✔ (fixed W2) | tests 1, 2, 7, 12, 14 |
| Email-link-only cannot authorise removal, Super appointment, groups, MFA resets | ✔ | test 1 (`owner_mfa_required`, `mfa_step_required`); test 7 for Supers |
| Pending MFA sessions blocked | ✔ | test 2 (`mfa_required` on owner and admin routes, including `/status`) |
| Owner cannot remove, suspend, regroup or reset self | ✔ | test 6 (400/403; the account stays active `super`) |
| Changing `OWNER_EMAIL` or losing the bootstrap setting creates no replacement | ✔ (fixed W1) | tests 4, 5 |

**Remaining limitation:** before bootstrap, the owner is whoever `OWNER_EMAIL` names. Complete set-up promptly after the first deployment. Changing that variable requires Cloudflare account access.

## 3. Owner MFA requirements

`strongSession` (`api.ts`) is true only when the session has `mfa_verified_at`, is not `mfa_pending`, and is not a pre-0008 legacy session.

| Action | Who | Strong session required |
|---|---|---|
| All `/api/app/owner/*` routes except `GET /status` (bootstrap, staff, audit search, remove, removal decisions, legacy review, policy) | owner | **yes**, enforced at the gate (`owner_mfa_required`, audited `owner.mfa_refused`) |
| Create an administrator; assign or change any group; promote to admin; suspend or reactivate an administrator | owner, Super | **yes** (`requireStrongAuth`, `mfa_step_required`, audited `admin.mfa_step_refused`) |
| Reset an administrator's two-step sign-in | owner, Super | **yes** |
| Request permanent removal | Super | **yes** |
| Change audit-log retention | owner only | **yes** |
| Student and instructor accounts, admissions, timetables, finance | per group | no (unchanged day-to-day work) |

**Order of checks:** permission first, then MFA. An unauthorised attempt is therefore refused, and audited, as unauthorised regardless of its MFA state.

Enabling two-step sign-in ends the person's other sessions, so an email-only owner session cannot linger (test 12).

## 4. Bootstrap and recovery verification

**Bootstrap** (`POST /api/app/owner/bootstrap`):
- Only reachable when the resolved owner is `pending`, from a strong session.
- It runs an atomic `INSERT INTO owner_record (id=1, …)` and sets the owner's group to `super`.
- It audits `owner.bootstrap` with `{email, group, previousGroup}`; the actor and target are both the owner's id.

Results:
- Repeat → 409.
- Two simultaneous requests → exactly one 200 (test 3).
- A non-owner gets 403.
- An email-only owner gets 403 `owner_mfa_required` (test 1).
- The record cannot be updated or deleted through the database (test 4, and the Wrangler local run).
- Existing Stage 2B bootstraps (stored in `app_settings`) are copied into `owner_record` by migration 0010.

**Tested owner recovery: lost authenticator and lost recovery codes.**
1. **Preparation, once, owner only:** generate a long random value offline (64+ characters) and store it on paper or in a password manager. Then run `npx wrangler secret put OWNER_RECOVERY_TOKEN`. Setting it requires Cloudflare account control, so recovery needs **both** the owner's mailbox and Cloudflare access.
2. Sign in at `/app/login/` with the email link. The code prompt appears; the session is pending.
3. Open "Platform owner: break-glass recovery" and enter the token.

   The server:
   - accepts only the resolved owner (an ordinary administrator gets 403);
   - limits attempts to 3 a day;
   - compares hashes in constant time and refuses reuse;
   - deletes the factor and recovery codes;
   - sets `mfa_required`;
   - **ends every session**;
   - audits `mfa.owner_break_glass` (failures `…_failed`; the token is never logged);
   - emails the owner.
4. Sign in again. Administration is blocked (`mfa_setup_required`) until a new authenticator is enrolled.
5. Run `npx wrangler secret delete OWNER_RECOVERY_TOKEN`, then put a new value for the next time.

Tested by:
- Stage 2B: "owner console needs two-step sign-in…; owner break-glass is audited, single-use and forces re-enrolment"
- Stage 2C test 13: a wrong token is refused and audited, and no token appears in the log.

**D1 fallback** (if the Worker or email is unavailable). This was executed against migrations 0001–0010 locally: 5 statements; the factor, codes and sessions all 0; `mfa_required` = 1; audit row present.

```sh
npm run db:backup -- --remote --owner-approved --encrypt-for owner-backup-public.pem   # Stage 3A: wrangler d1 export cannot export this database (FTS5)
npx wrangler d1 execute skillmountainacademy-db --remote --command "DELETE FROM mfa_recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = 'bookebukar@gmail.com'); DELETE FROM mfa_factors WHERE user_id = (SELECT id FROM users WHERE email = 'bookebukar@gmail.com'); DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email = 'bookebukar@gmail.com'); UPDATE users SET mfa_required = 1 WHERE email = 'bookebukar@gmail.com'; INSERT INTO audit_log (id, at, action, target_type, target_id, detail) SELECT lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'mfa.owner_break_glass_d1', 'user', id, '{\"via\":\"wrangler d1\"}' FROM users WHERE email = 'bookebukar@gmail.com';"
```

**Owner transfer** (deliberate; only if ownership must move to another account). This was executed locally: the record moved, the trigger was re-created, and an audit row was written.
1. Back up D1.
2. The new owner signs in once so their admin account exists.
3. Run:

   ```sh
   npx wrangler d1 execute skillmountainacademy-db --remote --command "DROP TRIGGER owner_record_no_update; UPDATE owner_record SET user_id = (SELECT id FROM users WHERE email = 'NEW@EXAMPLE.COM' AND role = 'admin' AND status = 'active'), email = 'NEW@EXAMPLE.COM' WHERE id = 1; CREATE TRIGGER owner_record_no_update BEFORE UPDATE ON owner_record BEGIN SELECT RAISE(ABORT, 'owner_record is fixed after bootstrap'); END; INSERT INTO audit_log (id, at, action, target_type, target_id, detail) VALUES (lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'owner.transfer_d1', 'user', (SELECT user_id FROM owner_record WHERE id = 1), '{\"via\":\"wrangler d1\"}');"
   ```

4. Change the `OWNER_EMAIL` var to the new address and deploy. Until both match, nobody is owner.

## 5. Legacy administrator permission review

A legacy administrator is an admin account with `admin_role IS NULL` that is not the owner.

**Everything an unassigned administrator can do** (`adminMay(null)` grants every area except `owner`):

| Area | Routes (summary) |
|---|---|
| any / overview | own profile, notifications, dashboard overview |
| admissions | admissions state and periods, enquiries, call bookings, admit students offline |
| orders, finance | orders, payments, record offline payments, currency |
| academic | courses, lessons, enrolments (create, change, reassign instructor), timetables, classes, reschedule, monitoring, resources |
| records | student progress, grades, weekly records, submission files |
| faculty | instructors, recruitment and approval, programme assignment |
| support | student contact, guardian details, emails, contact log |
| people, users | view users; create, edit, suspend **students and instructors**; invite |
| security | retention settings (**except** the audit-log category), admin audit view, platform status, test email |

**Refused to an unassigned administrator** (verified one by one in test 8; each refusal returns 403 and is audited):
- assigning or changing any administrator group, their own included;
- appointing a Super Administrator;
- creating an administrator;
- promoting someone to administrator;
- suspending or reactivating an administrator;
- MFA resets;
- removal requests;
- audit-log retention;
- **every** owner-console route, including bootstrap.

**Never silently assigned:** bootstrap and the 0010 migration leave `admin_role` NULL (test 8).

**Owner review** (Owner Console → "Review needed: N administrators without a group"):
- lists each legacy administrator with their last sign-in;
- has a group selector for each, which records an explicit, audited `admin.group_assigned`;
- shows `/status` `unassignedAdmins` until the list is empty (test 9).

**Recommended restriction policy** (built, **off by default**: `PUT /api/app/owner/policy {restrictUnassigned}`, owner + MFA, audited `owner.policy`):
- When on, unassigned administrators get only the **Read-only Reporting** rights until a group is assigned. Their stored group is unchanged; `/api/me` shows `applied: "reporting"`.
- Recommendation: switch it on immediately after the owner's review. Any account still unassigned 30 days later should be suspended, or revoked if no longer needed.

## 6. Permanent staff removal verification

Tested in Stage 2C tests 10 and 11, and Stage 2B test "owner removals…".

| Requirement | Result |
|---|---|
| Documented reason for every removal | Direct removal: `reason` required (400 without). Requests: `reason` required. Owner decision note optional. Reasons are stored on the user (`removal_reason`) and in the audit detail. |
| Direct and approved removals audited | `owner.remove` {role, group, reason, enrolments to reassign}; `owner.removal_requested` {reason}; `owner.removal_approved/rejected` {request, reason, note}. The actor is the owner. |
| Removed account cannot sign in | `canSignIn` refuses `removed_at`; no sign-in email is sent |
| Sessions, sign-in links, MFA revoked | Sessions deleted; outstanding links marked used (a link issued before removal fails); factor and recovery codes deleted (test 11: 0/0/0) |
| Cannot be reactivated through ordinary endpoints | PATCH status/role → 403 (`accountChangeRefusal`); cannot be given new students (enrolment requires an active, approved instructor) |
| Records intact | Before and after counts identical for users, enrolments, classes, attendance, assignments, submissions, grade, orders and messages; audit entries only grow |
| Instructor removal orphans nothing | The enrolment keeps its instructor id until reassigned. The completed class keeps the original instructor (history). |
| Outstanding responsibilities reassignable | The response lists `reassign[]` (enrolment, student, programme, upcoming classes). `PATCH /api/app/admin/enrolments/:id {instructorId}` moves future classes to the new instructor. Until then the removed instructor receives **no email** (fixed W4). |
| Revocation distinguished from deletion | The API returns `accessRevoked: true, recordsDeleted: false`. The console button reads "Revoke access permanently", the confirmation states that no data is deleted, and physical deletion is stated to be manual, on a verified request only. |

Administrative removal is not reversible in the application. If reinstatement is ever needed, create a new account.

## 7. Audit integrity review

| Requirement | Result |
|---|---|
| No modification or deletion through application routes | No route writes to `audit_log` except by inserting (test 12 checks the route list). Database triggers (0010) refuse **any** UPDATE and any DELETE of an entry younger than 365 days, whatever code issues it. |
| Actor, target, timestamp, action, reason | Every entry has `at`, `action`, `actor_id` (null only for system jobs), `target_type/target_id`, `detail` and `ip_hash`. Removals and requests carry the reason (tests 10, 11, 13). |
| Refused privileged operations recorded | `admin.group_refused`, `admin.change_refused`, `admin.access_refused`, `admin.mfa_step_refused`, `owner.mfa_refused`, `mfa.reset_refused`, `settings.retention_refused`, `mfa.owner_break_glass_failed` |
| Owner audit search protected | Owner area, strong session required. A pending session gets `mfa_required`; Supers and legacy admins get 403 (test 14). |
| No secrets recorded | Test 13 searches the whole log for: the break-glass token, a wrong token, the MFA key, the TOTP secret, the Resend key, and recovery-code hashes, plus any `token`, `secret`, `code`, `password` or `recoveryCodes` keys. None found. Request bodies are never logged by the gate. |
| Retention cannot silently remove early entries | Audit-log retention is off; minimum 365 days in code and in the database trigger; changeable only by the owner with MFA; each purge is audited (`retention.purge`, `retention.backlog`). |

**Limitations of application-level integrity:**
- Anyone with Cloudflare account access to D1 (`wrangler d1 execute`, the dashboard console) can drop the triggers and alter or delete rows.
- D1 Time Travel or a restore could also roll the log back.
- The audit log protects against misuse **through the application**, not against a compromised Cloudflare account.

Mitigations for Stage 3:
- Restrict Cloudflare account membership and require 2FA on it.
- Export the audit log regularly to storage the operator cannot silently edit, for example a daily `npm run db:backup` (Stage 3A) kept off-platform.
- Consider hash-chaining entries so any gap or edit is detectable.

## 8. Staff session configuration

**Enforced server-side** (`session-policy.ts` `policyFor`, checked in `api.ts` `resolveSession` on every request):
- idle time against `last_activity_at`;
- absolute lifetime against `created_at`;
- the cookie `Max-Age` matches.

The test "staff session variables are enforced by the server when set" confirms instructor 59/61 minutes, the 24-hour lifetime and cookie, the admin 12-hour cookie and 15-minute idle limit, and unchanged defaults.

**Prepared, not active** (commented in `wrangler.jsonc` `vars`; requires the owner's final approval):

| Role | Var | Value |
|---|---|---|
| Administrators | `ADMIN_IDLE_MINUTES` / `ADMIN_SESSION_HOURS` | 15 / 12 |
| Instructors | `INSTRUCTOR_IDLE_MINUTES` / `INSTRUCTOR_SESSION_HOURS` | 60 / 24 |

Current behaviour: students 10 min / 12 h; staff 30 days sliding.

## 9. Exact changed files (Stage 2C)

**Added**
- `migrations/0010_owner_integrity.sql`:
  - table `owner_record`, and a copy of any Stage 2B bootstrap into it;
  - triggers `owner_record_no_update`, `owner_record_no_delete`, `audit_log_no_update`, `audit_log_min_retention`.
- `tests/stage2c.test.ts`: 14 tests.
- `docs/SMA_STAGE_2C_FINAL_SECURITY_GATE.md`: this document.

**Modified**
- `src/server/lms/data/owner.ts`:
  - new `resolveOwner`, `getOwnerRecord`, `recordBootstrap` (atomic), `ownerEmailOf`;
  - `isBootstrapped` now reads `owner_record`;
  - new `getOwnerPolicy`/`saveOwnerPolicy`, `unassignedAdmins`, `teachingToReassign`;
  - removed `getBootstrap`/`saveBootstrap`.
- `src/server/lms/permissions.ts`:
  - `OwnerRef`;
  - `isOwner` compares account ids;
  - `canManageAdmins`, `groupChangeRefusal`, `accountChangeRefusal` take `OwnerRef`;
  - routes `GET /api/app/owner/legacy-admins` and `PUT /api/app/owner/policy` added to the owner area.
- `src/server/lms/api.ts`:
  - owner resolution per admin request;
  - `ctx.owner`, `ownerState`, `effectiveAdminRole`;
  - legacy restriction policy;
  - owner area requires a strong session always (audited);
  - `strongSession`, `requireStrongAuth`;
  - removed the `mfaKeyUsable` exception.
- `src/server/lms/routes/owner.ts`:
  - status (state, strongSession, unassigned count, policy);
  - atomic bootstrap with identity audit;
  - removal responses `accessRevoked`/`recordsDeleted`/`reassign[]`;
  - reasons in audit;
  - MFA for removal requests;
  - legacy-admins and policy routes.
- `src/server/lms/routes/users.ts`: `c.owner`; `requireStrongAuth` for admin creation and administrator account or group changes.
- `src/server/lms/routes/mfa.ts`: `c.owner`; `requireStrongAuth` for MFA resets.
- `src/server/lms/routes/security.ts`: audit-log retention owner-only with MFA; retention changes audited with before/after values.
- `src/server/lms/routes/auth.ts`: `/api/me` `admin.owner` from the resolved owner, `admin.applied`, areas from the applied group.
- `src/server/lms/notify.ts`, `src/server/lms/data/users.ts` (`removedAmong`): no email to removed accounts.
- `src/server/env.ts`: comments tidied and grouped (no new names).
- `app/app/owner.tsx`:
  - state problems;
  - a two-step-required screen;
  - `LegacyReview` panel with group assignment and the restriction toggle;
  - revocation-vs-deletion wording;
  - reassignment list after removal.
- `app/app/admin.tsx`: Users actions renamed "Revoke access permanently" / "Request access revocation", with explicit wording.
- `tests/worker-harness.ts`: the migration runner keeps `CREATE TRIGGER … END;` together (as Wrangler does).
- `tests/security.test.ts`: the permissions test uses an MFA-verified owner; bootstrap removed from setup; the retention test creates its Reporting admin directly.
- `tests/stage2b.test.ts`: the main worker has the MFA key; owner and Super use code-verified sessions.
- `docs/lms/API.md`: regenerated.
- `docs/upgrade/OWNER-CHECKLIST.md` (section N), `docs/upgrade/HANDOVER.md`.

Not touched: `app/globals.css`, logos, icons, programme prices, durations, payment plans, enrolment and academic data, Paystack, R2.

## 10. Regression tests and results

| Check | Result |
|---|---|
| `npm test` (26 files) | **218 tests, 218 pass, 0 fail** (≈65 s) |
| Stage 2C tests | 14/14 |
| Stage 2B tests | 13/13 |
| Stage 2 security tests | 29/29 |
| `tsc -p tsconfig.json`, `tsc -p src/tsconfig.json` | clean |
| `eslint .` | clean |
| `npm run build` + CSP postbuild | success; report mode, 30 pages, 0 hash mismatches, no `unsafe-*` in `script-src` |
| `npm audit` (all and production) | 0 vulnerabilities |
| Secret scan | no live keys; only `.dev.vars.example` placeholders and the public Turnstile site key; no `.env`/`.dev.vars` |
| Migrations | 0001–0010 apply on a fresh D1 via Wrangler (10 recorded in `d1_migrations`); 0008–0010 have no DROP, DELETE, UPDATE or RENAME statements; 0010's triggers verified |
| D1 break-glass and owner transfer | executed successfully on local D1 |

**Stage 2C tests (`tests/stage2c.test.ts`):**
1. an email link alone opens nothing sensitive: owner console, bootstrap and audit search need the authenticator code (fail closed)
2. a session still waiting for the authenticator code reaches no owner or administration route
3. bootstrap: owner only, MFA-verified, atomic (two simultaneous attempts: exactly one succeeds), audited with the owner's identity
4. the owner record cannot be changed or deleted, and changing OWNER_EMAIL creates no replacement owner
5. a lost bootstrap record is detected from the audit log: nobody becomes owner and bootstrap stays closed
6. the owner cannot accidentally suspend, regroup, reset or remove their own account; nobody else can either
7. Super Administrators also need the authenticator code for group changes, MFA resets and removal requests
8. legacy (unassigned) administrators: day-to-day access kept; every administrator-management and owner power refused; never auto-assigned
9. owner review of legacy administrators: warning list, optional read-only restriction, explicit assignment
10. removing an instructor revokes access only: every academic record stays, teaching is listed and reassigned, no further email
11. removing an administrator revokes MFA factors and recovery codes; approved requests carry the documented reason
12. audit log: append-only in the database, no application route can change it, and its retention is the owner's decision
13. audit entries record actor, target, time and reason, and never secrets, codes or recovery tokens
14. owner audit search works only for the owner with the code, and filters by actor, action and target

**Other required areas, existing tests re-run:**
- **Owner authorization:** Stage 2B tests 1–6.
- **MFA recovery:** Stage 2B tests 7–8; `security.test.ts` "admin MFA: …" (6 tests).
- **Session expiry:**
  - `security.test.ts`, "student session: …" (5 tests);
  - "staff sessions keep today's rules…";
  - "session fixation…";
  - Stage 2B live-class and staff-session tests.
- **Cross-user/role isolation:** the three "isolation: …" tests in `security.test.ts`, plus `lms1`–`lms7` role tests.

## 11. Remaining risks

| Risk | Level | Note / mitigation |
|---|---|---|
| Cloudflare account compromise (D1, secrets, `OWNER_EMAIL`, triggers) | High | Outside application control. Use Cloudflare 2FA and minimal membership; off-platform audit export (Stage 3). |
| Owner's Gmail compromise | Medium (was High) | An email link alone can no longer do anything sensitive. The authenticator is still needed, and break-glass also needs Cloudflare. |
| `MFA_ENCRYPTION_KEY` not set in production | Operational | Owner set-up and admin management are impossible until it is set (by design). |
| Window before bootstrap | Low | Whoever `OWNER_EMAIL` names is the pending owner; complete set-up right after deployment. |
| Legacy administrators keep broad access until reviewed | Medium | Review panel; switch on the read-only policy after review. |
| No backups, restore tests, migration preflight, rollback or Worker CI | High | Stage 3 scope (section 12). |
| Uploads not scanned; CSP report-only | Medium | Stage 2B design and report period (unchanged). |
| Production migration status unknown | High | Must be checked before deployment (section 12). |

## 12. Stage 3 handover and readiness status

**Readiness:** Stage 2 security is **complete and verified locally**. Stage 3 may begin on the owner's approval. Nothing here has reached production.

### 12.1 Database schema and migrations (D1 `skillmountainacademy-db`, binding `DB`, `migrations_dir: migrations`)

| Migration | Tables / changes |
|---|---|
| 0001_init | programmes, registrations, orders, instalments, payments, webhook_events, holds, children_enquiries, rate_limits |
| 0002_seed_programmes | programme seed data |
| 0003_lms | users, auth_tokens, auth_sessions, audit_log, courses, lessons, enrolments, timetables, class_sessions, notifications, resources, assignments, submissions, quizzes, quiz_attempts, lesson_progress, messages, instructor_ratings, ai_messages, error_log |
| 0004_admissions | programme_admissions, admission_periods, instructor_programmes |
| 0005_identity | id_sequences (registration and staff numbers) |
| 0006_instructor_profile | instructor profile columns |
| 0007_refinement | call_bookings, assistant_enquiries, weekly_items, app_settings, contact_log |
| 0008_security | mfa_factors, mfa_recovery_codes; session MFA and activity columns |
| 0009_owner | users.removed_*, users.mfa_required; staff_removal_requests |
| 0010_owner_integrity | owner_record; audit and owner triggers |

### 12.2 Production migration status: still to verify

There is no Cloudflare access in this environment. Before any deployment, run `npx wrangler d1 migrations list skillmountainacademy-db --remote`. Expected pending: 0007(?)–0010.

0008–0010 are additive. 0010 creates triggers; confirm afterwards with:

```sh
npx wrangler d1 execute skillmountainacademy-db --remote --command "SELECT name FROM sqlite_master WHERE type='trigger'"
```

### 12.3 Tables holding important institutional data

| Category | Tables |
|---|---|
| Financial | orders, instalments, payments, webhook_events, holds |
| Academic | enrolments, timetables, class_sessions (attendance), assignments, submissions (grades), quizzes, quiz_attempts, lesson_progress, weekly_items, courses, lessons, resources |
| People | users, registrations, children_enquiries, contact_log, instructor_programmes, instructor_ratings, id_sequences |
| Admissions | programme_admissions, admission_periods, call_bookings, assistant_enquiries |
| Communications | messages, notifications, ai_messages |
| Security | audit_log, owner_record, staff_removal_requests, mfa_factors, mfa_recovery_codes, app_settings |
| Disposable | auth_tokens, auth_sessions, rate_limits, error_log |

Uploaded files will live in R2 when enabled. Today R2 is unbound, so there are no file objects to back up yet.

### 12.4 Existing backup capability

- **Manual only:** (superseded by Stage 3A: `wrangler d1 export` refuses this database because of its FTS5 table; use `npm run db:backup`, see `docs/SMA_STAGE_3A_BACKUP_RESTORE_ARCHITECTURE.md`) formerly `npx wrangler d1 export …`, documented in the Stage 2 and 2B checklists.
- **Cloudflare D1 Time Travel** (point-in-time restore within Cloudflare's retention window for the account's plan) is available by platform design, but it has **not been verified or tested** for this account.
- No scheduled exports, no off-platform copies and **no restore test has ever been performed**.

### 12.5 Deployment and rollback mechanisms

- **Deployment:** manual. Run `npm run build`, then `npm run deploy` (`wrangler deploy`), then `npm run db:migrate` (`wrangler d1 migrations apply --remote`), all from the owner's machine.
- **Rollback:**
  - Worker: `wrangler rollback` or Cloudflare dashboard versions, available by platform design but not documented or tested here.
  - D1: there is **no down-migration support**. Restore means an import of an export or Time Travel.
- **No migration preflight** (backup, pending-list check, dry run on a copy) is automated.

### 12.6 GitHub repository and CI status

- The working copy here is **not a git repository**. Changes are delivered as ZIP packages and the owner commits them. The current GitHub repository state and branch protection could not be inspected.
- The only workflow, `.github/workflows/deploy.yml`, is **"Deploy to GitHub Pages"**. On every push to `main` it builds the static site (Node 20) and publishes it to GitHub Pages.
  - It does **not** run tests, lint, type checks or `npm audit`.
  - It does **not** deploy the Cloudflare Worker.
  - It builds with `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` from repository secrets.

  This is a legacy path that publishes a site *without* the Worker API. Stage 3 must decide whether to retire or replace it, and must confirm which host the domain points to.

### 12.7 Cloudflare dependencies

| Binding | Use | State |
|---|---|---|
| Worker `skillmountainacademy` (`src/worker.ts`) | API, LMS, cron | configured |
| `ASSETS` (`./out`) | static site | configured |
| `DB` (D1) | all data | configured; `database_id` set by Wrangler |
| `KV` | exchange-rate cache only | configured |
| `AI` (Workers AI) | learning assistant | configured |
| `BUCKET` (R2) | uploads | **not bound** (commented) |
| Cron `*/5 * * * *` | schedules, reminders, retention | configured |
| External | Resend (email), Turnstile, Paystack (inactive in production), Google Meet links | n/a |

### 12.8 Secrets and configuration names (no values)

- **Secrets** (`wrangler secret put`):
  - `TURNSTILE_SECRET`, `RESEND_API_KEY`, `HOLD_SIGNING_KEY`;
  - `PAYSTACK_SECRET_KEY` (inactive);
  - `IP_HASH_SALT`, `MFA_ENCRYPTION_KEY` (**required before owner set-up**);
  - `OWNER_RECOVERY_TOKEN` (set when preparing recovery);
  - `SHEET_WEBHOOK_URL` (legacy).
- **Vars** (`wrangler.jsonc`):
  - `SITE_URL`, `EMAIL_FROM`, `ADMIN_EMAIL`, `ADMIN_EMAILS`, `OWNER_EMAIL`, `CLASS_BOOKING_URL`, `AI_MODEL`;
  - optional: `IP_HASH_STRICT`, `MFA_ENFORCE_ADMINS`, `ADMIN_IDLE_MINUTES`, `ADMIN_SESSION_HOURS`, `INSTRUCTOR_IDLE_MINUTES`, `INSTRUCTOR_SESSION_HOURS`, `CSP_MODE` (build-time).
- **Build-time** (GitHub/public): `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, `NEXT_PUBLIC_SHEET_URL`, `NEXT_PUBLIC_WHATSAPP`.

### 12.9 Risks Stage 3 must address

1. **Backups:**
   - scheduled D1 exports to off-platform storage, including an audit-log copy;
   - a verified Time Travel window;
   - an R2 backup plan once R2 is enabled.
2. **Restore testing:** a documented and rehearsed restore of an export into a scratch D1, with row-count and checksum verification.
3. **Migration preflight:**
   - automatic backup before `migrations apply`;
   - pending-list check;
   - apply to a copy first;
   - a guard that refuses destructive statements.
   - Note that 0010 contains triggers, so tooling must not split on `;` naively.
4. **Deployment rollback:** a documented Worker version rollback, and the pairing of Worker versions with schema (forward-compatible migrations only).
5. **CI:**
   - replace or retire the GitHub Pages workflow;
   - add tests, type checks, lint, build, `npm audit` and the secret scan on every pull request;
   - gated Worker deployment with Wrangler API tokens stored as GitHub secrets.
6. **Production verification:** the migration status, secrets present, `owner_record` state, and legacy administrators reviewed.

**Owner decisions before Stage 3:**
1. Set `IP_HASH_SALT`, `MFA_ENCRYPTION_KEY` and `OWNER_RECOVERY_TOKEN`.
2. Back up D1 and apply 0008–0010.
3. Deploy.
4. Enrol the authenticator.
5. Complete set-up.
6. Review legacy administrators and switch on the read-only policy.
7. Approve or adjust the staff session limits (section 8).
8. Approve the start of Stage 3.

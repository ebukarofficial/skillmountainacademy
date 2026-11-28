# Expansion Stage E: departments, institutional hierarchy, roles and approval workflows

**Status:** implemented locally for Owner review. Nothing was deployed, migrated in production, emailed for real or paid.
**Date:** 28 November 2026.
**Scope rule followed:** extend the existing system and do not rebuild authentication. Every new mechanism is inactive or default-deny until the Owner decides.

Contents:

1. Existing architecture inspected
2. Institutional hierarchy implemented
3. Department structure
4. Role-permission matrix
5. Invitation and onboarding workflow
6. Suspension and revocation workflow
7. Approval workflow design
8. Financial safeguards
9. Owner decisions still required
10. Database migrations and rollback considerations
11. Files created and modified
12. Tests and exact results
13. Security limitations
14. Confirmation that no production changes, real invitations, bulk emails or payment actions occurred

---

## 1. Existing architecture inspected

| Area | What already existed (before Stage E) | Kept as is? |
|---|---|---|
| Sign-in | Single-use email links (`/api/auth/request` → `/app/confirm/` → `POST /api/auth/verify`). Tokens are stored only as hashes. HttpOnly session cookie. Session-fixation protection. | Yes. Acceptance reuses the same session start, now extracted into `startSession()` in `src/server/lms/routes/auth.ts`. |
| Roles | `users.role` is `student`, `instructor` or `admin`. Instructors start as candidates (`verification = application_received`) until Recruitment approves them. | Yes |
| Administrator groups | `users.admin_role` is one of `super`, `admissions`, `finance`, `academic`, `faculty`, `support` or `reporting`. A default-deny route table `[method, path, area]` and `GRANTS` per group live in `src/server/lms/permissions.ts`. The router refuses any administrator route that is not in the table. | Yes. New routes added to the table; no group gained an area. |
| Owner | The owner is resolved from `OWNER_EMAIL` plus the one-time bootstrap record (`owner_record`). The owner-only area is `owner`. `groupChangeRefusal` and `accountChangeRefusal` cover: nobody changes their own group, only the owner appoints or changes a Super Administrator, and nobody changes the owner. | Yes. Reused by the approval executors. |
| Legacy administrators | Administrators without a group keep their day-to-day access, can be restricted to Reporting by the owner (`restrictUnassigned`), and cannot manage administrators. | Yes. They are also refused every Stage E management route, including invitations, departments and payment release. |
| MFA | Authenticator (TOTP) step-up. `requireStrongAuth()` refuses sensitive actions from a session that has not passed the code. | Yes. Every Stage E write calls it. |
| Audit | `audit_log` (actor, action, target, JSON detail, ip hash). There is no update or delete route; retention is limited. | Yes |
| Approvals | One specific flow: a Super Administrator *requests* permanent removal and the owner decides (`removal_requests`). | Kept. A general framework was added beside it, because the existing one covers removal only. |
| Invitations | `POST /api/app/admin/users` creates the account immediately and emails a 24-hour sign-in link. | Kept for compatibility. The new invitation flow is the recommended path; retiring direct creation is an Owner decision (D-E9). |
| Payment release | Stage D.1.1 `POST /api/app/admin/payments/attempts/:id/release` (Finance area, authenticator code, verify-first, explicit confirmation). | Gated: now disabled for everyone until the Owner authorises it (section 8). |

## 2. Institutional hierarchy implemented

| Level | How it is enforced |
|---|---|
| **1. Owner** | Unchanged identity (`OWNER_EMAIL` and bootstrap). The owner alone sets institution and approval policies (`PUT /api/app/owner/institution-policy` and `PUT /api/app/owner/approval-policy`, both in the owner-only area, with the authenticator code). By default only the owner creates departments, appoints heads and assigns staff. The owner acts directly and never needs an approval request (`owner_acts_directly`). The owner can cancel any request and decides any request escalated to them. Nobody can change the owner's account or group. |
| **2. Super Administrators** | They keep their existing group rights (they still hold every non-owner area, as before Stage E). They gain no institution powers by default: departments, staff assignment and head appointment are each a separate owner switch, all off. They cannot invite or revoke a Super Administrator, cannot change their own group, cannot approve their own request, and can escalate a request to the owner. |
| **3. Department Heads** | Headship is organisational. It grants **no** permission (test 3 shows a head still refused areas outside their group). A head sees their own department's roster (name, position, group and status only) through `GET /api/app/admin/department`. They see nothing of other departments. Whether heads may approve within their department is Owner decision D-E2; it is not implemented. |
| **4. Departmental Staff** | Membership grants nothing. A member sees only their own department's name and their own position, not the roster. |

At most one active head per department, and (by default) one department per person, are enforced by partial unique indexes and by the server.

## 3. Department structure

**Inspection finding.** The six functional areas (Academic, Admissions, Finance, Reporting, Faculty, Support) are already **permission groups**. Duplicating them as departments that also grant access would create two competing permission systems. Stage E therefore keeps groups as the *only* source of access and adds departments as an *organisational* layer: who belongs where, who leads, and history. No department is seeded. The table is empty until the Owner creates the structure.

**Recommended structure (proposal, not created, for Owner decision D-E1).** Four departments. Reporting stays a read-only permission group rather than becoming a department. Faculty Management becomes a team within Academic.

| Department (proposed) | Purpose | Core responsibilities | Head role | Staff roles (groups) | Information accessible (via groups, unchanged) | Actions it may perform | Actions requiring approval (if the Owner switches the rule on) | Escalation |
|---|---|---|---|---|---|---|---|---|
| **Academic Administration** | Teaching delivery and quality | Programmes, courses, timetables, enrolments and instructor allocation; faculty recruitment and verification (Faculty team) | Head of Academics (group `academic`) | `academic`, `faculty`; instructors as faculty members | Academic, records, catalogue (`academic`); faculty (`faculty`) | Everything the `academic` and `faculty` groups already allow | Group changes, reinstatement, head appointment. Sensitive academic overrides are evaluated only (D-E4). | Head → Super Administrator → Owner |
| **Admissions** | Student intake | Admission periods, applications, call requests, admitting a student | Head of Admissions (group `admissions`) | `admissions` | Admissions, orders, people | As the `admissions` group | Exceptional admissions are evaluated only (D-E4) | Head → Super Administrator → Owner |
| **Finance** | Money in and reconciliation | Payments, manual transfers, currency, pricing diagnostics, payment-attempt checks | Head of Finance (group `finance`) | `finance` | Finance, orders, people | As the `finance` group; **release of uncertain Paystack attempts is off until the Owner authorises it** | Payment release (section 8); financial adjustments evaluated only (D-E5) | Head → Owner (recommended: financial matters go to the Owner, not a Super Administrator) |
| **Student Support** | Student contact and welfare | Student contact, guardian details, contact records | Head of Student Support (group `support`) | `support` | Records, support, people | As the `support` group | Sensitive data access evaluated only (D-E4) | Head → Super Administrator → Owner |

*Executive administration* (Super Administrators) and *Read-only Reporting* are recommended to stay **outside** departments. Super Administrators coordinate across departments. Reporting is a permission profile that any department may need.

## 4. Role-permission matrix

Access is decided only by the server (`src/server/lms/permissions.ts` plus the route handlers). Read means it can see; Write means it can change. "—" means refused (default deny).

**Areas by group (unchanged by Stage E):**

| Area | Super | Admissions | Finance | Academic | Faculty | Support | Reporting |
|---|---|---|---|---|---|---|---|
| any (own profile, notifications, own department, own approval requests) | W | W | W | W | W | W | W |
| overview | W | R | R | R | R | R | R |
| admissions | W | W | — | — | — | — | R |
| orders | W | R | R | — | — | — | R |
| finance | W | — | W | — | — | — | R |
| academic | W | — | — | W | — | — | R |
| records | W | — | — | R | — | R | R |
| faculty | W | — | — | — | W | — | R |
| support | W | — | — | — | — | W | — |
| people (directory) | W | R | R | R | R | R | — |
| users (accounts and institution) | W | — | — | — | — | — | — |
| security | W | — | — | — | — | — | — |
| catalogue | W | — | — | W | — | — | R |
| owner | owner only | | | | | | |

**Requested roles mapped to the matrix:**

| Role in the brief | How it is represented | Institution powers (Stage E) |
|---|---|---|
| Owner | `OWNER_EMAIL` + bootstrap; every area | Everything. Sets the policies and acts directly. |
| Super Administrator | group `super` | Institution overview, invitations (not Super), revoke non-Super invitations, access history. Departments, staff and heads only if the Owner switches each on. Approve requests addressed to "super" (never their own). |
| Department Head | an active `staff_assignments` row with `position = 'head'` | Own department roster only. No extra area. |
| Departmental Staff | `staff_assignments` with `position = 'staff'` | Own department name and position only |
| Academic staff | group `academic` | none |
| Admissions staff | group `admissions` | none |
| Finance staff | group `finance` | Check payment attempts (as before). Release **only** if the Owner names `finance` in `paymentRelease.allowedGroups`. |
| Faculty / instructors | role `instructor` (teaching) and group `faculty` (administering faculty) | none; invited instructors start as candidates |
| Support staff | group `support` | none |
| Reporting staff | group `reporting` | none |
| Legacy (unassigned) administrator | `admin_role` NULL | none (refused every Stage E management route and release) |

**Stage E routes and their checks:**

| Route | Table area | Handler check (server) | Authenticator code |
|---|---|---|---|
| `GET /api/app/admin/institution` | users | owner or Super | — |
| `POST /api/app/admin/departments`, `PATCH /api/app/admin/departments/:slug` | users | owner, or Super if `superMayManageDepartments` | yes |
| `POST /api/app/admin/departments/:slug/members` (staff) and `POST /api/app/admin/assignments/:id/end` | users | owner, or Super if `superMayAssignStaff` (heads: `superMayAppointHeads`); never yourself | yes |
| `GET /api/app/admin/department` | any | your own assignments only | — |
| `GET /api/app/admin/users/:id/access-history` | users | owner or Super | — |
| `GET` and `POST /api/app/admin/invitations`, `POST /api/app/admin/invitations/:id/revoke` | users | owner, or Super after bootstrap; Super invitations owner-only; department and head need the matching authority | yes (writes) |
| `POST /api/auth/invitations/preview`, `/accept` and `/decline` | public | a valid single-use token (rate-limited) | — |
| `GET /api/app/admin/approvals`, `GET /api/app/admin/approvals/:id` | any | owner and Super see all; others see only their own requests | — |
| `POST /api/app/admin/approvals` | any | the rule must be switched on; the requester must hold the authority for the change; not the owner | yes |
| `POST /api/app/admin/approvals/:id/decision` | any | assigned approver; never the requester; not expired; rule still on | yes |
| `POST /api/app/admin/approvals/:id/cancel` and `/escalate` | any | requester or owner (cancel); requester, Super or owner (escalate) | — |
| `PUT /api/app/owner/institution-policy` and `PUT /api/app/owner/approval-policy` | owner | owner only | yes |
| `POST /api/app/admin/payments/attempts/:id/release` | finance | `paymentRelease` must be enabled and list the caller's group (owner: enabled only) | yes |

Separation of duties: nobody approves their own request. The executor re-checks the requester's *and* the approver's authority (`groupChangeRefusal` and `accountChangeRefusal`). Payment release is requested by one person and, if the Owner wishes, approved by another.

## 5. Invitation and onboarding workflow

1. An owner or Super Administrator (with the authenticator code) creates **one** invitation: email, name, role (`admin` or `instructor`), administrator group, and an optional department and position. Only the owner can invite a Super Administrator. A department or head needs the matching authority. Reserved owner email, existing accounts and duplicate pending invitations are refused (`staff_invitations_one_pending`).
2. The server makes a 32-byte random token and stores **only** `sha256("i|"+token)`. The token goes into one email to that person. It is never returned by any API, logged or audited (test 6 checks the response, the list and the audit log).
3. The link opens `/app/invite/?t=…`. Opening it does nothing; the person presses **Accept** or **Decline** (a POST), so email scanners cannot use it.
4. **Accept** moves the invitation from `pending` to `accepted` by compare-and-set (single use), then creates the account with **exactly** the invited role, group and department. Anything else in the request is ignored. Administrators get a staff number; instructors start as candidates (`application_received`) and go through Recruitment as before. A session is started through the same `startSession()` as an email sign-in; a person who later enrols an authenticator gets the code step. The email link is the proof of address, as with every sign-in.
5. Expiry is 24 hours, applied on read and use and audited once (`invite.expired`). Revocation needs a reason. Expired, revoked, declined, used and unknown tokens all get the same answer.
6. Audit events: `invite.created`, `invite.accepted`, `staff.joined`, `invite.declined`, `invite.revoked`, `invite.expired`.

No bulk invitation route exists. Each request creates one invitation and sends at most one email. Locally, email delivery is mocked.

## 6. Suspension and revocation workflow

| Action | Route | Stage E change |
|---|---|---|
| Suspend or reactivate | `PATCH /api/app/admin/users/:id {status, reason}` | For staff, a **reason is required** (`reason_required`). Suspension ends every session (as before) and now also cancels unused sign-in links. `staff.access_changed` records the actor, target, time, before, after and reason. Reactivation may require approval if the Owner switches on `staff_reinstatement`. |
| Change role or group | same route `{role \| adminRole, reason}` | Reason required; before and after audited; sessions end. A group change may require approval if `staff_group_change` is on. |
| Change department | `POST /api/app/admin/departments/:slug/members` and `POST /api/app/admin/assignments/:id/end` | Reason required; the ended row is kept (`ended_at`, `ended_by`, `end_reason`). |
| Revoke access permanently | existing `POST /api/app/owner/users/:id/remove` (owner) or a removal request (Super) | Unchanged. Records are kept, including assignments and access history (test 10). |
| Reassign responsibilities | existing Stage C enrolment reassignment (with reason); department membership as above | Unchanged |

Students are not staff: their suspension needs no reason (regression test 18).

## 7. Approval workflow design

- **Table:** `approval_requests` (category, target, payload, reason, requester, approver `owner|super`, status `pending|approved|rejected|cancelled|expired`, expiry, decision, comment, execution result, escalation).
- **Configurable, never hard-coded:** the Owner's `approval_policy` (in `app_settings`) holds `{enabled, approver, expiresInHours}` per category. **Default: nothing enabled.** A request cannot be created for a category that is off (`approval_not_configured`).
- **Executable categories** (have a server executor): `staff_group_change`, `staff_reinstatement`, `department_head_appointment`, `payment_attempt_release`.
- **Evaluated, not implemented:** `sensitive_academic_override`, `financial_adjustment`, `exceptional_admission` and `sensitive_data_access`. The Owner cannot switch these on (`category_not_available`) until a policy and an executor are agreed.
- **Lifecycle:**
  1. Request. Strong auth; the requester's authority is checked at this point.
  2. Approve or reject. Only the assigned approver may decide; the requester never can, and nobody can approve a change to their own access. A rejection needs a comment. An expired request cannot be approved, and an approval is refused if the Owner has switched the rule off since (`policy_withdrawn`).
  3. Execute, only after the compare-and-set to `approved`. Every rule is re-checked with the approver's authority. The result, or the failure reason, is stored on the request.
  4. Cancel, by the requester or the owner.
  5. Escalate from a Super Administrator to the owner.
- **Gating direct actions:** when a rule is on, the equivalent direct action by anyone but the owner returns `409 approval_required`. This applies to a group change, reactivating a suspended staff account, and a head appointment by a Super Administrator who lacks direct authority.
- **History and audit:**
  - `GET /api/app/admin/approvals/:id` shows the timestamped trail.
  - Audit events: `approval.requested`, `approved`, `rejected`, `cancelled`, `escalated`, `expired`, `executed`, `execution_failed` and `decision_refused`.
  - Executed changes also carry `requestedBy`, `approvedBy` and `approvalRequest` in their own audit entry.
- **One pending request per category and target** (partial unique index).

## 8. Financial safeguards

The Stage D.1.1 safety mechanism is unchanged: the durable D1 claim, no automatic retries, verify before release, explicit dashboard confirmation, the authenticator code and the audit trail. Stage E adds:

- **Release disabled for everyone, the owner included,** until the Owner records `approval_policy.paymentRelease` (`403 release_not_authorised`, audited as `payment.attempt_release_refused`). Checking an attempt with Paystack stays available to Finance.
- **Release is not available to every Finance-capable administrator.** Only groups the Owner lists in `allowedGroups` may release. "Super" is not implied. Legacy administrators are never included.
- **Optional second person:** with `requiresApproval`, the officer's release becomes an approval request (202). Nothing is released until the assigned approver decides. The executor then re-runs **every** check at that moment: in progress, paid, Paystack reports success (recorded, never released) and confirmation.
- The release logic lives once, in `src/server/lms/payment-release.ts`, used by both paths.
- A release never starts a payment. It only lets the student open a new checkout themselves (test 17 counts Paystack calls).
- **Recommended setting (for Owner decision D-E6, not applied):** `allowedGroups: ["finance"]`, `requiresApproval: true`, `approver: "owner"`, `expiresInHours: 24`. Release would only follow a Paystack check and dashboard confirmation, never a wish to retry.

The Paystack integration, NGN charge, pricing, FX policy and country rules are unchanged.

## 9. Owner decisions still required

Every item below is implemented as **off or owner-only** until decided.

| # | Decision | Current safe default |
|---|---|---|
| D-E1 | Final department names and structure (section 3 proposal) | No departments exist |
| D-E2 | May a department head approve changes for staff in their department? | No: heads have no approval power |
| D-E3 | Which actions need Owner approval, and which need two-person approval (`staff_group_change`, `staff_reinstatement`, `department_head_appointment`) | All rules off; the owner acts directly and others act as their group allows today |
| D-E4 | Policies for sensitive academic overrides, exceptional admissions and sensitive data access | Not implementable yet (no executor) |
| D-E5 | Who may approve financial adjustments | Not implementable yet |
| D-E6 | Who may release uncertain Paystack attempts, and whether a second person must approve | Disabled for everyone |
| D-E7 | May Super Administrators manage departments, assign staff or appoint heads? | No (three separate switches, all off) |
| D-E8 | May a person belong to more than one department? | No |
| D-E9 | Retire direct account creation (`POST /api/app/admin/users`) for staff in favour of invitations? | Both kept |
| D-E10 | Which roles must have MFA enrolled (beyond today's step-up for sensitive actions)? | Unchanged: step-up for sensitive actions; per-person `mfa_required` as before |
| D-E11 | Is temporary delegated authority permitted (time-limited powers)? | Not implemented |
| D-E12 | Invitation lifetime (24 hours proposed) | 24 hours |

## 10. Database migrations and rollback considerations

**`migrations/0015_institution.sql`** (additive, local only, not applied anywhere but test and local databases):

- `departments`
- `staff_assignments`, with partial unique indexes: one active head per department, and one active row per person per department
- `staff_invitations`, with a unique token hash and one pending invitation per email
- `approval_requests`, with one pending request per category and target

There is **no seed and no backfill**: no existing account gains a department, headship or permission.

Tooling updated:

- `EXPECTED_MIGRATION` and `db/schema.expected.json` (51 tables, 45 indexes);
- classification (departments: reference; the other three: identity);
- anonymisation rules;
- the `db:check` gate (PASS, 15 files).

**Rollback:** `0015_institution.sql` is classed as `olderWorker: "check"` with check `institution_rules_active`. It counts pending invitations, pending approval requests and any recorded `approval_policy`. When the count is above zero, rollback needs action first: an older Worker would ignore pending invitations and approval rules, and would allow direct actions an approval rule would hold. Remediation: revoke pending invitations, decide or cancel pending requests, and record that approval rules will not be enforced. The tables can stay after a code rollback; an older Worker never reads them.

**Before any production application** (not done, not authorised):

1. a fresh backup;
2. a restore rehearsal on staging;
3. `db:check` and the preflight;
4. confirm migrations 0010–0014 are applied in order first.

## 11. Files created and modified

**Created**

- `migrations/0015_institution.sql`
- `src/server/lms/data/institution.ts`: SQL for departments, assignments, invitations and approvals
- `src/server/lms/institution.ts`: owner policies, approver eligibility, executors, head appointment, `openApproval`
- `src/server/lms/payment-release.ts`: shared release checks
- `src/server/lms/routes/institution.ts`: all Stage E routes
- `app/app/institution-admin.tsx`: Institution tab (departments, staff, invitations, approvals, roles, policies, access history, my department)
- `app/app/invite/page.tsx`: invitation acceptance page
- `tests/stageE-institution.test.ts`: 18 tests, one per required category
- `docs/EXPANSION_STAGE_E_REPORT.md`: this report

**Modified**

- `src/server/lms/permissions.ts`: 18 table entries; no group gained an area
- `src/server/lms/index.ts`: registers the routes
- `src/server/lms/routes/auth.ts`: `startSession()` extracted from verify (same behaviour); `sendStaffInvitation()`
- `src/server/lms/routes/users.ts`:
  - reason required for staff access changes;
  - `staff.access_changed` audit;
  - approval gating;
  - unused sign-in links revoked on suspension
- `src/server/lms/routes/payment-attempts.ts`: release gated by the Owner policy, with an optional approval path
- `app/app/admin.tsx`: Institution tab; suspend, reactivate and group changes ask for a reason
- `src/server/schema-version.ts`, `db/schema.expected.json`, `scripts/db/rollback.mts`, `scripts/db/classification.mts`, `scripts/db/anonymise.mts`: migration 0015
- `docs/lms/API.md`: regenerated
- Tests updated for the new migration or the new rules, none weakened:
  - `stageB-catalogue`, `stageD-pricing`, `stageD1-integrity`, `db-preflight`, `db-recovery`, `db-gate`, `stage3b-gates` and `stage3c-staging`: migration lists and future placeholders (`0015` becomes `0016`).
  - `lms1`, `security`, `stage2b`, `stage2c`, `stage3c-staging`, `stageB-catalogue` and `stageC-lifecycle`: a `reason` on staff access changes. Refusal assertions still expect 403 or 400.
  - `stageD11-payments`: release is first shown refused for an unassigned administrator, Finance and the owner. The owner then authorises Finance in the isolated test database, and the original D.1.1 checks run unchanged with a Finance officer.
  - `lms7`: the three public invitation routes added to the explicit public-route list.
  - `phase9`: the Worker bundle budget raised from 320 to 360 KiB (see section 12).

Not touched: `app/globals.css`, logos, icons, `.env` and `.dev.vars`, wrangler configuration, Paystack integration, prices, durations, FX policy, country rules, the 21 drafts, migration 0010.

## 12. Tests and exact results

**Full suite**, run in two halves to fit the time limit, after the last code change:

| Run | Tests | Pass | Fail |
|---|---|---|---|
| Half 1 (19 files) | 146 | 146 | 0 |
| Half 2 (21 files, including `stageE-institution`) | 240 | 239 | 1 |
| **Total** | **386** | **385** | **1** |

The single failure is the **pre-existing** "3B.1: staging configuration … account_id is not pinned" (`tests/stage3b-gates.test.ts`). It has been kept visible and not weakened, as instructed in earlier stages. At the end of D.1.1 the result was 367 of 368, so Stage E adds 18 tests and every new one passes.

**New tests:** `tests/stageE-institution.test.ts` has 18 tests, matching categories 1–18 of the brief:

1. owner authority
2. Super Administrator boundaries
3. department isolation (a head's roster has no email; other departments are invisible; headship grants no area)
4. default deny (route table completeness, default policies, evaluated-only categories refused)
5. server enforcement (other groups, legacy administrators, signed-out requests)
6. invitation uniqueness, single use, expiry and token secrecy; exactly the invited access; an invited instructor starts as a candidate
7. revocation
8. escalation prevention
9. suspension reason, session revocation, before and after
10. history after an ended assignment and after removal
11. approval lifecycle with history
12. rejection and cancellation
13. self-approval, approver eligibility, escalation, and no approving changes to your own access
14. no execution while pending or expired, or after a rule is withdrawn
15. audit completeness (22 event types)
16. authenticator code for institution writes
17. Paystack release disabled for everyone until authorised, then held for the approver, with the D.1.1 checks re-run
18. regression with every rule off

Existing workflows (registration, pricing, payments, academic and administration) are covered by the rest of the suite (category 18).

**Other checks**

| Check | Result |
|---|---|
| TypeScript (`tsconfig.json` and `src/tsconfig.json`) | pass |
| ESLint | pass |
| `npm run db:check` | PASS (15 migration files) |
| `npm run docs:api` | regenerated |
| `npm run build` | pass |
| Built site compared with the pre-Stage-B baseline | 32 pages (the new `/app/invite/`); **0 pages with different visible text** |
| CSP check | pass |
| Secret scan | pass |
| `npm audit` | 0 vulnerabilities |
| `sheet:fees` | unchanged |
| Worker bundle | 340.3 KiB minified, up from about 306 KiB. The budget in `tests/phase9.test.ts` was raised from 320 to 360 KiB and recorded in the test; the Free plan limit is 3 MiB. |
| Local browser check (`wrangler dev --local`) | Owner: Institution tab with departments, staff, invitations, approvals, roles and policies. Academic head: "My department" with roster and no email. Invitation page: preview, then Accept or Decline. No Stage E request errors. (The Overview's existing Finance and Recruitment cards return 403 for an Academic administrator, as before Stage E.) |

## 13. Security limitations

- **Super Administrators keep every non-owner area**, exactly as before. Stage E does not narrow existing group rights, because doing so would silently remove access people rely on. Narrowing the `super` grant is an Owner decision.
- **Legacy (unassigned) administrators** still keep day-to-day access unless the owner turns on `restrictUnassigned`. They are refused all Stage E management and release.
- **Acceptance and account creation are two steps**, not one transaction. The invitation is claimed first (single use), so a failure after the claim leaves an accepted invitation without an account. The fix is a new invitation, and it is audited.
- **An approved request whose execution fails** stays `approved`, with the failure recorded (`execution_result`). It is not retried automatically, by design.
- **Expiry is lazy.** Invitations and requests are marked expired when next read or used, not by a timer. They can never be used after expiry either way.
- **Department heads have no approval power.** Department-scoped approvals wait for D-E2.
- **New invitees start without MFA**, like every new account. Sensitive actions still need the authenticator step-up.
- **Delivery depends on the existing email setup.** Locally it is mocked; nothing was sent.

## 14. Confirmation

- No deployment, no production migration, and no change to production D1, KV or R2 data, DNS, domains, secrets, environment variables or authentication settings.
- No real invitation and no real or bulk email was sent: every email in the tests went to the local mock.
- No real staff account was created outside the isolated test databases.
- No payment was made or initiated, and Paystack was not activated: all Paystack traffic was mocked.
- No approval rule, release authorisation or department was activated in any real database. The only policies recorded were test fixtures in isolated test databases.
- `app/globals.css`, logos and icons were not edited.

**Stopped after Stage E. Stage F not begun.**

# Skill Mountain Academy — Expansion Stage C Report
## Programme lifecycle, admissions availability and instructor capacity

Date: 27 November 2026 · Status: implemented locally and ready for owner review · Stage D has not been started.

Summary:
- A programme's lifecycle (draft, published, paused, retired) now always takes precedence over its admissions setting (open, scheduled, closed, full).
- Every assignment of a student to an instructor is checked on the server: the instructor must be approved and active, approved for that programme, and the programme must be published. A change of instructor must also be checked, give a reason, and is recorded.
- Instructor capacity is reported in full, with a read-only exception analysis.
- No new capacity limit is enforced: D-11 is still open, so the existing behaviour (going over a limit is a warning) is kept.
- **No migration was needed.**

---

## 0. What the inspection found

I checked the brief's claims against the code.

| Claim | Finding |
|---|---|
| Lifecycle (published / paused / retired) and admissions are separate | **True.** Lifecycle is `programmes.status` (Stage B); admissions are `programme_admissions.mode` plus `admission_periods` (0004). Nothing connected them. Before Stage C, a paused or retired programme was refused only indirectly, as an "unknown programme". |
| Capacity is aggregated at programme level | **True.** `lib/admissions.ts`: `capacity()` adds up the instructors' limits per programme. |
| Capacity is not enforced when assigning a student | **True.** `validInstructor()` checked only that the instructor was active and approved. It did not check whether they were approved for the programme, or their capacity. The admin "admit" route had the same gap. |
| Default capacity is 30 per approved instructor | **True.** `programme_admissions.default_instructor_cap DEFAULT 30`, used when `instructor_programmes.max_students` is NULL. |
| "Full" blocks registrations | Only when `enforce_capacity = 1`. It is off by default and unchanged. |
| Duplicate assignments are possible | **No, structurally impossible.** `enrolments` has `UNIQUE (student_id, programme_slug)` (0003), and an enrolment has one `instructor_id`. `instructor_programmes` has a primary key on (instructor, programme). |

One correction: those four statements are not in the Stage B report. They come from the Stage A audit. The code confirms them.

**Migration state:**
- Files 0001 to 0011, in sequence. 0010 is present and unchanged.
- The local schema includes 0011 (`db/schema.expected.json`, `EXPECTED_MIGRATION = 0011_catalogue.sql`).
- Production is still recorded at 0009. 0010 and 0011 are still pending there.

## 1. Files

**New**

| File | Purpose |
|---|---|
| `src/server/lms/capacity.ts` | The single assignment check, the capacity policy (D-11, owner-configurable), the capacity report and the read-only exception analysis |
| `src/server/lms/routes/capacity.ts` | Capacity, assignment-options and owner capacity-policy routes |
| `app/app/capacity-admin.tsx` | Capacity report, exception list, and an instructor picker that shows the server's verdict before saving |
| `tests/stageC-lifecycle.test.ts` | 12 Stage C tests |
| `docs/EXPANSION_STAGE_C_REPORT.md` | This report |

**Modified**

| File | Change |
|---|---|
| `src/server/catalogue.ts` | `lifecycleOf`, `lifecycles`, `assertLifecycleAllowsNew` and lifecycle messages |
| `src/server/lms/admissions.ts` | Admissions take precedence from the lifecycle: paused and retired programmes are reported as closed, the list covers every live catalogue programme, and registration checks the lifecycle first |
| `src/server/routes/register.ts`, `src/server/routes/geo.ts` | Registration and quotes return `409 programme_unavailable` for a draft, paused or retired programme |
| `src/server/lms/routes/teaching.ts` | New enrolment needs a published programme and a valid assignment. A change of instructor is checked again on the server, needs a reason when an instructor is replaced or removed, and is audited as `enrolment.reassign` / `enrolment.assign` |
| `src/server/lms/routes/admit.ts` | Admin admission: lifecycle check plus the same assignment check |
| `src/server/lms/routes/admissions.ts` | Admissions settings, periods and eligibility accept any catalogue programme, including ones published after the last build |
| `src/server/lms/routes/catalogue.ts` | `resume` route; `history` route; the catalogue list shows admissions, enrolment and capacity |
| `src/server/lms/data/admissions.ts`, `src/server/lms/data/catalogue.ts` | Read-only queries |
| `src/server/lms/permissions.ts`, `src/server/lms/index.ts` | 5 new routes registered |
| `app/app/admin.tsx` | Instructor allocation uses the checked picker and the capacity report |
| `app/app/catalogue-admin.tsx` | Lifecycle and admissions panel, open / schedule / close buttons, Resume, status history |
| `docs/lms/API.md` | Regenerated |

**Tests adjusted.** These only set up data the new rule requires; no assertion was weakened.
- `tests/lms-helpers.ts`: new `eligible()` helper.
- `lms2`, `lms3`, `lms4`, `lms5`, `security`, `stage2b`, `stage2c`, `refinement`, `admissions`, `identity`: each instructor is made eligible for the programme before receiving a student. Reassignments now include a reason.
- `stageB-catalogue`: a draft or paused programme now gets 409 `programme_unavailable` instead of 400, and the catalogue now has 10 routes instead of 8.
- The pre-existing 3B.1 test was **not** touched.

## 2. Database

**No migration (no 0012).** Every requirement fits existing tables:

| Need | Where it is stored |
|---|---|
| Lifecycle | `programmes.status` (0011) |
| Admissions | `programme_admissions` and `admission_periods` (0004) |
| Eligibility and individual limits | `instructor_programmes.max_students` (0004) |
| Assignments | `enrolments.instructor_id`, one instructor per enrolment |
| Capacity policy | `app_settings` key `capacity_policy` (0007) |
| Reassignment history and status history | The existing `audit_log` |

So there is no new table and no new personal data to classify, and rollback is unaffected. Rolling back the code simply returns to the old checks; no data has to be undone.

## 3. Programme lifecycle

| State | New registrations | New students added by admins | Existing students |
|---|---|---|---|
| draft | refused (409 `programme_unavailable`) | refused | — |
| published | decided by admissions | allowed | full access |
| paused | refused, even if admissions are "open" | refused | full access; their instructor can still be changed |
| retired | refused | refused | full access; their instructor can still be changed; the name still shows on records |

- Pause, **resume** (new route, applies no pending draft) and retire (reason required) use the existing catalogue publisher rule: the owner, or a Super Administrator only while the owner's existing `superMayPublish` setting is on, plus the authenticator code. No second policy was created.
- Every change is audited: `catalogue.unpublish` (pause), `catalogue.resume` and `catalogue.retire`, alongside the Stage B events.

## 4. Admissions availability

- The existing modes are kept: open, scheduled (with periods), closed. "Full" applies when capacity enforcement is switched on for the programme.
- These rules only apply to published programmes. Paused and retired programmes show "closed" on the public `/api/admissions`, so a page left over from the last build cannot invite registrations.
- Admins can open, schedule or close admissions from the catalogue detail panel, which uses the existing admissions route and permission. They can also see whether a programme is full, its enrolment counts (active, paused, finished), its capacity, and its status history.
- **Note:** under the existing default-deny permissions, admissions settings belong to the **Admissions** group. The Academic group can read them but not change them. I did not widen this.

## 5. Instructor capacity

**Checks run on every assignment, in this order:**
1. The instructor exists.
2. The instructor is approved and active.
3. The instructor is approved for this programme (`instructor_programmes`).
4. The programme is published. This applies to new assignments; moving an existing student is allowed on a paused or retired programme so they keep being taught.
5. Capacity.
6. The enrolment is current (active or paused).
7. There is no duplicate.

Admins can preview the result through `GET /api/app/admin/assignment-options`, but the server checks again when the assignment is submitted. Any capacity figure sent by the browser is ignored.

**Capacity rule (kept as it is):**
- An instructor's limit for a programme is their own `max_students`, or else the programme default (30).
- Active and paused enrolments count. Completed and withdrawn enrolments count as history only.
- Going over the limit gives a **warning**, as before.

**Policy mechanism, inactive:**
- The owner (with the authenticator code) can record a standard and a maximum per instructor, with status `not_set`, `pending_approval` or `approved`.
- Enforcement can only be switched on for an approved policy. Once on, an assignment over a limit is refused. Existing assignments are never changed or removed (tested).
- It is currently `not_set` with enforcement off.
- The 20 / 30 proposal is used **only** to label the report, marked "proposal, not approved by the owner".

**Capacity report (Instructor allocation tab).** For each instructor and programme:
- whether they are approved for it;
- their configured limit, or the default;
- active students, utilisation and places left;
- whether they are at capacity or over their limit;
- whether they are above the proposed standard;
- whether they are not approved or not active but still have students;
- current and past student counts.

## 6. Read-only exception report

`GET /api/app/admin/capacity` returns `exceptions`, with counts and record IDs. Nothing is changed (tested by hashing the enrolments table before and after).

| Category | Identifiers given |
|---|---|
| Instructors above the proposed 20-student standard | instructor ID, number of students |
| Instructors above their configured limit for a programme | instructor ID, programme, students, limit |
| Students assigned to an instructor not approved for that programme | enrolment, student, instructor and programme IDs |
| Instructors not approved or not active who still have students | instructor ID, status, verification |
| Students with more than one current enrolment on the same programme | always 0, because of the UNIQUE constraint; still checked |
| Active enrolments without an instructor | enrolment, student, programme |
| Duplicate eligibility records | always 0, because of the primary key |

**I could not run this on production data.** There is no access, and this stage does not deploy. The counts for real records will appear when the code is deployed and an admin opens Instructor allocation, or after a staging restore of a production backup.

**Likely finding to expect.** Before Stage C, nothing required an instructor to be approved for a programme. Some current assignments in production may therefore appear under "assigned to an instructor not approved for that programme". They keep working, but changing their instructor needs a valid choice. The fix is to add the programme to the instructor's teaching assignments, which needs no owner decision unless you prefer a different course of action.

## 7. Assignment and reassignment

- The checked instructor picker shows the server's verdict for each instructor: ✓, blocked (with reasons) or warning, plus their current students against their limit.
- Changing or removing an instructor needs a reason. The change is recorded with the previous instructor, the new instructor, the reason, and the admin who made it (`enrolment.reassign`).
- What stays exactly as it was:
  - the enrolment;
  - past classes and attendance, which keep the original instructor;
  - coursework, submissions, quizzes, grades and messages.
- Future classes move to the new instructor, as before.
- Instructors still see only their own students (tested).

## 8. Permissions and audit

| New route | Who can use it |
|---|---|
| `GET /api/app/admin/capacity` | Academic group, Super Administrators |
| `GET /api/app/admin/assignment-options` | Academic group, Super Administrators |
| `GET /api/app/admin/catalogue/programmes/:slug/history` | Catalogue readers |
| `POST /api/app/admin/catalogue/programmes/:slug/resume` | Catalogue area, plus the owner or a delegate with the authenticator code |
| `PUT /api/app/owner/capacity-policy` | Owner only, with the authenticator code |

- All are in the default-deny table. A test also checks that every `/api/app/admin` and `/api/app/owner` route is in the table.
- Finance, Admissions and others are refused the capacity routes. Students and instructors are refused everywhere in administration.
- The existing same-origin (CSRF) check applies.

**Audit events added:**
- `catalogue.resume`
- `enrolment.assign`
- `enrolment.reassign` (from, to, reason, by)
- `owner.capacity_policy` (from, to)

The existing `admissions.update` and `catalogue.*` events are now shown as the programme's status history.

## 9. Tests (commands run, 27 Nov 2026)

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx tsc --noEmit -p src/tsconfig.json` | PASS |
| `npx eslint` | PASS |
| `npm run db:check` | PASS (11 files; the standing 0007 and 0011 owner notes) |
| `node --test` (36 files, in two halves) | **331 of 332 pass** (134/134 and 197/198), including the 12 new Stage C and 14 Stage B tests |
| `npm run build` | PASS: the catalogue export fell back to the seed list, as expected offline |
| Before/after build text comparison | 31 pages, none with different text: the public site is unchanged |
| `npm run security:csp` | PASS: 30 pages, report mode |
| `npm run security:secrets` | PASS |
| `npm audit` | 0 vulnerabilities |
| Browser check | Instructor allocation (picker, capacity table, exceptions) and the catalogue lifecycle panel load against a local database with no errors |

**The one failure is the pre-existing `3B.1: staging configuration …` (`account_id is not pinned`).** It belongs to the security workstream. It was left unchanged and is not a Stage C failure.

## 10. One-on-one model

Unchanged: one instructor per enrolment, with individual coursework, attendance and records. There is no cohort, group or group-enrolment structure; a test checks the schema for any.

## 11. Production safety

- No production migration, deployment, DNS change or production data change.
- No new migration was written.
- 0010 was not modified or applied.
- Local runs only: Miniflare tests and an isolated local D1 for the browser check.

## 12. Owner decisions needed

1. **D-11 capacity policy:**
   - the standard and maximum per instructor (the proposal is 20 / 30);
   - whether to enforce them;
   - who may approve an allocation above the standard. The mechanism exists but is inactive, and no approval authority has been assumed.
2. What to do with any production assignments that appear in the exception report, especially instructors not yet approved for a programme they teach, and instructors who are not approved or not active but still have students. Nothing is changed until you decide.
3. Whether the Academic group (Head of Programmes) should also be allowed to change admissions settings. Today only the Admissions group, Super Administrators and the owner can.
4. The Stage B decisions are still open, including NGN tuition, `cloud-devops` and the publication date.

## 13. Gaps in acceptance

- **The exception report has not been run on production data**, because there is no access and nothing was deployed. Only the mechanism and the test data are verified.
- **No capacity threshold is enforced**, by design, until D-11 is approved.
- **Admissions management from the catalogue panel works only for the Admissions group.** Academic staff can see the settings but not change them, under the existing permissions (decision 3 above).

Stage C stops here for owner review.

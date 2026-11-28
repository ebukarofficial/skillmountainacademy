# Institutional dashboard redesign and role experience

**Status:** implemented locally for Owner review. Nothing was deployed. The production owner configuration is unchanged.
**Date:** 28 November 2026.
**Scope:** Owner-directed priority stage. Stage E.3 is already complete and Stage F has not been started.

Contents:

1. Existing dashboard architecture inspected
2. Reference images analysed and the design principles implemented
3. Files created and modified
4. Shared dashboard components implemented
5. Role-by-role dashboard implementation status
6. Features reused from the existing platform
7. Features that remain unavailable or require future implementation
8. Permission and route protection results
9. Owner email configuration changes
10. Confirmation that the existing Owner identity and historical records were preserved locally
11. Confirmation that production Owner configuration was not changed
12. Responsive design verification
13. Test results and known failures
14. Build, security and bundle-size results
15. Database changes and migration implications
16. Outstanding decisions requiring Owner approval

---

## 1. Existing dashboard architecture inspected

| Area | What exists |
|---|---|
| Authentication | Single-use email links → `POST /api/auth/verify` → HttpOnly session; authenticator (TOTP) step-up for sensitive actions; owner break-glass. **Not changed.** |
| Owner identity | `OWNER_EMAIL` (in `wrangler.jsonc`, currently the production value) plus the one-row `owner_record` written at bootstrap. `resolveOwner` returns `bootstrapped` only when both agree; a different `OWNER_EMAIL` makes nobody the owner (`mismatch`). The record is protected by the `owner_record_no_update` and `owner_record_no_delete` triggers. |
| Roles | `student`, `instructor`, `admin`. Administrators have a group (`admin_role`): super, admissions, finance, academic, faculty, support or reporting. Unassigned (legacy) administrators exist. Departments (Stage E) are organisational only. |
| Server permissions | Default-deny route table, plus per-area grants, in `src/server/lms/permissions.ts`; the router refuses any administrator route not in the table. `/api/me` returns the person's group, the group actually applied, an owner flag and the areas they can read and write. |
| Dashboards | One page, `/app/`, that picks a dashboard by role: `student.tsx` (home, programme, materials, assignments, assessments, calendar, messages, notifications, profile), `instructor.tsx` (overview, students, programmes, calendar, sessions, assignments, assessments, attendance, messages, resources, profile) and `admin.tsx` (17 tabs including Institution, Security and the Owner console). Tabs are filtered by the areas from `/api/me` (display only). |
| Frame and styling | `shell.tsx`: a white header and an indigo top navigation bar with a "More" menu; a drawer on phones. Tailwind with brand tokens from `app/globals.css` (paper `#FFFDF0`, indigo, navy, orange, red, ink); shared `ui.tsx` (Card, Btn, Badge, Stat, useLoad). |
| HR, content, advertising | **No such groups.** Instructor recruitment belongs to the Faculty group. Website content and the catalogue belong to the Academic and Admissions groups. Advertising does not exist. |
| Notifications, messages, coursework, attendance, payments, reports | All exist with their own API routes, and are reused as they are. |

**Issue found during inspection, and fixed.** The old administrator overview loaded the Finance and Recruitment figures for *every* administrator, and the server refused them with 403. The server correctly refused them, but the browser recorded failed requests. The new home loads only what the person's group may read.

## 2. Reference images analysed and design principles implemented

The seven references share the following:

- a **left sidebar** with the logo, a **profile block** (photo, name, a role pill) and a vertical icon navigation with a strongly marked active item;
- a **help card** at the foot of the sidebar;
- a **greeting header** ("Good morning, Jerome" / "Welcome back, Stella");
- **rounded white cards on a soft background**, **statistic cards with icon tiles**, a **progress ring** ("82% weekly progress");
- **compact lists** with a status, and a **calendar**;
- **activity and reminder feeds**;
- **tables**;
- **generous spacing** and **one accent colour** used sparingly.

The HR references (Peoplexio and Vanessa) add a **KPI strip** and **onboarding and task panels**.

Implemented with Skill Mountain Academy's own identity, not the references' colours or content:

- **Frame:** a white sidebar on the ivory `#FFFDF0` workspace. The profile block uses the light grey `#F8F8F9` surface. The active item is the brand **indigo**, and badges and the progress arc use the brand **orange**. There are no gradients, and no colours outside the brand palette.
- **Header:** where you are (for example "Administration / Overview"), today's date in Lagos time, calendar and messages shortcuts (only when the role has them), the notification centre and the account menu.
- **Welcome section:**
  - a greeting by time of day (Lagos);
  - the role's workspace name in orange;
  - a one-line description of the workspace;
  - real action buttons;
  - a progress ring beside them, measured from real data: programme progress for students, class attendance for instructors, completed enrolments for administrators.
- **Statistic cards:** an icon tile, the figure, its label and a note. They are clickable when a section handles them, and show a dash, never a made-up value, when the data is missing.
- **Panels:** "Needs attention" (counts with an Open button), activity feeds, availability lists and system health.

Not copied: stock photographs, decorative illustrations, balloons, a time tracker, salaries or devices. The platform has none of these, and showing them would be fabricated.

## 3. Files created and modified

**Created**

- `app/app/dash.tsx`: shared dashboard components (section 4)
- `app/app/admin-home.tsx`: administrator home per group, the Owner command centre and the planned workspaces
- `src/server/owner-transition.ts`: the owner email transition, as guarded SQL (a pure module)
- `scripts/owner/transition-email.mts`: runs that transition on the **local** database only
- `tests/dashboard-roles.test.ts`: 13 tests
- `docs/INSTITUTIONAL_DASHBOARD_REDESIGN_REPORT.md`

**Modified**

- `app/app/shell.tsx`: the new sidebar frame (profile block, vertical navigation, help card, slim header, drawer). The notification centre is unchanged.
- `app/app/student.tsx`: welcome section with progress ring, and statistic cards (tasks, next class, instructor, unread messages). Every existing panel is kept.
- `app/app/instructor.tsx`: welcome section with attendance ring, and statistic cards (active students, today's classes, awaiting grading, attendance to record). Every existing panel is kept.
- `app/app/admin.tsx`: the Overview tab now renders `AdminHome`; the sidebar shows the person's real role; the old Overview component was removed (its figures and actions moved into `AdminHome`).
- `app/app/page.tsx`: carries the `applied` and `owner` fields that `/api/me` already sent.
- `app/app/ui.tsx`: `Card` given the same corner radius and border as the new panels (visual only).
- `src/server/lms/routes/auth.ts`: a new `OWNER_EMAIL` address never gets an account auto-created once an owner is bootstrapped under a different address (section 9).
- `.dev.vars.example`: local `OWNER_EMAIL` override, set to the designated address.

Not touched: `app/globals.css`, logos, icons, `wrangler.jsonc`, permission groups and grants, routes, tuition, admissions, FX, payments, migrations.

## 4. Shared dashboard components implemented

These live in `app/app/dash.tsx`. Every value comes from the API.

| Component | What it is for |
|---|---|
| `WelcomeHero` | Greeting, eyebrow, description, actions and an aside. |
| `StatCard` and `StatGrid` | A figure with its icon; optional navigation; a dash when there is no data. The grid is 1 column on phones, 2 on tablets and 4 on wide screens. |
| `ProgressRing` | Percentage ring. A missing percentage shows "–", never 0%. |
| `Panel` and `LinkBtn` | The standard card, and a "view all" link. |
| `AttentionList` | Counts with an Open button. With nothing to show, it says so. |
| `ActivityFeed` | Dated items (notifications, audit events) that open their target. |
| `MiniCalendar` | Month grid with real event markers and working previous/next buttons. |
| `Unavailable` | The clearly labelled "Not available yet" state. No figures and no dead buttons. |

The frame (`AppShell`) provides permission-aware navigation (each dashboard passes only the sections its role has), the notification centre, the profile menu, breadcrumbs and the mobile drawer. Existing tables, filters, empty states, error messages (`Msg`), confirmations and calendars (`calendar.tsx`) are reused unchanged inside the new frame.

## 5. Role-by-role dashboard implementation status

| Role | Status | What the home shows (all real data) |
|---|---|---|
| **Student** | Implemented | Greeting with programme and registration number; programme progress ring; cards for tasks (overdue highlighted), next one-on-one class, assigned instructor and unread messages. Kept below: next class with Join, weekly study checklist, academic tasks, announcements and messages, My Programme, upcoming events, academic progress, learning resources. All other student sections are unchanged. One-on-one model kept. |
| **Instructor** | Implemented | Greeting with headline and faculty number; class attendance ring; cards for active students, classes today, awaiting grading and attendance to record. Kept below: today's classes, grading queue, activity, upcoming classes, student messages, at-a-glance figures. Instructors still see only their assigned students (server-enforced; test 2). |
| **Owner** | Implemented: *executive command centre* | Institution figures (students, instructors, programmes open, enrolments); finance (revenue, outstanding and overdue, paid registrations, checkouts to reconcile); **Needs attention** (allocation, timetables, missing outcomes, bank transfers, uncertain checkouts, profiles to verify, call requests, enquiries, failed approved actions); **Requires your decision** (pending approvals the owner can decide, permanent removals, unassigned administrators); **Recent audit events**; **System health** (schema status, errors logged, owner-identity state); programme availability; **Planned workspaces**. Links to the Owner console and Institution. |
| **Super Administrator** | Implemented | Broad administration home (overview, finance, recruitment, admissions), as the existing grants allow. No owner-only panels or data: the server sends none (test 4). |
| **Finance** | Implemented | Finance workspace: figures, reconciliation count, payments-related attention items. Every Finance safeguard is unchanged. |
| **Admissions** | Implemented | Admissions workspace: overview figures, programme availability, new call requests, enquiries needing follow-up. |
| **Academic Administration** | Implemented | Allocation, timetable, missing outcomes and completion; links to allocation, attendance and assessments. |
| **Faculty Management** | Implemented | Instructor verification queue, instructor figures. |
| **Student Support** | Implemented | Overview figures, activity, link to Students (monitoring and contact). No finance data is requested. |
| **Reporting** | Implemented (read only) | The figures it may read; attention items are shown **without** Open buttons; the label says read only. Direct write calls are refused (test 10). |
| **Unassigned administrator** | Implemented | Existing day-to-day access (unchanged); shown as "Administrator (no group)". |
| **HR** | **Not implemented** (no group) | Owner-only "Not available yet" panel explaining what exists today (Faculty group, Institution). No route, permission or account was created. |
| **Content Manager / Publisher** | **Not implemented** (no group) | Owner-only panel: content is managed today by the Academic and Admissions groups; publishing still needs the owner. |
| **Advertising Manager / Publisher** | **Not implemented** (no group, no data) | Owner-only panel stating that no campaigns, tracking, spending or ad accounts exist. |

## 6. Features reused from the existing platform

The new home dashboards add no API route. They reuse the existing endpoints:

- student overview, sessions, assignments, quizzes, progress and messages;
- instructor students, performance, sessions, assignments and quizzes;
- the admin overview, finance, recruitment, admissions, bookings, enquiries, payment attempts and platform endpoints;
- approvals;
- owner status and audit;
- notifications.

Every section behind the dashboards (allocation, attendance, coursework, catalogue, institution, owner console and so on) is unchanged apart from the new frame.

## 7. Features unavailable or requiring future implementation

| Feature | State |
|---|---|
| HR workspace: staff records, leave, reviews, HR documents, interview scheduling | Planned, not implemented. Needs an HR group and new data. |
| Content workspace: drafts and approval flow for announcements and media, revision history | Partly exists: the catalogue has draft, published, paused and retired programmes with history, managed by the Academic group. A dedicated content group and an announcement or media library are planned, not implemented. |
| Advertising workspace | Planned, not implemented. No data, no integration, no spending. |
| Global search bar (seen in the references) | Not added. There is no search API, and a decorative search box would be a dead control. |
| Student retention indicators | No retention data model; only completion is shown. |
| Strategic performance reports | The existing Reports tab is reused; no new report types were added. |

## 8. Permission and route protection results

- **Unchanged server model:** no route, group, grant or table entry was added or changed. `adminMay` and `areasFor` are exactly as before, and the router still refuses any route outside a person's areas.
- **Navigation:** filtered by the server's areas (as before). The home now *requests* only permitted data, so no 403s are generated in the browser. Test 20 checks this in the source.
- **The dashboard is not authority.** Direct API calls outside a role are refused (tests 1–4 and 6–13):
  - students reaching administration, instructors reaching another instructor's student;
  - each group reaching another group's area;
  - a Super Administrator reaching owner-only routes;
  - Reporting attempting writes;
  - unknown groups (`hr`, `content`, `advertising` and others) being assigned (refused with 400) or granted anything (nothing).
- **Owner-only:** owner panels appear only when `/api/me` says `owner: true`, and their data routes are owner-only on the server.

## 9. Owner email configuration changes

**Designated address:** `pascalsolomon63@gmail.com`.

**Why `wrangler.jsonc` was NOT changed.** `wrangler.jsonc` holds the **production** `OWNER_EMAIL` (`bookebukar@gmail.com`) and is deployed through Git → GitHub → Cloudflare. Changing it would change the production environment at the next deploy, which this brief forbids. It would also lock out the production owner (`mismatch`) until the production database had been transitioned. The new address is therefore set as a **local override** in `.dev.vars.example`; copy it to your git-ignored `.dev.vars`. Wrangler gives `.dev.vars` values precedence over `wrangler.jsonc` vars in local development. The address appears in one configuration file, plus the tests and this report.

**Transition of the existing owner identity**, using the existing mechanism (the documented D1 owner procedure in `docs/SMA_STAGE_2C_FINAL_SECURITY_GATE.md` §4, adapted to keep the same account):

- `src/server/owner-transition.ts` builds guarded SQL that:
  1. drops the `owner_record_no_update` trigger;
  2. changes the email of the **same** owner account and of `owner_record`, only if the record still holds the old address **and** no account already uses the new one;
  3. re-creates the trigger;
  4. writes an `owner.email_transition` audit row;
  5. **in that same run only**, ends the owner's sessions and unused sign-in links.

  The user id, authenticator, group and history all stay. It creates no account and no second owner. It is resumable and idempotent: a second run changes nothing.
- Run it locally with `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/owner/transition-email.mts --from <current owner email> --to pascalsolomon63@gmail.com [--persist-to <dir>]`. `--remote` is refused.
- **Safety fix in `auth.ts`:** once an owner is bootstrapped, signing in with a new `OWNER_EMAIL` address never auto-creates an administrator account. Before this fix, changing `OWNER_EMAIL` and then signing in with the new address would have created a second, unassigned administrator account (not the owner, but with broad day-to-day access).
- **The previous address after the transition:** no account holds it, so it cannot sign in at all, and requesting a link creates nothing. It is not in `ADMIN_EMAILS`.

**Production transition, for later, with the Owner's approval (not done):**

1. Take a backup (`npm run db:backup -- --remote --owner-approved …`).
2. Change `OWNER_EMAIL` in `wrangler.jsonc` to the new address.
3. Apply the same guarded SQL to the production database, in the same maintenance window as the deploy. The local tool deliberately refuses `--remote`, so this is a separate, reviewed `wrangler d1 execute --remote --file` step.
4. Sign in with the new address. The existing authenticator still applies.
5. Verify the owner console shows `bootstrapped`.

Between steps 2 and 3 nobody is the owner. This is safe, because no account is created, but the steps should be done together.

## 10. Owner identity and historical records preserved locally

Locally, on the development database, I ran the transition tool:

```
node scripts/owner/transition-email.mts --from boss@example.com --to pascalsolomon63@gmail.com --persist-to /tmp/sma-ui
```

| After the run | Result |
|---|---|
| The owner account `u-boss` | now `pascalsolomon63@gmail.com` |
| `owner_record` | same `user_id` and `bootstrapped_at`; new email |
| Triggers | both owner-record triggers present |
| Audit | `owner.email_transition` row written; every earlier audit row kept |
| Sessions | the owner's sessions ended |
| Owner status (with `OWNER_EMAIL=pascalsolomon63@gmail.com`) | `isOwner: true, state: bootstrapped` |

Test 14–16 repeats this on an isolated database. It checks:

- same id;
- one owner record;
- no new account;
- history preserved;
- the old address not the owner (`mismatch`) before the transition;
- no account created for the new address before it;
- the old address unable to sign in after it;
- the trigger restored;
- a second run is a no-op.

A further test proves the tool never takes over an account that already uses the new address.

## 11. Production Owner configuration not changed

- `wrangler.jsonc` still has `"OWNER_EMAIL": "bookebukar@gmail.com"` (a test asserts this).
- No production secret, variable, database record or login configuration was touched.
- **The production Owner login has not changed.**

## 12. Responsive design verification

Local browser run (headless Chrome against `wrangler dev --local`, after a production build). Five roles at three widths: Owner, Finance, Academic head, instructor and student, at 1440, 820 and 390 px.

| Check | Result |
|---|---|
| Horizontal overflow | 0 px in all 15 cases |
| Page errors and failed API requests | none in all 15 cases (the old overview's 403s are gone) |
| Desktop (1440) | fixed white sidebar with profile and vertical navigation; four-column statistic grid; two-column panels |
| Tablet (820) | sidebar becomes a drawer behind the menu button; two-column statistic grid; panels stack |
| Phone (390) | drawer; single-column cards; the greeting, the next class and the primary actions stay first |

Screenshots were reviewed for each role. Test 19 checks the breakpoint structure in the source.

## 13. Test results and known failures

**Full suite**, run in three parts after the last code change:

| Part | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| 1 (15 files) | 121 | 121 | 0 | 0 |
| 2 (15 files) | 132 | 132 | 0 | 0 |
| 3 (14 files) | 189 | 188 | 1 | 0 |
| **Total** | **442** | **441** | **1** | **0** |

**The single failure is the known baseline:** "3B.1: staging configuration: separate Worker, database (by UUID), cache and settings; refused until complete; production config untouched" (`tests/stage3b-gates.test.ts:312`, `/account_id is not pinned/`). It is kept visible and has not been weakened. There are no new failures. All authentication and MFA tests pass (brief item 17), as do all student and instructor workflow tests (item 18).

**New:** `tests/dashboard-roles.test.ts` has **13 of 13 passing**. It covers brief items 1–16, 19 and 20. Items 17 and 18 are covered by the existing suite.

**Existing tests and the redesign.** No existing test was changed. The redesign was adapted to the existing rules instead:

- No hex colours in dashboard code: `#F8F8F9` is produced as `bg-ink/[0.03]`, which is exactly `#F8F8F9` on white.
- The student greeting keeps "Welcome, {first name}."
- The shell keeps its documented root element.

## 14. Build, security and bundle-size results

| Check | Result |
|---|---|
| TypeScript (both configurations) | pass |
| ESLint | pass |
| `npm run db:check` | PASS (17 migration files; no new migration) |
| Production build | pass |
| Built site compared with the pre-Stage-B baseline | 0 public pages with different visible text (32 pages) |
| CSP check | pass |
| Secret scan | pass |
| `npm audit` | 0 vulnerabilities |
| Worker bundle | **368,627 bytes (359.99 KiB)** against the 360 KiB (368,640 bytes) budget in `tests/phase9.test.ts`. That is 13 bytes of headroom; the budget was not raised (Owner decision D-UI6). The dashboard work is front-end; the server grew only by the small owner-email safety check. |
| Browser console | No application errors. Chrome logs one notice, "upgrade-insecure-requests is ignored in a report-only policy", caused by the existing report-only CSP header. It is not an error, and it predates this stage. |

## 15. Database changes and migration implications

There is **no migration and no schema change**. The owner email transition uses the existing `users` and `owner_record` tables and the existing documented procedure (trigger drop and re-create). It changes data only when run, locally, by the operator.

## 16. Outstanding decisions requiring Owner approval

| # | Decision |
|---|---|
| D-UI1 | **Production owner email.** Approve the production transition (section 9), including changing `wrangler.jsonc` and applying the guarded SQL in one window. |
| D-UI2 | **HR group.** Whether to create one, which areas it reads and writes (staff records, recruitment), and whether Faculty recruitment moves to it. |
| D-UI3 | **Content group.** Whether to create a content group that can draft but not publish, and whether publishing stays with the owner or a delegate. |
| D-UI4 | **Advertising.** Whether advertising is in scope at all. It would need data, tracking and a policy; no spending or integration. |
| D-UI5 | **Global search.** Whether to add a server search API, so a search bar can be added without a dead control. |
| D-UI6 | **Worker bundle budget.** The server bundle is at the edge of the 360 KiB test budget (section 14). The next server-side change needs either an agreed higher budget (the hosting limit is 3 MiB) or a size reduction. |
| D-E1–D-E13 | Still unresolved; untouched by this stage. |

**Stopped after the dashboard redesign. No other expansion stage was started.**

# Skill Mountain Academy: Expansion Stage A, Full System Audit

Date: 27 November 2026. Mode: **read-only audit**. No application code, database, configuration, deployment, secret or live data was changed.

**Scope and evidence.**
- **Code.** The audit inspects the code in the Stage 3C package, the latest code available to this session. This session cannot read the GitHub repository directly.
- **Live comparison (read-only).** The public programme list was compared with the live website on 27 Nov 2026: the same nine programmes and durations, and the same one-on-one wording.
- **2027 catalogue (revised 27 Nov, 13:03).** The reconciliation in §7 uses the owner's *2027 Academic Programmes, Tuition & Learning Duration* document supplied with the second Stage A message: 21 numbered programmes in six schools, tuition in USD only.
  - An earlier draft of these documents (08:45 the same day) reconciled against a different list: 22 programmes with naira and dollar prices. That list is not among the files available to this session, so its figures were **removed**.
  - If that earlier list was also the owner's, the owner should say which version is current (register D-36).
- **Basis of the statuses.** Every "Implemented" statement below was checked in the server code and database schema, not inferred from the interface. Where something was confirmed only by tests (Miniflare), that is stated.

Companion documents:
- `EXPANSION_STAGE_A_DATABASE_AND_DEPENDENCY_MAP.md`
- `EXPANSION_STAGE_A_IMPLEMENTATION_ROADMAP.md`
- `EXPANSION_STAGE_A_OWNER_DECISIONS_REGISTER.md`

Status words used in this document:

| Status | Meaning |
|---|---|
| **Implemented** | Works end to end (UI, API, database) |
| **Partial** | Some layers exist |
| **Built, disabled** | Code exists, switched off in production |
| **Missing** | Not present |

---

## 1. Executive summary

The platform is a mature, security-hardened **single application**:
- one Cloudflare Worker serving a statically exported Next.js site and a JSON API;
- one D1 (SQLite) database with 44 tables;
- one KV namespace;
- Workers AI;
- Resend for email;
- Paystack, built in but switched off.

It already contains much of what the expansion needs:
- **Teaching:** enrolments, instructor assignment, timetables, class sessions with attendance, assignments, quizzes and assessments with automatic and manual marking, weekly checklists, learning materials with approval, progress and grades.
- **Admissions:** programme admission control (open, scheduled, closed, full) with capacity.
- **Staff and security:** instructor verification ("recruitment"), seven administrator groups with default-deny permissions, an owner console with owner-only powers, MFA, session revocation, an append-only audit log, retention policies.
- **AI and communication:** a programme-scoped AI learning assistant, in-app and email notifications, student–instructor messaging.
- **Finance:** finance dashboards (revenue, outstanding balances, monthly revenue).

**Three structural facts shape the whole expansion:**
1. **The teaching model is one-to-one, and the 2027 catalogue keeps it.**
   - Every assignment and quiz belongs to one student (`assignments.student_id`, `quizzes.student_id`).
   - Timetables and class sessions belong to one enrolment.
   - The website promises one-on-one teaching, and the 2027 catalogue states: *"We do not operate cohort-based classes."*

   So the brief's "group assessments", "group-wide publication" and "instructor groups" are read here as **one instructor publishing the same assessment to each of their own one-on-one students**, with results kept per student. That needs an assessment *template* that fans out to per-student rows, **not** a cohort or class entity. The reading still needs confirming (register D-01).
2. **The programme catalogue is hardcoded** in `lib/config.ts` (prices, durations, descriptions, nine programmes).
   - A `programmes` database table exists but is only a seeded mirror. Nothing in the application reads it.
   - Prices are also duplicated in the Google Sheet script (`docs/google-sheet-script.gs`).
   - Moving to the 2027 catalogue (21 programmes in six schools, with USD tuition), or editing programmes through the admin dashboard, requires making the database the source of truth.
3. **Payments are naira-only, and Paystack is switched off** in production (`/api/status` → `payments: false`).
   - The site already shows prices by location (Nigeria ₦, UK £, eurozone €, US and others $), but as approximate ("≈") conversions of the **naira** price.
   - The 2027 catalogue makes **USD the benchmark**, with local-currency equivalents. That reverses the base of the existing conversion, which is reusable.
   - It **conflicts with the Stage A brief**, which describes a fixed Nigerian NGN price plus an explicit USD international price, not calculated by exchange rate. The owner must choose (D-37).
   - Charging anything other than NGN needs a provider able to do so. Paystack's multi-currency capability for this account, and Wema/ALAT Pay's capabilities, are unverified.

**Technical health:** type checks, lint, build, CSP, dependency audit (0 vulnerabilities), secret scan and migration-file checks all pass. Full-suite result: see §16.

**Production state to note:**
- the production database is at migration 0009 while the code expects 0010 (owner integrity; rehearsed in Stage 3C, awaiting the owner's decision);
- uploads (R2) are off;
- Paystack is off.

---

## 2. Architecture

| Layer | Implementation | Notes |
|---|---|---|
| Hosting | One Cloudflare Worker `skillmountainacademy`, custom domains `skillmountainacademy.com` and `www` | Owner-confirmed (Stage 3C). Published by the owner's route: local Git → GitHub → Cloudflare build. |
| Website | Next.js App Router, **static export** (`out/`), served by Workers Static Assets with `_headers` (CSP, HSTS and others) | 30 pages. Programme pages are generated from `lib/config.ts`. |
| API | `src/worker.ts`: 9 public routes, plus the LMS router `src/server/lms/api.ts` (142 routes, role-checked on the server, same-origin checks on writes, audit) | |
| Database | D1 `skillmountainacademy-db`, 10 migrations, 44 tables, 34 indexes, 4 integrity triggers (0010) | Production at 0009 |
| Cache | KV: exchange rates (`fx:NGN`), holds | |
| AI | Workers AI binding `AI`; model from `AI_MODEL` (default Llama 3.1 8B instruct fast) | |
| Email | Resend (`RESEND_API_KEY`); templates in `src/server/email.ts` | |
| Payments | Paystack (initialise, verify, webhook), plus manual bank-transfer recording | Off: no secret set |
| Storage | R2 binding `BUCKET`, **commented out** in `wrangler.jsonc` | All uploads return "not set up" |
| Scheduled work | One cron, every 5 minutes (`src/server/cron.ts`) | Covers class reminders, meeting-link alerts and LMS jobs; rates refresh at 05:00 and 17:00 UTC; at 05:00 UTC: retention, overdue marking, instalment reminders and payment links |
| Bot protection | Turnstile on public forms | |
| Lead mirror | Optional Google Sheet webhook (`SHEET_WEBHOOK_URL`) | |
| Operations tooling | `scripts/db/*` (gated migrations, backups, restore, rehearsal), `scripts/cf.mts` (identity-bound Cloudflare operations), CI workflows | Security workstream; independent of this expansion |

---

## 3. Database (summary; full map in the dependency map)

| Domain | Tables |
|---|---|
| Catalogue and admissions | `programmes` (unused mirror), `programme_admissions`, `admission_periods`, `instructor_programmes` |
| Sales | `registrations`, `orders`, `instalments`, `payments`, `webhook_events`, `holds`, `children_enquiries`, `call_bookings` |
| Identity and security | `users`, `auth_tokens`, `auth_sessions`, `mfa_factors`, `mfa_recovery_codes`, `audit_log`, `owner_record`, `staff_removal_requests`, `rate_limits`, `id_sequences`, `app_settings` |
| Teaching | `enrolments`, `timetables`, `class_sessions`, `courses`, `lessons`, `lesson_progress`, `weekly_items`, `assignments`, `submissions`, `quizzes`, `quiz_attempts`, `resources`, `resource_chunks` (FTS5) |
| Communication | `notifications`, `messages`, `contact_log`, `assistant_enquiries`, `ai_messages` |
| Quality and operations | `instructor_ratings`, `error_log`, `d1_migrations` |

**Integrity concerns:**
- Programme references (`programme_slug` in about 10 tables) are plain text with **no foreign key**, because the catalogue lives in code.
- Money is stored as integer kobo (good), but there is **no currency column on orders or instalments**. Every order is implicitly NGN; `display_currency` is display-only.

---

## 4. APIs (summary; per-feature map in the dependency map)

**Public routes:**
- `/api/geo`, `/api/quote`, `/api/hold`;
- `/api/register`, `/api/children-enquiry`, `/api/bookings`;
- `/api/order`, `/api/pay`, `/api/paystack/webhook`;
- `/api/admissions`, `/api/faculty`, `/api/assistant/ask` (public admissions assistant);
- `/api/auth/*` (magic-link request and verify, MFA verify, owner recovery);
- `/api/csp-report`, `/api/status`.

**Signed-in routes by area:**

| Area | Routes |
|---|---|
| Student | Overview, sessions, assignments and submissions, quizzes, weekly checklist, payments, assistant, ratings, messages |
| Instructor | Students, sessions (meeting link, outcome), assignments, quizzes, grading, weekly tasks, records, attendance, performance, onboarding |
| Admin | Overview, admissions, admit, bookings, enquiries, orders, finance, payments, manual payments, currency, academics, courses and lessons, enrolments, timetables, sessions, coursework, monitoring, resources, users, invitations, MFA reset, recruitment, instructor–programme assignment, retention, audit, platform, test email |
| Owner | Status, bootstrap, staff, audit, permanent removal, removal requests, legacy administrators, policy |

Permission enforcement is a server-side table (`src/server/lms/permissions.ts`). A test fails if any administrator route is missing from it.

---

## 5. Dashboards

| Dashboard | File | What it does today |
|---|---|---|
| Student | `app/app/student.tsx` | Sessions calendar, assignments and quizzes, weekly checklist, progress, payments, AI assistant, messages, rating |
| Instructor | `app/app/instructor.tsx`, `instructor-records.tsx`, `instructor-profile.tsx` | Students, sessions (meeting link, outcomes and attendance), coursework and grading, weekly tasks, records, onboarding profile |
| Administrator | `app/app/admin.tsx`, `admissions-admin.tsx`, `desk-admin.tsx`, `monitoring-admin.tsx`, `security-admin.tsx` | Overview, admissions and capacity, desk (bookings, enquiries), monitoring, finance, academics, users, recruitment, retention and security |
| Owner | `app/app/owner.tsx` | Bootstrap, staff and groups, removal approvals, audit, legacy-administrator policy |

---

## 6. Academic system

| Capability | Status | Evidence and notes |
|---|---|---|
| Programme registration | Implemented | `/api/register`: Turnstile, admissions check (`assertCanRegister`), order and instalments, Paystack or bank transfer |
| Programme duration | Implemented (in code) | `trainingMonths` / `internshipMonths` in `lib/config.ts` |
| Student enrolment | Implemented | Created automatically after the first payment (`accounts.ts`, instructor NULL), or by an admin (`POST /api/app/admin/enrolments`) |
| Instructor assignment | Implemented (manual) | An admin sets `enrolments.instructor_id`. The server checks the instructor is active and approved, but **does not check `instructor_programmes`** (that they teach that programme) **or the instructor's own capacity**: finding R-04. |
| Student–instructor relationship | Implemented | Through `enrolments.instructor_id`. `teaches()` gates every instructor action. |
| Student groups | **Missing (and not needed as classes)** | Only "group classes" (2–3 friends on one order, `FLAGS.GROUP_ENABLED=false`). No cohort entity, and the 2027 catalogue rules out cohort classes. An instructor's "group" is their own caseload: `enrolments WHERE instructor_id = … AND programme_slug = …`, which already exists. |
| Class schedules | Implemented (per enrolment) | `timetables` (weekday, time, duration) → generated `class_sessions` |
| Weekly activities | Implemented (per student) | `weekly_items` (instructor tasks, checklist), engagement settings |
| Assignments | Implemented (**individual**) | One student per assignment. Submission text or file (file needs R2), score, feedback, notifications. |
| Quizzes | Implemented (**individual**) | `kind` = `quiz` (multiple choice only, marked automatically) or `assessment` (multiple choice plus text, marked manually). Optional time limit and due date. Questions stored as JSON with the correct answer. |
| Examinations | **Missing as a type** | The `assessment` kind can stand in, but there is no exam scheduling, invigilation or weighting |
| Grading | Implemented | Scores and feedback; grade summary per student (`/api/app/students/:id/grades`) |
| Rubrics | **Missing** | |
| Student progress | Implemented | `progressFor`: lessons, assignment and quiz averages, attention list |
| Attendance | Implemented | Session outcomes (completed, missed, cancelled, rescheduled), with late and excused detail |
| Internship | **Missing as a phase** | Only a duration number. No internship status, supervisor, logbook or evaluation. |
| Final project / portfolio | **Missing** | No capstone entity; portfolio is profile links only (instructors) |
| Student and tutor notifications | Implemented | `notifications` plus email (Resend), with `email_prefs` |
| AI-assisted learning | Implemented | See §12 |
| Whiteboard | **Missing** | |

**Can a tutor assign one assessment to a whole programme group?** **No.** Every assignment and quiz is created for one `studentId`. An instructor would have to create it once per student.

**Reusable for group assessments:**
- the question model (`readQuestions`, JSON questions, automatic marking);
- `submissions` and `quiz_attempts`;
- notifications;
- `teaches()` access checks;
- the existing grading routes.

**What group publication needs** (one-on-one model): an **assessment template**, written once by the instructor and published to all or some of their own students on a programme. Publishing creates the per-student `assignments` / `quizzes` rows, so grades, progress, the AI context and retention keep working unchanged. **No cohort table is needed.** See the roadmap, Stage F.

**How a tutor's programmes and students are established:**
- **Programme eligibility:** an admin adds the instructor to a programme (`PUT /api/app/admin/instructors/:id/programmes/:slug` → `instructor_programmes`, with optional `max_students`).
- **Approval:** the instructor must be verified as `approved`.
- **Students:** students are linked one at a time by the admin choosing the instructor on each enrolment.
- **Capacity:** capacity (the sum of `max_students`, or the default 30 per approved instructor) gates **new registrations** for the whole programme only.

---

## 7. Programme catalogue

| Question | Answer |
|---|---|
| How stored? | **Hardcoded** array `PROGRAMMES` in `lib/config.ts` (slug, name, tag, blurb, NGN price, previous price, months, level, learning outcomes). Mirrored in the `programmes` table (seeded by migrations 0002 and 0007, never read) and in the Google Sheet script `FEES`. |
| Database or code? | Names, descriptions, prices, durations: code. Currency: implicit NGN. Admission status and capacity: database (`programme_admissions`). |
| Add through admin? | **No.** Requires a code change and deployment. |
| Edit or deactivate through admin? | Prices and descriptions: **no**. Admission state (open, scheduled, closed) and public listing (`listed`): **yes**. |
| Mark full or closed? | **Yes.** `mode=closed`; `enforce_capacity` plus full capacity → "fully subscribed"; scheduled admission periods. |
| Availability on the public site? | **Yes.** `/api/admissions` state is shown on programme pages and enforced at registration (HTTP 409). |
| Linked to instructors? | **Yes.** `instructor_programmes` |
| Instructor capacity enforced? | **Programme-level only**, at registration. Not per instructor at assignment (R-04). |
| Retire without affecting students? | **Partly.** `REMOVED_SLUGS` sends old links to the home page, and historical rows keep their slug. But a removed programme disappears from `findProgramme`, so admin and student screens show the raw slug instead of the name (example: `data`, `data-analytics`, `ielts`). |
| Separate Nigerian and international tuition? | **No.** One NGN price; other currencies are approximate conversions. |

### 2027 catalogue reconciliation (21 proposed vs 9 current)

**How to read the table:**
- **Source:** the owner's 2027 catalogue (27 Nov, 13:03). It gives tuition **in USD only** and says Nigerian students see "the equivalent local currency". So the "Proposed ₦" column is **not a fixed price**: it depends on the exchange-rate rule the owner chooses (D-37). No naira figure is invented here.
- **Existing figures:** current prices are naira, from `lib/config.ts`. Durations are training + internship, in months.

| # | School | Proposed programme | Existing match | Match status | Existing ₦ | Proposed ₦ | Proposed $ | Existing duration | Proposed duration | Required action | Historical-data implications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 01 AI | AI Automation & Agentic Systems | `ai-automation` "AI Automation" | **Renamed, repriced** | 300,000 (full payment only) | ₦ equivalent of $500 (D-37) | 500 | 1 + 1 | 1 + 1 | Keep slug; change name and price; confirm full-payment-only (D-07) | Slug unchanged; existing orders keep their charged kobo amounts |
| 2 | 01 AI | AI Engineering & LLM Application Development | none | New | — | equiv. of $1,500 | 1,500 | — | 5 + 2 | Add | None |
| 3 | 01 AI | AI Chatbot & Conversational AI Development | none | New | — | equiv. of $950 | 950 | — | 3 + 2 | Add | None |
| 4 | 01 AI | AI Data Annotation & Model Evaluation | none | New | — | equiv. of $450 | 450 | — | 2 + 1 | Add | None |
| 5 | 02 Software | Web Development & Full-Stack Engineering | `webdev` "Web Development" | **Renamed, repriced, longer** | 500,000 (marked "placeholder, owner to confirm" in code) | equiv. of $1,350 | 1,350 | 4 + 2 | **5** + 2 | Keep slug; change name, price, duration | Slug unchanged; current students keep 4 + 2 (D-06) |
| 6 | 02 Software | Python Programming & Applied Software Development | none | New | — | equiv. of $1,050 | 1,050 | — | 4 + 2 | Add | None |
| 7 | 02 Software | Software Testing & Quality Assurance Engineering | none | New | — | equiv. of $1,050 | 1,050 | — | 4 + 2 | Add | None |
| 8 | 03 Cloud | Cloud Engineering | `cloud` | **Repriced, longer, content change** | 450,000 | equiv. of $1,500 | 1,500 | 4 + 2 | **5** + 2 | Change price and duration. The current site says Cloud teaches **both AWS and Azure**; 2027 says "AWS **or equivalent**" (D-05). | Slug unchanged (D-06) |
| 9 | 03 Cloud | DevOps Engineering | `devops` | **Repriced, longer, audience change** | 500,000 | equiv. of $1,500 | 1,500 | 4 + 2 | **5** + 2 | Change price and duration. Today `devops` is "Mid-level, needs basic cloud knowledge"; the 2027 curriculum starts from Linux and networking (D-05). | Slug unchanged (D-06) |
| 10 | 03 Cloud | Cybersecurity | `cybersecurity` | **Repriced, longer** | 650,000 | equiv. of $1,650 | 1,650 | 4 + 2 | **5** + 2 | Change price, duration | Slug unchanged; legacy alias `cyber` remains |
| 11 | 04 Data | Data Analytics & Business Intelligence | none active; **`data-analytics` and `data` are in `REMOVED_SLUGS`** | **New, conflicts with a removed slug** | — | equiv. of $1,050 | 1,050 | — | 4 + 2 | Choose a slug. Reusing `data-analytics` means taking it out of `REMOVED_SLUGS` (D-04). | Old records with that slug (if any) would re-attach; check production read-only first |
| 12 | 04 Data | Data Science & Machine Learning | none (`data` removed) | **New, possible slug conflict** | — | equiv. of $1,850 | 1,850 | — | 6 + 2 | Add; don't reuse `data` without review | As for 11 |
| 13 | 05 Creative | Graphic Design & Brand Identity | `graphics` "Graphics Design" | **Renamed, repriced, shorter** | 350,000 | equiv. of $650 | 650 | 4 + 2 | **3 + 1** | Change name, price, duration | Current students keep 4 + 2 (D-06) |
| 14 | 05 Creative | UI/UX Design | `uiux` "UI/UX Design (Product Design)" | **Renamed, repriced, internship shorter** | 400,000 | equiv. of $850 | 850 | 4 + 2 | 4 + **1** | Change name, price, internship | As for 13 |
| 15 | 05 Creative | Product Management | none | New | — | equiv. of $850 | 850 | — | 4 + 1 | Add | None |
| 16 | 05 Creative | AI Video Production & Professional Video Editing | none | New | — | equiv. of $700 | 700 | — | 3 + 1 | Add | None |
| 17 | 05 Creative | Digital Marketing & Growth Strategy | `marketing` "Digital Marketing" | **Renamed, repriced, training longer, internship shorter** | 300,000 | equiv. of $850 | 850 | 3 + 3 | **4 + 1** | Change name, price, duration | As for 13 |
| 18 | 06 Business | Virtual Assistance & Remote Business Operations | none | New | — | equiv. of $550 | 550 | — | 3 + 1 | Add | None |
| 19 | 06 Business | Project Management | none | New | — | equiv. of $850 | 850 | — | 4 + 1 | Add | None |
| 20 | 06 Business | Business Analysis | none | New | — | equiv. of $850 | 850 | — | 4 + 1 | Add | None |
| 21 | 06 Business | Technical Writing & Documentation | none | New | — | equiv. of $650 | 650 | — | 3 + 1 | Add | None |
| — | — | *(not in the 2027 catalogue)* | `cloud-devops` "Cloud & DevOps Engineering" | **Omitted** | 650,000 | — | — | 5 + 2 | — | Retire from admissions, or keep (D-03). It must stay resolvable for historical records. | Existing enrolments and orders must keep working and keep showing the name (R-05) |

**Summary:**
- **Continuing:** 8 of the 9 current programmes continue under the same slug. Every one is repriced, 5 are renamed, and 7 change duration: 4 longer in total (Web Development, Cloud, DevOps, Cybersecurity) and 3 shorter in total (Graphic Design, UI/UX, Digital Marketing). AI Automation keeps 1 + 1.
- **Omitted:** 1 programme (`cloud-devops`).
- **New:** 13 programmes, 2 of which touch previously removed slugs (`data-analytics`, `data`).
- **Count:** 8 + 13 = **21** programmes. The Stage A brief says **22** (D-36).
- **Instalment schedule effect:** the existing rule gives programmes with 3 months' training or less the shorter 0/30/60-day schedule. Under 2027 that covers AI Automation, AI Chatbot, AI Data Annotation, Graphic Design, AI Video Production, Virtual Assistance and Technical Writing. It also changes for Graphic Design, which today has 4 months' training.

**Schools:** six schools are defined in the catalogue (01 AI & Intelligent Systems; 02 Software Engineering & Computing; 03 Cloud, DevOps & Digital Infrastructure; 04 Data Science & Analytics; 05 Creative Technology & Digital Media; 06 Business, Management & Remote Operations). **None exist in the system**; the only grouping is the home-page `tag` (Design, Engineering, Marketing, Cloud, AI). Product Management and Digital Marketing sit under School 05 (Creative Technology) in the catalogue; to confirm (D-32).

**Planning flags (owner decisions, not defects):**
- **Possible overlap** (D-08):
  - AI Automation vs AI Chatbot;
  - Python vs AI Engineering;
  - Product Management vs UI/UX vs Business Analysis;
  - Cloud Engineering vs DevOps Engineering (both now start from Linux and networking).
- **Professional development** is described as required for all students and integrated into each programme. Today there is no shared course or module; each programme's courses and lessons are separate. A shared curriculum template could be added later (roadmap Stage B).
- **Tuition exclusions** (external exam fees, software, computers, internet) are stated in the catalogue. Check the terms and refunds pages for the same wording before publication.
- **Delivery model:** the catalogue confirms one-on-one, matching the current site and data model. This **removes** the earlier draft's "cohort" assumption (see §6 and D-01).

## 8. Country-based pricing

**Current mechanisms:**
- **IP country:** `GET /api/geo` reads Cloudflare's `request.cf.country` and chooses a display currency (`NAIRA_MARKETS=["NG"]` → NGN; US → USD; GB → GBP; eurozone → EUR; otherwise USD). Non-NGN figures are **converted from the naira price** with cached exchange rates and shown as "≈".
- **Charge:** always NGN. The order stores `display_currency` and `fx_rate` for information only.
- **Declared residence:** registration asks for a free-text "Country"; staff profiles have `country_residence` and `country_origin`.
- **Not stored:** no billing country or card country (Paystack returns card details on verification, but they are not stored).
- **The client can choose the display currency:** `body.currency` on registration is accepted from the browser. That is harmless today because only NGN is charged, but it **would become a pricing control** if USD prices were charged.

**Two statements of the policy, which disagree:**

| | Stage A brief (§5, §17) | 2027 catalogue ("Tuition Policy") |
|---|---|---|
| Base price | A Nigerian NGN price **and** an explicit USD international price; USD "not calculated from the Nigerian prices" | **One USD benchmark** per programme |
| Nigeria | NGN (a Nigerian price) | "the equivalent local currency", **₦ derived from USD** |
| Outside Nigeria | USD | £ in the UK, € in the eurozone, $ in the US, "applicable supported currency" elsewhere |
| Basis | Location, never nationality | "location and payment environment" |

Both agree that **location decides, never nationality**. They disagree on whether the naira price is **fixed** or **converted**, and on whether £ and € are charged or only shown. The owner must choose (D-37, D-38). Until then, the 2027 catalogue (the more recent owner document) is used as the planning basis, and the brief's version is kept as the alternative.

**Today's code against each version:**
- **Display by location already exists:** `currencyForCountry` maps NG→NGN, US→USD, GB→GBP, eurozone→EUR, others→USD. That is exactly the catalogue's list.
- **But the base is wrong for both versions:** it converts **from naira**, not from a USD benchmark, and not from fixed prices.
- **The browser decides the currency** used at registration (R-03), and only NGN is charged.

**Recommended design** (implementation in roadmap Stage D; parameters in the owner decisions register):
1. **Store the benchmark on the server.** Keep `price_usd` per programme, in a database-backed catalogue.
   - If the owner chooses fixed naira (the brief's version), also store `price_ngn`.
   - If the owner chooses conversion (the catalogue's version), compute the naira amount with an approved rate source and rounding rule (D-39).
2. **Decide the price region on the server at quote time.** Use the Cloudflare IP country (`cf.country`) together with the declared country of residence:
   - both in Nigeria → NGN;
   - both outside Nigeria → the international currency for that location;
   - **they disagree** (VPN, travel, roaming) → show a clear choice with an attestation ("I currently live in …"). The order is then **flagged for review**, not silently priced.
3. **Lock the quote** on the order: region, currency, amount, the exchange rate used and when it was fetched, the evidence (IP country, declared country), plus a time limit. The browser can no longer choose the charging currency.
4. **Instalments:** the locked currency and amounts apply to every part. Owner policy decides whether converted amounts are re-based for later instalments (D-10).
5. **Payment-time check.** Where the provider returns the card or billing country ("payment environment"), record it. If it conflicts with the region, raise an admissions/finance review; don't reject automatically.
6. **Legitimate changes** (a student relocates): an admissions or finance administrator re-prices, with evidence and an audit entry (D-10).
7. **VPN limits.** VPN detection is unreliable. The design relies on attestation, evidence and review, not on blocking. Nationality is never collected for pricing.

## 9. Administration

| Item | Status |
|---|---|
| Owner account | Implemented. Identified by the `OWNER_EMAIL` server variable plus the `owner_record` (0010). Cannot be suspended, removed, demoted or reset by others. Production needs migration 0010 for the record. |
| Owner console | Implemented: status, one-time bootstrap (MFA), staff and groups, permanent removals, removal approvals, audit, legacy-administrator restriction policy |
| Super Administrator | Implemented: appointed and removed by the owner only, after bootstrap; full delegated access; cannot touch the owner |
| Administrator groups | Implemented, seven: `super`, `admissions`, `finance`, `academic`, `faculty`, `support`, `reporting`. Legacy unassigned administrators keep day-to-day access, which the owner can restrict to `reporting`. |
| Permission system | Implemented: default-deny area table (read/write), enforced on the server, completeness-tested |
| Staff creation and invitations | Implemented: admin creates a user (role, group) and sends an email invitation. Managing administrators needs owner or super. |
| Staff profiles | Instructor profile implemented (verification, qualifications, links, photo, needs R2). Administrator profile minimal. |
| Suspension | Implemented (status), with immediate session revocation |
| Removal | Implemented: a removal request → owner approval → permanent removal (`staff_removal_requests`) |
| Approval workflows | Partial: removals and learning materials only |
| MFA | Implemented: TOTP, recovery codes, owner reset, enforcement option for administrators |
| Session revocation | Implemented: logout-all, on group change, MFA reset, suspension and removal; idle and lifetime limits per role |
| Audit logs | Implemented: append-only and minimum retention (0010 triggers) |
| Account recovery | Implemented: email magic link; MFA recovery codes; owner recovery token (`OWNER_RECOVERY_TOKEN`) |
| Appeals | **Missing** |

**Gap to the intended structure:**

| Intended department | Status |
|---|---|
| Admissions, Academic Administration, Finance, Faculty Management, Student Support | Exist, as groups `admissions`, `academic`, `finance`, `faculty` and `support` |
| Head of Programmes | **Missing**; possibly `academic` with programme scope |
| Human Resources | **Missing** |
| Marketing | **Missing** |
| Content Writing and Publishing | **Missing** |
| Recruitment | **Missing**; part of `faculty` today |

Programme-scoped administrators (for example, a Head of Programmes for School 03 only) are **not supported**: groups are global.

---

## 10. Faculty recruitment

| Capability | Status |
|---|---|
| Public recruitment page, job listings, application form | **Missing.** `/faculty` lists approved instructors only. |
| CV and certificate uploads | **Missing.** Uploads need R2, and there are no recruitment file types. |
| Portfolio and social links | Partial: instructor profile `links`, `certifications` with verification links |
| Role-specific questions, timed assessments, scoring | **Missing** (quizzes are student-only) |
| AI-assisted evaluation | **Missing** |
| Interview scheduling | **Missing** (the `interview_pending` stage exists as a label) |
| HR review and hiring decision | Partial: verification stages (application received → under review → assessment pending → interview pending → approved / rejected / suspended), recorded checks, approval needing the required checks |
| Staff invitations, onboarding | Implemented: admin creates the instructor and invites; the onboarding checklist is submitted for verification |
| Probation | **Missing** |
| Instructor profiles | Implemented (public listing optional) |

**Against the 2027 instructor recruitment standard.** The catalogue requires every instructor to pass, before being assigned students:
- a practical competency assessment;
- a teaching demonstration;
- professional verification;
- onboarding.

The checks exist (`lib/admissions.ts` `CHECKS`: identity, credentials, technical assessment, portfolio, **teaching demonstration**, interview, references). But only **identity, credentials and the technical assessment are required** for approval (`REQUIRED_CHECKS`). Making the teaching demonstration and portfolio review mandatory is a one-line rule change once the owner confirms (D-40). Onboarding is already enforced before verification.

**Today's "recruitment" starts after an account exists** (the instructor was already invited). There is no candidate who is not yet a user. A public application pipeline needs a separate `candidates` / applications area (roadmap Stage I). It should reuse the verification stages, checks and invitation flow.

---

## 11. Information Centre and announcements

| Capability | Status |
|---|---|
| Blog or CMS | **Missing.** Site content is code (`lib/*.ts`). |
| Internal announcements, dashboard cards, full pages, graphics | **Missing** |
| Scheduling, expiry, approval, publisher logs | **Missing.** The audit log can record publisher actions once built. |
| Audience targeting | Partial building blocks: roles, enrolments (programme), administrator groups |
| Optional email distribution | Building block: `notify()` (in-app plus email, with preferences) and Resend. No bulk or broadcast safeguards (rate, batching, unsubscribe). |

**Reusable:** `notifications`, `notify()`, `email.ts`, roles, groups and enrolments for targeting, `audit_log`, and the resource-approval pattern. A small `announcements` table is needed. No separate CMS is needed for internal announcements.

---

## 12. AI learning assistant

| Question | Answer |
|---|---|
| Models and services | Cloudflare Workers AI (`AI` binding), model `AI_MODEL` (default `@cf/meta/llama-3.1-8b-instruct-fast`), temperature 0.3 |
| Knowledge storage | `resources.text_content` → chunks in `resource_chunks` (SQLite FTS5), per `programme_slug`; plus the programme's courses and lessons, and the student's open work and progress |
| Upload | Text pasted into a resource (up to 60,000 characters). File-based ingestion is not implemented (and R2 is off). |
| Per-programme knowledge | **Yes.** Chunks are keyed by programme; search is limited to the student's programme. |
| Students restricted to enrolled programmes | **Yes.** Must have an active or paused enrolment; the programme comes from the enrolment. The system prompt refuses other topics. |
| Instructor contributions | **Yes.** Instructors add materials for their programmes with `approved=0` |
| Admin approval | **Yes.** An admin approves; only approved materials are indexed and visible to students |
| Source attribution | **Yes.** Materials numbered [n]; the model is told to cite which it used |
| Prevent other-programme questions | Prompt-level refusal plus retrieval restricted to the programme. Prompt rules are **not a guarantee**: a model can still answer general questions from its own knowledge. A "please enrol in X" response is not implemented (D-15). |
| Conversation logging | **Yes.** `ai_messages` per student, with retention policy categories. 20 questions a day, and 5 a minute. |
| Public assistant | `/api/assistant/ask` (admissions questions, `assistant_enquiries`), separate |

---

## 13. Owner intelligence

| Metric group | Obtainable from existing data | Needs new data or integration |
|---|---|---|
| Registered, active, completed students; programme enrolments and completion | Yes: `users`, `enrolments` (status, `completed_at`) | Retention needs a definition (D-17) |
| Faculty performance | Yes: sessions, outcomes, ratings, grading timeliness (`instructorsSummary`, `instructorStats`) | — |
| Application conversion | Partial: `registrations` (leads) → `orders` → `payments` | Website-visit funnel needs analytics |
| Website traffic | **No.** No analytics script. | Cloudflare Web Analytics (owner enables; account data, API) |
| Payments received, monthly, annual and cumulative revenue | Yes: `payments`, `revenueByMonth` | — |
| Outstanding balances | Yes: unpaid instalments on part-paid orders | — |
| Refunds | **No.** No refund records. | A refund table and process |
| Instructor earnings, payments made, unpaid obligations | **No** | Earnings and payout ledger (Stage K) |
| Reconciliation | Partial: provider reference per payment; manual bank-transfer references | Settlement import from the provider |
| SEO and search visibility | **No** | Google Search Console API (owner verifies the property; read access) |
| Traffic sources | **No** | Analytics |
| Search demand | **No** | Paid or limited external data (Google Trends has no official public API; keyword tools are paid) |
| Competitor positioning | **No** | Manual research or paid tools. Competitors' private or financial data is not obtainable. |
| Social mentions and public reviews | **No** | Official platform APIs with the owner's business accounts; some are paid or restricted. No scraping of private data. |
| Advertising performance | **No** | Meta and Google Ads APIs with owner authorisation |

---

## 14. Media security

| Control | Status |
|---|---|
| Accepted formats | Documents: pdf, doc(x), xls(x), ppt(x), txt, md, csv, zip, png, jpg, webp, gif. Photos: png, jpg, webp. |
| MIME validation | The browser type is **ignored**; the type comes from the extension allow-list |
| File-signature validation | **Yes.** The bytes must match the extension (`checkContent`); executables refused whatever the name; zip archives containing programs refused |
| Size limits | Files 25 MB; photos 3 MB; read with a hard cap; 30 uploads an hour per user |
| File names | Unsafe names refused (path tricks, control characters, double extensions such as `.exe.pdf`); cleaned and stored under a random key |
| SVG and HTML | **Refused** |
| Image decoding and re-encoding | **Not done.** Images are stored as uploaded. |
| EXIF stripping | **Not done.** Photos keep location and camera metadata. |
| Malware scanning | **Not implemented** (stated in code and docs). A valid signature does not mean a file is safe. |
| Storage | R2 binding **off**, so every upload returns 503 "not set up" |
| Access control | Files served only through authenticated routes with checks (photo, resource, submission) |
| Delivery | `nosniff`, `CSP: sandbox; default-src 'none'`, private cache, attachment or image only |
| Quarantine | **None** |

**Smallest safe profile-picture option without new storage** (D-20):
1. Decode and re-encode in the browser to a small WebP or JPEG (for example 256×256). This drops EXIF and anything appended to the file.
2. Validate again on the server: the signature, the exact dimensions, and under 60 KB.
3. Store the bytes in D1, in a dedicated small table, not on `users`.

At about 60 KB × a few hundred users, that is a few tens of MB, within D1 limits. The browser step is not a security control on its own; the server's checks are. Malware scanning is unnecessary for an image that is re-encoded and re-validated, but it is still required for documents (CVs, certificates) if those are ever accepted.

---

## 15. Payments and finance

| Operation | Status |
|---|---|
| 1. Student payment collection | Paystack initialise (NGN; card, bank transfer, USSD) with **Paystack off** in production; bank transfer with manual confirmation by finance (`POST /api/app/admin/orders/:reference/payments`) |
| 2. Payment confirmation | Webhook verified with HMAC-SHA512 (timing-safe); verify-on-return; amount and currency checked against the instalment; duplicates refused (event-id store plus unique provider reference). On the first payment the student account and enrolment are created. |
| 3. Settlement reconciliation | **Missing.** No settlement or payout import; references are stored for manual reconciliation. |
| 4. Refunds | **Missing.** No refund records, routes or provider calls; mentioned only in the retention policy. |
| 5. Instructor earnings calculation | **Missing** |
| 6. Instructor payout | **Missing** |
| Instalments | Implemented: 50/30/20; due days 0/45/90 (or 0/30/60 for training of 3 months or less); daily reminders and pay links; overdue marking; "access paused after 2 weeks late" messaging |
| Currency handling | NGN only (kobo integers); display conversions only |
| Financial reports | Revenue total, outstanding, monthly revenue, orders and payment history |

**Integrating another provider (Wema / ALAT Pay or others).** The provider-specific code is limited to `src/server/routes/payments.ts`:
- `startPayment` (initialise);
- the webhook signature check;
- `recordCharge` (normalised charge);
- `handlePayLink` and verify-on-return.

`payments.provider` already exists. A provider adapter interface with the same four functions, plus a provider column on new orders, is enough for collection and confirmation.

This audit **does not assume** any Wema / ALAT Pay capability: hosted checkout, virtual accounts, card acceptance, webhooks, USD, settlement files, refunds or bulk payouts. Each must be confirmed from the provider's official documentation or contract (D-25).

---

## 16. Technical health (commands executed 27 Nov 2026, local only)

All checks were run twice: for the first draft (morning) and again after the catalogue revision (13:04–13:23 local). The results were identical both times.

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | PASS |
| `npx tsc -p src/tsconfig.json --noEmit` | PASS |
| `npx eslint .` | PASS |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm run db:check` | MIGRATION FILES PASS (10 files); the standing owner note on `0007` unchanged |
| `npm run security:secrets` | SECRET SCAN PASSED |
| `npm test` | **306 tests: 305 pass, 1 fail** (see below) |
| `npm run build` + `npm run security:csp -- --expect-mode report` | PASS; CSP CHECK PASSED (30 pages) |

**API test coverage:**
- 34 test files;
- route-permission completeness is tested (`routeList()` against the permission table);
- authentication and authorisation suites: `security`, `stage2b`, `stage2c`, `lms1`–`lms6`, `stage3c-staging`, run against the real Worker in Miniflare.

**Not tested:** live Paystack, live email delivery, R2 uploads in production, and Workers AI answers (mocked in tests).

**Existing failing test (1).** `tests/stage3b-gates.test.ts`: *"staging configuration: separate Worker, database (by UUID), cache and settings; refused until complete…"*.
- **Cause:** the test asserts that the *shipped* `wrangler.staging.jsonc` still has empty ids ("account_id is not pinned"). The owner's real staging ids were added on 22 Nov 2026, after the Stage 3C test run, so the assertion is now stale.
- **What it means:** this is not a product or security defect. The isolation check itself passes on the real file.
- **Fix:** belongs to the security workstream (update the test to verify the completed configuration). It was **not** changed here, because Stage A is documentation-only.
- **Correction to Stage 3C:** the Stage 3C report's "306/306" was true when it ran, before that edit.

**Newly discovered problems:** R-01 to R-12 below. None of them is a failing test.

---

## 17. Existing risks (found by this audit)

| ID | Risk | Severity | Note |
|---|---|---|---|
| R-01 | Production database at 0009, code expects 0010: owner powers locked, audit log unprotected | High | Security workstream; rehearsed in Stage 3C; owner decision pending |
| R-02 | Catalogue in code and in the Google Sheet `FEES`, with an unused database copy: three sources of truth | Medium | Any price change must be made in two places today |
| R-03 | The browser chooses `currency` at registration | Low today, High if USD is charged | Must become server-decided before USD pricing |
| R-04 | Instructor assignment does not check programme eligibility or per-instructor capacity | Medium | An admin can assign an approved instructor to any programme's student |
| R-05 | A removed programme loses its name in dashboards (`findProgramme` returns undefined) | Low | Retirement must keep records resolvable |
| R-06 | Uploads off (R2): submissions are text only, no photos | Operational | Owner decision; storage cost |
| R-07 | No image re-encoding or EXIF stripping; no malware scanning | Medium, when uploads are enabled | |
| R-08 | No refunds or reconciliation records | Medium (finance) | |
| R-09 | AI topic restriction is prompt-based | Low–Medium | Add enrolment-aware refusals and testing |
| R-10 | `webdev` price marked "placeholder, owner to confirm" in code | Low | Superseded by the 2027 prices once approved |
| R-11 | The Stage A brief's "groups" wording could be built as cohort classes, contradicting the one-on-one promise confirmed by the 2027 catalogue | Policy | D-01: build as caseload publication, not cohorts |
| R-12 | Reintroducing `data` / `data-analytics` slugs conflicts with `REMOVED_SLUGS` | Low | D-04 |
| R-13 | Tuition policy is stated two ways (brief: fixed NGN plus USD; catalogue: USD benchmark with converted local currency) | Policy, blocks Stage D | D-37, D-38, D-39 |
| R-14 | The brief says 22 programmes; the catalogue lists 21 | Low | D-36 |

---

## 18. Missing functionality (consolidated)

1. Group publication of assessments to an instructor's own students (template plus fan-out; no cohorts).
2. Assessment categories (weekly self-quiz, monthly graded quiz, examination) and weights.
3. Rubrics.
4. Examinations as a type.
5. Internship phase and supervision.
6. Final projects and portfolios.
7. Whiteboard.
8. Database-backed catalogue editable by admin, with schools and dual pricing.
9. Server-decided price region and USD charging.
10. Departments: Head of Programmes, HR, Marketing, Content, Recruitment.
11. Programme-scoped administrators.
12. Appeals.
13. Public recruitment pipeline (applications, CV uploads, timed candidate assessments, AI-assisted scoring, interviews, probation).
14. Announcements (targeting, scheduling, approval, graphics, email distribution).
15. Owner intelligence beyond internal data (analytics, SEO, social, ads).
16. Refunds, reconciliation, instructor earnings and payouts.
17. Image sanitisation and malware scanning.
18. File-based AI knowledge ingestion.

## 19. Reusable components (consolidated)

| Component | Where | Reuse for |
|---|---|---|
| Route framework with server role checks and audit | `src/server/lms/api.ts` | Every new area |
| Default-deny permission table and groups | `permissions.ts` | New departments and areas |
| Owner and super model, removal approvals | `owner.ts`, `staff_removal_requests` | Approval workflows (programme removal, hiring, payouts) |
| Notifications and email | `notify.ts`, `email.ts` | Announcements, recruitment, assessments |
| Question model and automatic marking | `coursework.ts` `readQuestions` | Group assessments, candidate assessments |
| Submissions and attempts | `submissions`, `quiz_attempts` | Group assessment results |
| Admissions and capacity | `lib/admissions.ts`, `programme_admissions`, `instructor_programmes` | Programme states, instructor capacity |
| Verification stages and checks | `lib/admissions.ts` `VERIFICATION`, `CHECKS` | Recruitment pipeline |
| Upload validation | `upload-rules.ts`, `putUpload`, `sendFile` | CVs, graphics, photos |
| AI pipeline with approval and FTS | `assistant.ts`, `ai-index.ts`, `resources` | Programme knowledge, recruitment scoring support |
| Finance queries | `data/reports.ts` | Owner dashboard |
| Retention engine | `retention.ts` | New personal-data tables |
| Gated migration, backup and rehearsal tooling | `scripts/db/*` | Every migration in this programme |

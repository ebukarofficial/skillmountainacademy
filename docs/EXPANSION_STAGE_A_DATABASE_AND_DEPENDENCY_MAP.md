# Skill Mountain Academy: Expansion Stage A, Database and Dependency Map

Date: 27 November 2026 (revised the same day for the owner's 2027 catalogue). Read-only.

**Source.**
- **Tables:** `db/schema.expected.json`, loaded into SQLite with `PRAGMA table_info` and `foreign_key_list`.
- **Routes:** extracted from `src/server/lms/routes/*.ts` and `src/worker.ts`.
- **Created in:** the migration that created each table.
- **Column marks:** `!` means NOT NULL. **PK** = primary key; **FK** = foreign key.

**Safe to extend:**
- **Yes:** add nullable columns or new tables only (additive migrations, the existing rule).
- **Care:** heavily used or security-critical; extend only with tests.
- **No:** protected by triggers or policy.

## 1. Tables

### Catalogue and admissions

| Table (migration) | Purpose | Important columns | PK / FK | Relationships and dependencies | Safe to extend | Likely expansion change |
|---|---|---|---|---|---|---|
| `programmes` (0001) | Seeded **mirror** of the code catalogue. **Not read by the application.** | slug, name!, price_kobo!, was_kobo, timed_price_kobo, group_price_kobo, training_months!, internship_months!, level!, updated_at! | PK slug | Seeded by 0002 and 0007, and by `scripts/seed.mts` | Yes | **Becomes the source of truth** (Stage B): add `school`, `price_usd_cents`, `description`, `status` (draft, active, paused, retired), `full_payment_only`, `position`, `published_at`, `retired_at` |
| `programme_admissions` (0004) | Per-programme admission mode and capacity | programme_slug, mode!, enforce_capacity!, default_instructor_cap! (default 30), reserved!, listed! | PK programme_slug | Read by `assertCanRegister` and `/api/admissions` | Yes | Default standard and maximum capacity per D-11 |
| `admission_periods` (0004) | Scheduled intakes | programme_slug (NULL = all), opens_at!, closes_at!, cancelled_at | PK id | | Yes | Link to cohorts (`cohort_id`) |
| `instructor_programmes` (0004) | Instructor eligibility per programme, with optional cap | instructor_id!, programme_slug!, max_students | PK (instructor, programme); FK instructor → users | Capacity sum; **not checked at enrolment** (R-04) | Yes | Enforce at assignment; standard and maximum caps |

### Sales and payments

| Table (migration) | Purpose | Important columns | PK / FK | Relationships and dependencies | Safe to extend | Likely expansion change |
|---|---|---|---|---|---|---|
| `registrations` (0001) | Leads and applicants (learner, guardian, group members) | email!, programme_slug!, country (free text), lead_id, guardian…, ip_hash | PK id; FK lead_id → registrations | Personal data, under retention | Yes | `residence_country` (ISO code) for pricing |
| `orders` (0001) | One purchase | reference! (unique), registration_id!, programme_slug!, plan!, method!, total_kobo!, regular_kobo!, group_size!, display_currency!, fx_rate, status! | PK id; FK → registrations | Instalments and payments; **financial record, never delete** | Care | `currency`, `price_region`, `quote_evidence` JSON, `provider`. Keep `total_kobo` for NGN; add `total_minor` plus currency for USD. |
| `instalments` (0001) | Parts of an order | order_id!, seq!, amount_kobo!, due_date!, reference!, status!, reminder/link/paid timestamps | PK id; FK → orders | Cron reminders and pay links | Care | `currency` / `amount_minor` (Stage D) |
| `payments` (0001) | Confirmed money received | order_id!, instalment_id, provider!, provider_ref! (unique), amount_kobo!, currency!, status!, paid_at | PK id; FK → orders, instalments | Revenue reports; account creation on the first payment | Care | Settlement fields (`settled_at`, `settlement_ref`, `fee_minor`); refunds as separate rows in a new table |
| `webhook_events` (0001) | Webhook idempotency | id (event id) | PK id | Duplicate protection | Yes | Provider-prefixed ids for a second provider |
| `holds` (0001) | Timed price holds (feature off) | visitor_hash!, programme_slug!, expires_at! | PK id | KV and holds | Yes | — |
| `children_enquiries` (0001) | Children's package enquiries (feature off) | parent_name!, email!, child_age! | PK id | | Yes | — |
| `call_bookings` (0007) | Admissions call requests | name!, email!, phone!, programme, preferred_date/time!, status!, assigned_to | PK id; FK assigned_to → users | Desk | Yes | — |
| `rate_limits` (0001) | Rate-limit counters | key, window_start!, count! | PK key | Every public form | Yes | — |

### Identity, security and the owner

| Table (migration) | Purpose | Important columns | PK / FK | Relationships and dependencies | Safe to extend | Likely expansion change |
|---|---|---|---|---|---|---|
| `users` (0003, extended 0005–0009) | Every account: student, instructor, admin | email!, role! (student/instructor/admin), status!, admin_role (group), verification, verification_checks, staff_no, student_no, profile fields, photo_key, country_residence, removed_at, mfa_required! | PK id | Referenced by about 20 tables | **Care** (security-critical) | `department` or extra groups via the permission table; `probation_until`. Avoid storing photo bytes here. |
| `auth_tokens` (0003) | Magic sign-in links | token_hash, user_id!, expires_at!, used_at | PK token_hash; FK → users | | Care | — |
| `auth_sessions` (0003, 0008) | Sessions | token_hash, user_id!, expires_at!, last_activity_at, mfa_pending! | PK token_hash; FK → users | Revocation everywhere | Care | — |
| `mfa_factors`, `mfa_recovery_codes` (0008) | TOTP and recovery codes | secret_enc! (AES-GCM), code_hash! | PK user_id / id; FK → users | | Care | — |
| `audit_log` (0003) | Append-only audit | at!, actor_id, action!, target_type, target_id, detail JSON | PK id | **No: append-only triggers (0010)** | Insert only | New action names for every new feature |
| `owner_record` (0010) | The owner, fixed | user_id!, email!, bootstrapped_at! | PK id=1; FK → users | **No: triggers** | Never | — |
| `staff_removal_requests` (0009) | Removal approval workflow | user_id!, requested_by!, reason!, status!, decided_by | PK id; FK → users ×3 | | Yes | Pattern to reuse for other approvals |
| `app_settings` (0007) | Key/value policy | key, value! JSON | PK key | Owner policy, engagement, retention, IP-hash key (`sec:*`) | Yes (new keys) | Pricing policy, capacity defaults, announcement policy |
| `id_sequences` (0005) | Student and staff numbers | name, last! | PK name | | Yes | — |

### Teaching

| Table (migration) | Purpose | Important columns | PK / FK | Relationships and dependencies | Safe to extend | Likely expansion change |
|---|---|---|---|---|---|---|
| `enrolments` (0003) | Student on a programme, with an instructor | student_id!, programme_slug!, instructor_id, status!, order_id, started_at!, completed_at | PK id; FK student, instructor → users | Hub for timetables, sessions, coursework, weekly items, AI scope | **Care** (central) | `cohort_id` (nullable), `phase` (training / internship / completed), `graduation_status` |
| `timetables` (0003) | Weekly slots per enrolment | enrolment_id!, weekday!, start_time!, duration_min!, effective_from/to | PK id; FK → enrolments | Generates sessions | Yes | A cohort timetable variant (`cohort_id`) |
| `class_sessions` (0003, 0006) | Individual classes and attendance | enrolment_id!, student_id!, instructor_id, starts_at!, status!, meet_url, outcome…, attendance_detail | PK id; FK → enrolments, users, timetables | Attendance, reminders, performance | Care | Cohort sessions: either one row per student (keeps attendance logic) or a `cohort_session_id` |
| `courses`, `lessons`, `lesson_progress` (0003) | Programme outline and progress | programme_slug!, title!, position! | PK id; FK lesson → course | AI outline | Yes | Week number on lessons for weekly plans |
| `weekly_items` (0007) | Weekly checklist and tasks per student | enrolment_id!, student_id!, week_start!, item_key!, completed_at | PK id; FK → enrolments, users | Engagement monitoring | Yes | Group-wide weekly activities through a template |
| `assignments` (0003) | **Per-student** assignment | student_id!, instructor_id!, enrolment_id!, title!, due_at!, max_score! | PK id; FK → users, enrolments | Submissions, grades, AI context | Yes | `template_id` (group assessment), `rubric_id` |
| `submissions` (0003) | Assignment work and grade | assignment_id!, student_id!, text, file_key, score, feedback, graded_by | PK id; FK → assignments, users | | Yes | `rubric_scores` JSON |
| `quizzes` (0003) | **Per-student** quiz or assessment | student_id!, enrolment_id!, kind! (quiz / assessment), questions! JSON (with answers), duration_min, due_at!, max_score! | PK id; FK → users, enrolments | Attempts | Yes | `template_id`, `category` (self-quiz / monthly / exam), `weight` |
| `quiz_attempts` (0003) | Attempt, answers and score | quiz_id!, student_id!, answers JSON, score, graded_by | PK id; FK → quizzes, users | | Yes | — |
| `resources` (0003) | Learning materials, with approval | programme_slug!, course_id, kind!, url, file_key, text_content, approved!, created_by! | PK id; FK → courses | AI index | Yes | `source` attribution fields, `review_note` |
| `resource_chunks` (0003, FTS5) | AI search index | resource_id, programme_slug, title, body | virtual table | AI retrieval | Yes (rebuilt from `resources`) | — |

### Communication and quality

| Table (migration) | Purpose | Important columns | PK / FK | Relationships and dependencies | Safe to extend | Likely expansion change |
|---|---|---|---|---|---|---|
| `notifications` (0003) | In-app plus email notices | user_id!, kind!, title!, body, link, read_at, emailed_at, priority! | PK id; FK → users | `notify()` | Yes | Link to `announcement_id` |
| `messages` (0003) | Student ↔ instructor messages | from_id!, to_id!, body! | PK id; FK → users | | Yes | — |
| `contact_log` (0007) | Support contact records | student_id!, channel!, outcome!, by_user! | PK id; FK → users | | Yes | — |
| `ai_messages` (0003) | Assistant conversation log | student_id!, role!, content! | PK id; FK → users | Daily limit, retention | Yes | `programme_slug`, `sources` JSON |
| `assistant_enquiries` (0007) | Public admissions assistant log | question!, answer, answered!, needs_followup! | PK id | Desk | Yes | — |
| `instructor_ratings` (0003) | Student ratings of instructors | student_id!, instructor_id!, rating!, comment | PK id; FK → users | Performance | Yes | — |
| `error_log` (0003) | Server errors | route, message | PK id | | Yes | — |

**Missing foreign keys (by design):** `programme_slug` everywhere, because the catalogue is code. When the catalogue moves to the database (Stage B), do **not** add foreign keys retroactively; SQLite needs a table rebuild for that. Validate in code instead.

## 2. Routes by feature area (existing)

| Area | Routes (prefix `/api/app` unless noted) | Server modules |
|---|---|---|
| Registration and payment | `/api/register`, `/api/quote`, `/api/geo`, `/api/hold`, `/api/order`, `/api/pay`, `/api/paystack/webhook`; `admin/orders`, `admin/orders/:reference/payments`, `admin/finance`, `admin/payments`, `admin/currency(/refresh)`, `student/payments` | `routes/register.ts`, `routes/payments.ts`, `routes/geo.ts`, `lms/routes/admin.ts`, `lms/accounts.ts`, `repo.ts` |
| Admissions and catalogue | `/api/admissions`; `admin/admissions(/:slug, /periods)`, `admin/admit`, `admin/instructors/:id/programmes/:slug`, `admin/bookings`, `admin/enquiries`; `/api/bookings`, `/api/assistant/ask` | `lms/routes/admissions.ts`, `admit.ts`, `desk.ts`, `lms/admissions.ts`, `lib/admissions.ts`, `lib/config.ts` |
| Teaching and scheduling | `admin/enrolments(/:id, /:id/timetable)`, `admin/sessions(...)`, `instructor/sessions(...)`, `instructor/students`, `student/sessions`, `student/overview`, `sessions/:id`, `programmes/:slug/courses`, `admin/courses`, `admin/lessons` | `lms/routes/teaching.ts`, `lms/schedule.ts`, `data/teaching.ts`, `data/enrolments.ts` |
| Coursework and assessment | `instructor/assignments(/:id/grade)`, `student/assignments(...)`, `instructor/quizzes(/:id/grade)`, `student/quizzes(...)`, `student/lessons/:id/complete`, `students/:id/progress`, `students/:id/grades`, `admin/coursework`, `resources(...)`, `files/*` | `lms/routes/coursework.ts`, `data/coursework.ts`, `upload-rules.ts` |
| Weekly engagement and monitoring | `student/weekly`, `weekly/:enrolmentId`, `instructor/weekly/...`, `admin/settings/engagement`, `admin/monitoring`, `admin/students/:id/(contact, guardian, email, contacts)` | `lms/routes/engagement.ts`, `data/engagement.ts` |
| Faculty | `admin/recruitment(/:id)`, `instructor/onboarding(/submit)`, `instructor/records`, `instructor/attendance`, `instructor/meet-link`, `admin/instructors(/:id/performance)`, `instructor/performance`, `/api/faculty` | `lms/routes/admissions.ts`, `onboarding.ts`, `records.ts`, `admin.ts` |
| Administration and security | `admin/users(...)`, `admin/users/:id/invite`, `admin/users/:id/mfa-reset`, `admin/audit`, `admin/settings/retention`, `admin/platform`, `admin/test-email`, `owner/*`, `/api/auth/*`, `/api/me` | `lms/routes/users.ts`, `owner.ts`, `mfa.ts`, `auth.ts`, `security.ts`, `permissions.ts`, `session-policy.ts` |
| Communication | `messages(/:userId)`, `notifications(/read)`, `student/ratings` | `admin.ts`, `teaching.ts`, `notify.ts`, `email.ts` |
| AI | `student/assistant`, `/api/assistant/ask` | `lms/routes/assistant.ts`, `ai-client.ts`, `ai-index.ts`, `data/ai.ts` |
| Reports | `admin/overview`, `admin/academics`, `admin/finance`, `admin/platform` | `data/reports.ts` |

## 3. What each future stage should extend

| Stage (as in the roadmap) | Extend (existing) | New (minimal) |
|---|---|---|
| **B: Catalogue** (2027: 21 programmes, six schools, USD benchmark) | `programmes` (add columns, including `price_usd_cents` and a nullable `price_ngn`), `programme_admissions`, `lib/config.ts` (becomes a build-time fallback or seed), `findProgramme` (read the database, keep retired programmes resolvable), the Google Sheet `FEES` (retire or generate) | `schools` (or a `school` column), admin catalogue routes in a new `lms/routes/catalogue.ts`, the `catalogue` permission area |
| **C: Programme lifecycle and capacity** | `programme_admissions`, `instructor_programmes`, `validInstructor` (eligibility and capacity checks) | — |
| **D: Location-based tuition** | `orders` and `instalments` (currency, region, locked rate, evidence), `register.ts` (server-decided region), `pricing.ts` (`currencyForCountry` already matches the 2027 currency list; conversion base moves from NGN to USD if chosen), `geo.ts` and the KV rate refresh, `registrations.residence_country` | Pricing-policy key in `app_settings` |
| **E: Departments and approvals** | `ADMIN_ROLES`, `GRANTS`, `TABLE` (permissions), `staff_removal_requests` pattern, `owner.ts` | `approval_requests` (generic, if more than two workflows), `appeals` |
| **F: Group-published assessments (one-on-one)** | `assignments`, `quizzes` (+ `template_id`, `category`), `readQuestions`, grading routes, `notify()`, `teaches()`, the caseload query `instructorEnrolments` | `assessment_templates`, `rubrics` (no cohort table: the 2027 catalogue rules out cohort classes) |
| **G: Media** | `upload-rules.ts`, `putUpload`, `sendFile` | `user_photos` (D1 bytes) or R2 after approval; scanning service only if documents are accepted |
| **H: Information Centre** | `notify()`, `email.ts`, `audit_log`, roles, groups and enrolments for targeting | `announcements`, `announcement_reads` |
| **I: Recruitment** | `VERIFICATION`, `CHECKS`, `users.verification*`, invitation flow, `readQuestions`, `upload-rules.ts` | `job_posts`, `candidates`, `candidate_files`, `candidate_assessments`, `interviews` |
| **J: AI** | `resources`, `resource_chunks`, `assistant.ts`, `ai_messages` | Refusal logic for cross-programme questions; source fields |
| **K: Finance** | `payments`, `payments.ts` (provider adapter), `orders` | `refunds`, `settlements`, `instructor_earnings`, `payout_batches` |
| **L: Owner intelligence** | `data/reports.ts`, owner console | Connectors for Cloudflare Web Analytics and Search Console (owner credentials) |

## 4. Conflicts, security risks and data-integrity concerns

1. **Three catalogue sources** (code, Sheet script, unused table). Stage B must leave exactly one source of truth.
2. **Slug reuse.** Never reuse a slug for a different programme: `data` and `data-analytics` are in `REMOVED_SLUGS`, so old records may refer to them. Check production before reusing.
3. **Currency.** Do not reinterpret `total_kobo` for USD orders. Add explicit currency and minor-unit columns, and keep the existing columns' meaning.
4. **Per-student rows.** Group assessments should still create, or link to, per-student result rows. Grades, progress, AI context and retention all key on the student.
5. **Permissions.** Every new administrator route must be added to the permission table. The completeness test enforces this.
6. **Audit.** The audit log is append-only. New features add action names; they never edit rows.
7. **Retention.** Every new personal-data table (candidates, CVs, announcements read state) needs a retention category.
8. **Instructor capacity** must be checked at assignment (R-04) before raising caps to 20–30 students.

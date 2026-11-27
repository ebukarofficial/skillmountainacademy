# Skill Mountain Academy: Expansion Stage A, Implementation Roadmap (Stages B–L)

Date: 27 November 2026 (revised the same day for the owner's 2027 catalogue: 21 programmes, USD benchmark, one-on-one delivery). Proposal only: nothing here is implemented. Each stage starts only after the owner approves it and the decisions it depends on (`EXPANSION_STAGE_A_OWNER_DECISIONS_REGISTER.md`).

## Rules for every stage

- **Extend, don't replace.** Additive migrations only, numbered from `0011`. Production must first be at `0010` (security workstream, decision D-00).
- **Staging first.** Rehearse with the existing gated tooling (`db:preflight`, backup, `db:rehearse`, `db:migrate`) on staging before any production migration. The owner keeps approving every production migration.
- **Publishing route unchanged:** local Git → GitHub → Cloudflare. Code that needs a new migration ships **behind a database-state check**, the existing pattern, so a push never breaks the live site before its migration.
- **Every new administrator route** goes into the permission table; the completeness test enforces it.
- **Every new personal-data table** gets a retention category.
- **Every state change** is audited.
- **No live payment provider, R2, bulk email or staff account** is enabled without its own approval.

**Order and why:**
1. **B** Catalogue: everything references programmes.
2. **C** Lifecycle and capacity.
3. **D** Location-based tuition and currency.
4. **E** Departments and approvals: permissions for the rest.
5. **F** Group-published assessments (one-on-one model).
6. **G** Media security: needed by H, I and the graphics in J.
7. **H** Information Centre.
8. **I** Recruitment.
9. **J** AI learning.
10. **K** Finance.
11. **L** Owner intelligence: reads everything above.

---

## Stage B: Database-backed programme catalogue and schools

1. **Objective.** One source of truth for programmes (database), editable by authorised administrators, with six schools. The 2027 catalogue is entered **unpublished** until the owner approves publication.
2. **Reuse.** `programmes` table; `programme_admissions` (state, listing); `REMOVED_SLUGS` / `LEGACY_SLUGS` concepts; programme pages generated at build time.
3. **Modify.**
   - `lib/config.ts` `PROGRAMMES` becomes the seed and build-time fallback.
   - `findProgramme` reads the database on the server, and keeps retired programmes resolvable for history.
   - The Google Sheet `FEES` is generated from the catalogue or retired (D-02).
4. **New.**
   - `lms/routes/catalogue.ts`: admin list, create, edit, pause, retire and publish.
   - A `catalogue` permission area.
   - A build step that exports the published catalogue for the static site.
5. **Database.** `programmes`:
   - **adds** `school`, `description`, `learn` (JSON), `final_project`, `price_usd_cents` (the 2027 benchmark), `price_ngn` (nullable: used only if the owner chooses fixed naira prices, D-37), `status` (draft, active, paused, retired), `full_payment_only`, `position`, `published_at`, `retired_at`, `updated_by`;
   - optionally a `schools` table (slug, name, position).
6. **API.**
   - `GET/POST/PATCH /api/app/admin/catalogue…`;
   - public `/api/catalogue` (published only);
   - existing routes resolve names through the new lookup.
7. **Security.**
   - Price changes are audited with before and after.
   - Publishing and price changes need the `catalogue` write area, plus owner or super approval (D-09).
   - Prices are never accepted from the browser at checkout.
8. **Dependencies.** D-00, D-02, D-03, D-04, D-05, D-06, D-09, D-32, D-36, D-37.
9. **Acceptance.**
   - The site and Worker read one catalogue.
   - The 9 current programmes are unchanged until the owner publishes the 2027 catalogue.
   - Retired programmes still show names in old records.
   - The 2027 programmes (21, or as confirmed in D-36) exist as drafts in their six schools.
   - The shared professional-development component can be attached to every programme (a common course template).
10. **Regression tests.**
    - Registration price equals the catalogue price.
    - Removed and legacy slugs still behave.
    - Admissions state is unaffected.
    - Old orders and enrolments display.
11. **Risks.**
    - Static pages need a rebuild when the catalogue changes. Rebuilds happen on every push already, so publishing means "approve, then push", unless pages are later fetched at runtime.
    - Mismatch with the Sheet script.
12. **Rollback.** The columns are additive. The code falls back to the `lib/config.ts` seed if the database catalogue is missing.

## Stage C: Programme lifecycle, instructor capacity and faculty assignment

1. **Objective.**
   - Pause, retire, and mark programmes full or closed without touching history.
   - Enforce instructor eligibility and capacity when assigning students.
   - Approval-controlled programme removal.
2. **Reuse.** `programme_admissions`, `admission_periods`, `instructor_programmes`, `capacity()`, `validInstructor`, the `staff_removal_requests` approval pattern.
3. **Modify.**
   - `validInstructor` / enrolment creation: refuse an instructor who isn't assigned to the programme or is at capacity (fixes R-04), with a super/owner override that is audited.
   - The admin dashboard shows per-instructor load.
4. **New.** A programme retirement request (owner approval), reusing the approval pattern.
5. **Database.** `instructor_programmes` + `standard_cap`, `max_cap` (defaults per D-11); `programme_admissions` unchanged.
6. **API.** `PATCH /api/app/admin/catalogue/:slug/status` (pause, retire); retirement request and approval routes.
7. **Security.** The capacity override is audited; retirement needs owner approval.
8. **Dependencies.** Stage B; D-03, D-11.
9. **Acceptance.**
   - Assigning a 31st student to a 30-cap instructor is refused.
   - Assigning to an ineligible programme is refused.
   - A retired programme closes admissions, while its students keep sessions, coursework and certificates.
10. **Regression tests.** Existing enrolment, timetable and session tests; admissions states; public `/api/admissions`.
11. **Risks.** Current enrolments may already break the new rule. Run a read-only report first; existing assignments are kept and only new ones are checked.
12. **Rollback.** Enforcement behind a setting (`app_settings`), off by default until the report is reviewed.

## Stage D: Location-based tuition and currency

1. **Objective.** Show (and, where approved, charge) the price for the student's **location**, decided on the server, evidence-based, with no nationality involved:
   - the 2027 catalogue's rule: USD benchmark; Nigeria sees ₦, the UK £, the eurozone €, the US and others $;
   - or the brief's rule: fixed ₦ for Nigeria, explicit $ elsewhere (D-37).
2. **Reuse.**
   - `currencyForCountry` (already maps NG/GB/eurozone/US/others exactly as the catalogue lists);
   - the exchange-rate refresh into KV (twice a day), with its base changed from NGN to USD if conversion is chosen;
   - `cf.country` detection (`geo.ts`); `registrations.country`; `pricing.ts` (instalment maths, `convertParts` rounding); orders, instalments and payments.
3. **Modify.**
   - `register.ts`: the region is decided on the server, and the browser's `currency` is ignored for charging (fixes R-03).
   - `quote`, `pay`, reminders and receipts become currency-aware.
   - `display()` starts from the USD benchmark (or the fixed prices), not from naira.
4. **New.**
   - A pricing-region resolver.
   - Quote locking with an expiry.
   - A mismatch review queue (admissions or finance).
5. **Database.**
   - `orders` + `currency`, `total_minor`, `price_region`, `quote_evidence` (JSON: IP country, declared residence, attestation, time);
   - `instalments` + `amount_minor`, `currency`;
   - `registrations` + `residence_country` (ISO).
6. **API.**
   - `/api/quote` returns the region and price;
   - `/api/register` accepts a residence declaration and attestation;
   - admin review and re-price routes (audited).
7. **Security.**
   - The price is never trusted from the client.
   - The evidence is stored.
   - Re-pricing is limited to finance or admissions with a reason, and audited.
   - VPN limits are documented, not "solved".
8. **Dependencies.** Stage B (USD prices); provider capability for each charged currency (Stage K, D-25); D-10, D-12, D-13, D-37, D-38, D-39.
9. **Acceptance.**
   - A Nigerian IP with Nigerian residence is quoted NGN.
   - A non-Nigerian IP with non-Nigerian residence is quoted the international currency for that location.
   - The quote stores the rate and time used, and every instalment uses the locked amounts.
   - A mismatch is flagged.
   - The browser cannot switch currency.
   - Existing NGN orders are untouched.
10. **Regression tests.** All payment and instalment tests; the webhook amount check per currency; reminders.
11. **Risks.**
    - Non-naira collection may not be possible with the current provider. In that case, show the price and collect through an approved alternative, or defer.
    - Exchange-rate movement between instalments (D-10, D-39).
12. **Rollback.** Region resolution behind a setting. NGN-only behaviour remains the default.

## Stage E: Administrative departments, approvals and appeals

1. **Objective.** Add the intended departments with least privilege, programme- or school-scoped administrators, a generic approval queue and appeals, with the owner's ultimate authority unchanged.
2. **Reuse.** `ADMIN_ROLES`, `GRANTS`, the permission `TABLE`, owner and super model, invitations, suspension and removal, MFA, session revocation, the audit log.
3. **Modify.** Add groups: `head_of_programmes`, `hr`, `marketing`, `content`, `recruitment` (names per D-14). Add an optional scope (school or programme) to administrators.
4. **New.**
   - `approval_requests` (type, subject, requested_by, decided_by, status), reused by programme removal, hiring and payouts;
   - `appeals`, for suspensions and removals.
5. **Database.** `users` + `admin_scope` (JSON or a table `admin_scopes`); `approval_requests`; `appeals`.
6. **API.**
   - `/api/app/admin/approvals…`, `/api/app/admin/appeals…`;
   - owner routes to decide owner-only types.
7. **Security.**
   - Default deny for the new groups.
   - Scoped administrators are checked on every programme-bound route.
   - Super administrators cannot decide owner-only approvals.
8. **Dependencies.** D-00 (owner record), D-14, D-16.
9. **Acceptance.**
   - Each new group can reach only its areas.
   - A scoped Head of Programmes sees only their school.
   - Owner-only approvals are refused for super administrators.
10. **Regression tests.** `stage2b`, `stage2c`, `security`, the permission-completeness test.
11. **Risks.** Scope checks missed on some routes. Mitigate with a route-level scope declaration and a test.
12. **Rollback.** New groups unused until assigned; scope column nullable.

## Stage F: Group-published assessments (one-on-one model)

1. **Objective.**
   - An instructor writes an assessment once and publishes it to **all or some of their own students** on a programme. Teaching stays one-on-one; results stay per student.
   - Categories: weekly assignments and activities, weekly self-quizzes, monthly graded quizzes, examinations, and the final practical assessment.
   - Separate rubrics for assignments, self-quizzes and graded assessments.
   - Embedded resources, deadlines, individual results, secure marking.
   - Whiteboard integration as an option.
2. **Reuse.**
   - The caseload query already exists (`instructorEnrolments`: an instructor's active students by programme).
   - `assignments`, `submissions`, `quizzes`, `quiz_attempts`, `readQuestions` (multiple choice with correct answers, automatic marking), grading routes, `weekly_items`, `resources`, `notify()`, `teaches()`.
3. **Modify.**
   - Creation routes accept a template and a target: "all my active students on programme X", or a chosen list.
   - One template fans out to per-student rows, so grades, progress, AI context and retention keep working.
   - Student views unchanged.
4. **New.**
   - `assessment_templates` (category: assignment / self_quiz / monthly_quiz / exam / final; questions; rubric; weight; schedule);
   - `rubrics` (criteria, levels, points).
   - Whiteboard: embed an approved external tool by link first (D-19).
   - **No cohort table:** the 2027 catalogue rules out cohort classes (D-01).
5. **Database.**
   - `assignments` and `quizzes` + `template_id`, `category`;
   - `submissions` + `rubric_scores`;
   - new tables `assessment_templates`, `rubrics`.
6. **API.**
   - `/api/app/instructor/assessments` (create, publish to my students, schedule);
   - existing grading routes extended for rubric scores.
7. **Security.**
   - The instructor may only target students they teach (`teaches()` on every target).
   - Correct answers never reach students (existing `publicQuestions` pattern).
   - Exams are timed on the server (existing `duration_min` and `started_at` logic).
8. **Dependencies.** D-01 (confirm the caseload reading), D-18 (assessment policy and weights), D-33 (final assessment and internship), Stage C.
9. **Acceptance.**
   - One publication creates one result row for every targeted student, and none for students the instructor doesn't teach.
   - Self-quizzes don't count toward grades; monthly quizzes and exams do, with the approved weights.
   - Rubric scoring works.
   - Assessments created one student at a time still work.
10. **Regression tests.** `lms*` coursework suites; AI context; progress and grades.
11. **Risks.** Large fan-outs (30 students × several items) can hit D1 per-request limits; batch the inserts.
12. **Rollback.** Templates are additive; per-student rows remain valid without them.

## Stage G: Secure media (photos and announcement graphics)

1. **Objective.** Safe profile pictures and announcement graphics within current storage, and a documented route to documents (CVs, certificates).
2. **Reuse.** `upload-rules.ts` (signature checks, name rules, size caps), `putUpload`, `sendFile` (sandbox and nosniff headers), the upload rate limit.
3. **Modify.**
   - The photo route: browser re-encode to WebP or JPEG at a fixed size.
   - The server verifies the signature, dimensions and a size cap of 60 KB or less (D-20).
4. **New.** `user_photos` (user_id, bytes, mime, width, height, sha256, created_at) in D1, **or** R2 after approval (D-21).
5. **Database.** `user_photos`; graphics in a similar `media_assets` table (with the same caps) if D1 is chosen.
6. **API.** `PUT /api/me/photo` (existing path); `GET /api/app/files/photo/:id` serves from D1.
7. **Security.**
   - Re-encoding removes EXIF and appended data, but is **not** malware scanning.
   - SVG stays refused.
   - Documents need a scanning service before acceptance (D-22).
8. **Dependencies.** D-20, D-21, D-22.
9. **Acceptance.**
   - A disguised file is refused.
   - An oversized image is refused.
   - EXIF is absent in stored photos.
   - Photos are served only with safe headers.
10. **Regression tests.** Upload-rule tests; photo access control.
11. **Risks.** D1 size growth; set caps and a per-user limit of one photo.
12. **Rollback.** The table is additive; the photo feature can be switched off.

## Stage H: Information Centre (announcements)

1. **Objective.** Internal announcements (dashboard cards and full pages, graphics), scheduled publication and expiry, targeting (all, students, tutors, administrators, programme, an instructor's students), approval, optional email, publisher logs.
2. **Reuse.** `notify()`, `email.ts`, roles, enrolments and administrator groups for targeting, `audit_log`, the approval queue (Stage E), media (Stage G).
3. **Modify.** Dashboards show the announcement cards; notification kinds are extended.
4. **New.** `announcements` (title, body, graphic, audience JSON, publish_at, expires_at, status, approved_by, email flag); `announcement_reads`.
5. **Database.** The two tables above.
6. **API.**
   - `/api/app/admin/announcements…` (content group creates; approval to publish; owner may publish directly);
   - `/api/app/announcements` (the reader's own audience).
7. **Security.**
   - The audience is computed on the server.
   - The body is plain text or safe Markdown (no raw HTML).
   - Email distribution is batched and rate-limited, with an opt-out respecting `email_prefs`, and needs approval (D-23).
8. **Dependencies.** Stages E and G; D-23.
9. **Acceptance.**
   - The right audience sees the card, and nobody else.
   - The expiry hides it.
   - Email goes only when approved.
   - Every step is audited.
10. **Regression tests.** Notifications; email preferences.
11. **Risks.** Accidental mass email; mitigate with approval, a preview count and a daily cap.
12. **Rollback.** Additive; feature flag.

## Stage I: Faculty recruitment pipeline

1. **Objective.**
   - A public hiring link, job posts and an application form.
   - CV and credential uploads, a portfolio, timed role-specific assessments.
   - AI-assisted scoring (advisory only), HR review, interview scheduling, hiring approval, onboarding and probation.
2. **Reuse.** The verification stages and checks, the invitation and onboarding flow, `readQuestions` and timed attempts, Turnstile, rate limits, upload rules, notifications, the approval queue, Workers AI.
3. **Modify.** On approval, a hired candidate becomes an instructor user (existing invitation) with `probation_until`.
4. **New.**
   - `job_posts`, `candidates` (not users), `candidate_files`, `candidate_assessments` (questions, timing, answers, scores, AI advisory notes), `interviews`.
   - A public `/careers` page.
5. **Database.** The tables above, plus `users.probation_until`.
6. **API.**
   - Public: `/api/careers`, `/api/careers/apply`, `/api/careers/assessment/:token`.
   - Admin: `/api/app/admin/candidates…`.
7. **Security.**
   - Personal data with retention (D-24).
   - Files need Stage G and scanning (D-22).
   - AI output is advisory only and never decides (business rule).
   - Assessment links are single-use and timed on the server.
8. **Dependencies.** Stages E and G; D-22, D-24, D-26, D-40 (teaching demonstration required, per the 2027 instructor recruitment standard).
9. **Acceptance.**
   - An application reaches HR.
   - The assessment is timed and scored.
   - The AI note is labelled "advisory".
   - Hiring needs a human approval.
   - No instructor is approved without the competency assessment, teaching demonstration and professional verification (once D-40 is confirmed).
   - Onboarding uses the existing flow.
10. **Regression tests.** Instructor onboarding and verification tests.
11. **Risks.** Spam applications (Turnstile and rate limits); bias in AI scoring (advisory only, documented criteria).
12. **Rollback.** Separate tables; the careers page can be unpublished.

## Stage J: Programme-scoped AI learning assistant

1. **Objective.** Strict programme scoping with a polite "enrol in X" response, instructor contributions with approval, source attribution, secure logs.
2. **Reuse.** The whole existing assistant: enrolment scope, FTS retrieval, approval, numbered sources, `ai_messages`, daily limits, retention.
3. **Modify.**
   - Classify questions against the catalogue. If a question matches another programme's topics and is outside the student's own, return the approved "please enrol in X" reply without calling the model on that content.
   - Store the source ids used.
4. **New.** Optional file ingestion (PDF text extraction) once storage is approved.
5. **Database.** `ai_messages` + `programme_slug`, `sources` (JSON).
6. **API.** Existing routes. An admin view of the conversation logs, restricted and audited.
7. **Security.**
   - Prompt-injection rules are kept.
   - Logs contain student data; access is limited to academic and support groups, with retention.
8. **Dependencies.** Stage B (catalogue topics); D-15.
9. **Acceptance.** A Graphic Design student asking a Cloud question gets the enrolment message; in-programme questions cite sources.
10. **Regression tests.** Assistant tests (mocked AI).
11. **Risks.** Misclassifying a general question; tune with tests, and fall back to the instructor.
12. **Rollback.** Classifier behind a setting.

## Stage K: Finance (provider, refunds, reconciliation, earnings, payouts)

1. **Objective.** Treat these as separate operations:
   - (1) collection; (2) confirmation; (3) settlement reconciliation; (4) refunds; (5) instructor earnings calculation; (6) instructor payout preparation, with approval and no automatic transfers unless approved.
2. **Reuse.** `payments.ts` (initialise, webhook verification, `recordCharge`, verify-on-return), `payments`, `orders`, `instalments`, `webhook_events`, finance reports, the approval queue, attendance (`class_sessions`) and enrolments for earnings inputs.
3. **Modify.** A provider adapter interface (initialise, verify signature, normalise charge, verify transaction), with Paystack as the first implementation.
4. **New.**
   - `refunds` (amount, reason, approved_by, provider_ref, status);
   - `settlements` (imported provider settlements, matched payments);
   - `instructor_earnings` (per student and month: eligible tuition received, deductions, share, adjustments, status);
   - `payout_batches` (prepared, approved, exported; **no automatic bank transfer**).
5. **Database.** The tables above, plus `payments` settlement fields.
6. **API.** `/api/app/admin/finance/refunds…`, `/settlements…`, `/earnings…`, `/payouts…`; instructor `/api/app/instructor/earnings`.
7. **Security.**
   - Refunds and payouts need dual control: finance prepares, owner or super approves (D-28).
   - Every amount is computed on the server from recorded payments only.
   - Provider secrets stay in Wrangler secrets.
8. **Dependencies.**
   - **D-25: verified provider documentation.** Do not assume Wema / ALAT Pay supports any feature.
   - D-27 (70% rule, tax, eligibility), D-28.
   - Stage D (currency).
9. **Acceptance.**
   - Earnings equal the approved rule on test data (payments received, attendance, substitutions, exceptions).
   - A refund reduces the eligible tuition.
   - Payouts are prepared and approved, never sent automatically.
10. **Regression tests.** All payment and webhook tests; finance reports.
11. **Risks.** Tax treatment errors (owner and accountant decision); provider limitations.
12. **Rollback.** Ledgers are additive. Nothing moves money without explicit approval.

## Stage L: Owner intelligence dashboard

1. **Objective.** Institutional, financial and market intelligence for the owner, from internal data first and authorised external sources second.
2. **Reuse.** `data/reports.ts` (revenue, outstanding, monthly, academic, instructor performance), the owner console, plus all ledgers from Stages B–K.
3. **Modify.** The owner console gains a dashboard section, owner-only (or delegated read to `reporting`).
4. **New.**
   - Internal metrics: retention, completion, conversion funnel.
   - Connectors **only with owner-authorised credentials**:
     - Cloudflare Web Analytics (traffic);
     - Google Search Console (search performance);
     - Meta and Google Ads (advertising);
     - official review and social APIs where available.
5. **Database.** `metrics_daily` (snapshots), to keep dashboards fast and history stable.
6. **API.** `/api/app/owner/intelligence…`.
7. **Security.**
   - External tokens are stored as secrets.
   - No scraping of private data.
   - Competitor information only from public or authorised sources.
8. **Dependencies.** D-17, D-29, D-30, and the stages that supply the data.
9. **Acceptance.** Every figure has a documented definition and source; external panels show "not connected" until authorised.
10. **Regression tests.** Report queries; owner-only access.
11. **Risks.** Paid APIs; platform permission limits (social analytics).
12. **Rollback.** Read-only feature; the panels can be hidden.

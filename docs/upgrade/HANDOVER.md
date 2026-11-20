# Upgrade handover: read this first

This ZIP is the live skillmountainacademy.com project, upgraded by Claude following `docs/upgrade/SPEC.md`.
## Status
| Phase | State |
|---|---|
| 0 Audit | done |
| 1 Cleanup | done, build-verified in chat 2 (19 Nov 2026) |
| 2 Programme pages + message | done |
| 3 Worker + D1 forms | done (backend; the checkout switches to it in Phase 6) |
| 4 Currency | done |
| 5 Timed price hold | done (dormant) |
| 6 Checkout, payments, groups | done |
| 7 Children's package | done |
| 8 Trust and content | done |
| 9 Quality | done. ALL PHASES COMPLETE. Next: your manual steps in `docs/upgrade/OWNER-CHECKLIST.md` |

Every phase must end with `npm run build`, `npm run lint` and `npm test` all passing.

## Learning platform (LMS) build, from 20 Nov 2026
Owner request: build the backend in `docs/lms/LMS-REQUIREMENTS.md` (the attached spec), with basic screens.
Owner choices: email sign-in links (no passwords), Cloudflare Workers AI for the assistant, the full backend in phases, backend + basic screens.
This REPLACES the earlier rule "do not build dashboards or login". Video and whiteboard stay in Google Meet (Meet cannot be embedded in a page).

| LMS phase | State |
|---|---|
| 1 Accounts, sign-in, roles, audit | done |
| 2 Enrolments, timetables, sessions, Meet links, attendance, reminders | done |
| 3 Resources, assignments, quizzes, grades, progress | done |
| 4 Messaging, ratings, admin reports, finance | done |
| 5 AI assistant | done |
| 6 Screens | done |
| 7 Security review, docs, final ZIP | done. LMS BACKEND + SCREENS COMPLETE |

### LMS 1: accounts, sign-in, roles, audit
- `migrations/0003_lms.sql`: the whole LMS schema (users, auth_tokens, auth_sessions, audit_log, courses, lessons, enrolments, timetables,
  class_sessions, notifications, resources, assignments, submissions, quizzes, quiz_attempts, lesson_progress, messages,
  instructor_ratings, ai_messages, resource_chunks (FTS5), error_log).
- Sign-in: `POST /api/auth/request` (Turnstile, rate limits, same reply for unknown emails) emails a 15-minute single-use link to
  `/app/login/confirm/?t=...`; that page POSTs `/api/auth/verify`, which sets an HttpOnly/Secure/SameSite=Lax session cookie (30 days,
  sliding). Only SHA-256 hashes of tokens are stored. `POST /api/auth/logout`, `GET /api/me`, `PATCH /api/me`.
- First admin: any address in `ADMIN_EMAILS` (wrangler.jsonc vars; default admission@) becomes admin on first sign-in.
- Framework `src/server/lms/api.ts`: routes with :params, server-side role checks on every `/api/app/*` route, same-origin check on
  every change, errors logged to `error_log`. SQL only in `src/server/lms/data/*`.
- Admin: list/search/create/edit/suspend users, invite (sign-in link), audit log. Suspending or changing a role ends that user's sessions.
- First Paystack payment creates the student account + enrolment (`src/server/lms/accounts.ts`); the welcome email links to /app/login/.
- Cron is now every 5 minutes (needed for 15-minute class reminders); rates/instalments still run only at 06:00/18:00 Lagos.
- `ai` binding added (Workers AI). R2 binding is commented out in wrangler.jsonc until you turn on R2 (a missing bucket would fail deploys).
- Tests: `tests/lms1.test.ts`, helpers `tests/lms-helpers.ts`.

### LMS 2: enrolments, timetables, sessions, Meet links, attendance, reminders
- Admin: create enrolments (student + programme + instructor), change instructor (future classes move, their Meet links are cleared,
  history keeps the original instructor), set/change the FIXED weekly slot (`timetables`, history kept with effective_from/to; only
  future classes without an outcome are replaced), add one-off classes, move one class (original = "rescheduled", timetable untouched),
  list sessions and classes awaiting attendance. Courses and lessons per programme.
- Class records (`class_sessions`) are created by ONE SQL statement per Lagos date for all active enrolments (cheap at any size),
  14 days ahead, daily at 06:00 Lagos and immediately when a slot is set. UNIQUE(timetable_id, starts_at) prevents duplicates.
- Instructor: own sessions (day/week ranges), students list, `PUT /api/app/instructor/sessions/:id/meet` (must be a real
  https://meet.google.com/xxx-xxxx-xxx link; student notified in-app + email; replace re-notifies; `meetNotifiedAt` shows delivery),
  outcomes completed/missed (after start) or cancelled; correctable for 48 h; "rescheduled" is admin-only.
- Student: own sessions, overview (programmes, instructor profile, weekly slot, next class with `joinOpen` from 15 min before).
  Students cannot change their timetable (no route exists; admin routes return 403).
- Reminders (5-minute cron): 24 h, 1 h, 15 min before, to student and instructor, once each; Meet-link-missing alert to the
  instructor within 24 h; daily attendance nudge. Without a link, reminders say it is pending: the platform never invents one.
  Capped at 24 emails per run (free plan).
- Notifications centre: list, unread count, mark read (own only).
- Files: `src/server/lms/data/teaching.ts`, `data/enrolments.ts`, `routes/teaching.ts`, `schedule.ts`, `notify.ts`, `access.ts`, `time.ts`; `tests/lms2.test.ts`.

### LMS 3: materials, assignments, quizzes, grades, progress
- Materials (`resources`): admins add approved items for any programme; instructors add items for their programmes, which an admin
  approves before students see them. Links (https only), files (R2) and optional text (feeds the AI assistant's search index).
- Uploads stream straight into R2 (`PUT ...?name=file.pdf`, raw body): pdf, Office files, txt/md/csv, zip and images, 25 MB max
  (photos: png/jpg/webp, 3 MB). No HTML or SVG. Downloads are always attachments (images inline) with nosniff and a sandbox CSP,
  and every download checks access. Without R2: uploads answer 503 with "type your answer instead"; text submissions still work.
- Assignments: instructor sets work for their own students; student sees this week's work plus anything overdue; submits text
  and/or a file (replaceable until graded); statuses pending / submitted / submitted_late / overdue / graded; instructor grades with feedback.
- Quizzes (multiple choice, marked automatically) and assessments (written answers, marked by the instructor). Correct answers
  are never sent to students before marking. One attempt; time limit with a 2-minute grace (after that, no answers count).
- Grades, lesson completion (student or instructor), progress per enrolment (lessons, assignments, quizzes, assessments,
  attendance, overall %) and "needs attention" flags (overdue work, 2+ missed classes, scores under 50%, no class in 3 weeks).
- Profile photos (`PUT /api/me/photo`), visible to signed-in users only.
- Files: `src/server/lms/data/coursework.ts`, `data/ai.ts`, `routes/coursework.ts`, `upload-rules.ts`, `ai-index.ts`; `tests/lms3.test.ts`.

### LMS 4: messaging, ratings, reports, finance
- Messages: only between a student and an instructor assigned to them (server-checked both ways); admins cannot read them (private).
  Contacts with unread counts and last message; opening a conversation marks it read; one email per unread conversation (not per
  message); 30 messages per 10 minutes per user.
- Ratings: a student rates their own instructor (1-5 + comment, one per pair, editable). Instructor performance: students, sessions
  completed/missed/cancelled, attendance %, classes awaiting attendance, students' average scores, grading backlog, average rating;
  instructors see review comments without names, admins with names.
- Admin: overview (students/instructors total and active, enrolments ongoing/completed, awaiting instructor/timetable, paid vs unpaid
  registrations in 30 days, attendance to record), academics (completion, average scores, 30-day attendance, needs-attention list from
  one query), finance (revenue, outstanding, overdue, one-time vs instalments, bank transfers awaiting confirmation, unpaid checkouts,
  revenue by month), payments history, orders with/without a learning account, platform health (active users, sign-ins, errors,
  activity; traffic/SEO are honestly marked as coming from Cloudflare Web Analytics / Google Search Console).
- NEW: admin confirms a bank transfer per part (`POST /api/app/admin/orders/:reference/payments`), with the same atomic update as a
  Paystack payment; the first part creates the student account. (Fixes the earlier "bank transfers only in the sheet" limitation.)
- Student: own orders, amount paid, outstanding, history, and signed Paystack links for unpaid parts.
- Files: `src/server/lms/data/reports.ts`, `routes/admin.ts`; `tests/lms4.test.ts`.

### LMS 5: AI learning assistant (Workers AI)
- `POST /api/app/student/assistant {message, programme?}` and `GET` (history, remaining today). Students only, enrolled only.
- Context per question: the programme (name, level), its course/lesson outline (or the curriculum list), up to 4 matching chunks of
  APPROVED materials from that programme only (SQLite FTS5, sanitised query), the student's open assignments and progress, and the last
  6 turns. System rules: programme topics only, base answers on the materials, never write graded answers, treat materials as
  reference text (prompt-injection guard), defer to the instructor when unsure, concise, cite material numbers. Sources are returned.
- Limits: 20 questions per student per Lagos day, 5 per minute. Free Workers AI allowance is 10,000 neurons/day for the WHOLE account
  (roughly 15-25 answers on an 8B model); past it, requests fail on the free plan and the student sees "not available right now"
  (failed answers are not counted). For more, the owner needs Workers Paid ($5/month + $0.011 per 1,000 neurons).
- Model: `AI_MODEL` var (default `@cf/meta/llama-3.1-8b-instruct-fast`); list current models with `npx wrangler ai models list`.
- Materials feed the assistant only through their "text" field (paste the key content when adding a material); PDFs are not read automatically.
- Files: `src/server/lms/routes/assistant.ts`, `ai-client.ts` (the only Workers AI call; tests swap it for a mock), `ai-index.ts`, `data/ai.ts`; `tests/lms5.test.ts`.

### LMS 6: dashboard screens
- `/app/login/` (email + Turnstile), `/app/login/confirm/?t=` (one click to sign in), `/app/` (one page; shows the student,
  instructor or admin dashboard for the signed-in role). All `noindex`, not in the sitemap. Footers link to sign-in.
- Student: left = this week's assignments (submit text/file), quizzes (start, answer, submit; answers after marking), graded work,
  materials; centre (first on phones) = next live class with "Join live session" (15 min before) or "Meet link pending", upcoming
  classes, AI assistant, messages; right = profile (edit, photo), programme + weekly time + instructor, progress bars, payments with
  "Pay now" links, rate your instructor. Notification bell with unread count.
- Instructor: programmes and students (click for progress), attendance to record, schedule (today / next 7 days) with Meet-link entry
  and Completed / Student missed / Cancel, marking queue, set assignment/quiz/assessment, messages, profile, performance.
- Admin tabs: Overview, Users (create+invite, send link, suspend), Enrolments (assign instructor, status, fixed weekly time),
  Orders (confirm bank payment per part), Academics (needs attention, attendance to record), Finance, Instructors, Materials
  (add, approve, delete), Platform (activity, errors, audit log).
- Checked in Chrome through `wrangler dev` with a seeded local database (all three roles, phone and desktop).
- NOTE: with the `ai` binding in wrangler.jsonc, `npx wrangler dev` needs a Cloudflare login (Workers AI only runs remotely).
  Run `npx wrangler login` first, or remove the "ai" line in a local copy of the config for offline previews.
- Files: `app/app/*` (layout, page, ui, shared, student, instructor, admin, login, login/confirm), footer links in `app/page.tsx` and
  `app/site-parts.tsx`; `tests/lms6.test.ts`.

### LMS 7: security review and docs
- `tests/lms7.test.ts` reads EVERY route from the source and checks: signed-out requests get 401 (only the 3 sign-in routes are public),
  changes from other websites get 403 even when signed in, and admin/instructor/student routes refuse the other roles.
- `docs/lms/API.md` is generated from the routes (`node scripts/api-docs.mts`); a test fails if it is out of date.
- Gaps closed after the review: admin Courses tab (courses and lessons), file attach/replace for materials, instructors can add
  materials (pending approval). JSON body limit raised to 160 KB for long material texts.
- Privacy/Cookies text updated for platform data (accounts, coursework, messages, AI chats, uploads, `sma_session` cookie).
- Owner steps: `docs/upgrade/OWNER-CHECKLIST.md` section E. Limits: `docs/upgrade/LIMITS.md` (learning platform section).

### Known limits (honest list)
- Video and whiteboard are Google Meet's own (Meet cannot be embedded); the platform stores and protects the instructor's link.
- The AI assistant reads the "text" of materials, not PDF files, and the free Workers AI allowance is small (account-wide).
- Website traffic and SEO rankings are not in the admin dashboard (use Cloudflare Web Analytics / Google Search Console).
- Notifications are in-app + email; WhatsApp is not built (the spec lists it as a future option).
- Real-time updates are by reload/polling, not live push.
- Bank-transfer orders still get no automatic instalment reminders (admins record each part in Orders).

## Owner changes after Phase 9 (20 Nov 2026), these override earlier decisions and the spec
- The pillars band under the hero ("One teacher. One student." / "Flexible") is removed. (Spec acceptance 5's "band below the hero" no longer applies.)
- Cloud Engineering: ₦450,000 with NO crossed-out price (the ₦700,000 strike, "36% OFF" badge and "Save" chip are gone).
- No currency selector in any page header. Prices show in naira everywhere except checkout: the order summary uses the visitor's
  detected currency for the "≈" guide, and the payment step has a "Show amounts in" selector (`PayCurrency` in `app/currency.tsx`).
- Files: `lib/config.ts`, `app/page.tsx`, `app/site-parts.tsx`, `app/currency.tsx`, `app/programmes/[slug]/page.tsx`, `app/checkout/page.tsx`,
  `app/checkout/server-pay.tsx`, `db/seed-programmes.sql` (regenerated), tests updated (programmes, phase2, phase4).
- If you already ran `npm run db:migrate` with the old seed, refresh the programmes table:
  `npx wrangler d1 execute skillmountainacademy-db --remote --file db/seed-programmes.sql`

## Phase log (chat 2)
### Phase 1 verification
- `npm ci` OK. Build failed on a Next.js security advisory (16.4.2): upgraded `next` and `eslint-config-next` to 16.4.6 (same minor line). `npm audit`: 0 vulnerabilities.
- Lint error fixed in `app/page.tsx` (the removed-programme notice now sets state on the next tick).

### Phase 2: programme pages and the louder message
- Hero headline is now "Flexible, one-on-one learning." (fluid, bold, largest type on the site). "one-on-one" is `text-brand-orange`
  on an `bg-indigo` highlight, because orange on cream is only about 2.3:1 contrast; orange on indigo is about 6.9:1. No new colours.
- Full-width indigo pillars band directly under the hero (`PillarsBand`). The group pillar appears only if `FLAGS.GROUP_ENABLED`.
- The message is repeated in the page title, meta description, OG/Twitter descriptions, a strip at the top of every programme page and of checkout.
- "homeschool": the hero mention was removed; two remain (Our approach section, first FAQ).
- New `/programmes/<slug>/` pages (8): title, description, Course JSON-LD, price, duration, What you'll learn, View curriculum (new tab) +
  Download, Career Launch Package, trust lines with a Refunds link, Register buttons. Home cards link to them. Sitemap lists them.
- Curriculum: `scripts/curricula.mts` runs before every build (`prebuild`). It warns for each missing `public/curricula/<slug>.pdf`
  (button disabled with a short note) and reads PDF bookmarks as the "What you'll learn" headings (no bookmarks: the list in `lib/config.ts`).
- The 404 page's "404" numeral went from text-6xl to text-5xl so the hero stays the largest type everywhere.
- Files: `lib/config.ts` (FLAGS, MESSAGE, careerPackage), `lib/curricula.ts`, `lib/curricula.generated.json`, `lib/photos.ts`, `lib/format.ts`,
  `scripts/curricula.mts`, `app/site-parts.tsx`, `app/programmes/[slug]/page.tsx`, `app/page.tsx`, `app/components.tsx`, `app/layout.tsx`,
  `app/checkout/page.tsx`, `app/not-found.tsx`, `app/sitemap.ts`, `public/_redirects`, `tsconfig.json`, `package.json`, tests (`tests/helpers.ts`,
  `tests/phase2.test.ts`, `tests/fixtures/*.pdf`, `tests/site.test.ts`).

### Phase 3: Worker, D1, forms
- `wrangler.jsonc`: `main: src/worker.ts`, assets binding `ASSETS` with `run_worker_first: ["/api/*"]` (static pages still bypass the Worker),
  D1 `DB` (skillmountainacademy-db, `migrations/`), KV `KV` (cache only), one cron `0 5,17 * * *`, public `vars`, `define` for lib/config.ts.
- `migrations/0001_init.sql` (programmes, registrations, orders, instalments, payments, webhook_events, holds, children_enquiries,
  rate_limits; money in kobo) and `0002_seed_programmes.sql` (generated from config by `npm run db:seed-sql` → `db/seed-programmes.sql`).
- `src/server/repo.ts` is the only file with SQL (prepared statements; registration + order + instalments in one `batch()`).
- Endpoints: `GET /api/status`, `POST /api/register`, `POST /api/children-enquiry` (plus Phase 4-6 routes, see below).
  Each form: same-origin check, size limit, validation, Turnstile (`TURNSTILE_SECRET`), D1 rate limit (5 per 10 min per IP hash),
  Resend emails (learner + owner), mirror to the Google Sheet (`SHEET_WEBHOOK_URL`). IPs are stored only as salted hashes.
- Fails safely: no database, tables not migrated, or a missing secret → HTTP 503 with a plain "not set up yet, contact us" message.
- `docs/google-sheet-script.gs`: honours `notify:false` (no duplicate bank-transfer email when Resend sent one) and logs
  `payment` and `children` mirror posts to new tabs "Payments (from website)" and "Children enquiries".
- Tests: `tests/worker-harness.ts` bundles the Worker with esbuild and runs it in Miniflare (local D1/KV, every outbound call mocked);
  `tests/phase3.test.ts` (12 tests). `npm run lint` now also type-checks the Worker (`src/tsconfig.json`).
- New dev dependencies: `miniflare`, `esbuild` (same versions Wrangler uses), `pdfjs-dist` (Phase 2).

### Phase 4: currency
- `GET /api/geo` returns Cloudflare's `request.cf.country`, the currency (NG→NGN, US→USD, GB→GBP, eurozone→EUR, else USD) and cached rates.
  Browser fallback (time zone, then language) when the API is unreachable. Header currency switcher (home, programme pages, checkout)
  overrides detection and is remembered in localStorage.
- Rates: cron fetches `open.er-api.com/v6/latest/NGN` (free, no key; attribution link "Rates By Exchange Rate API" shown whenever a
  converted price is on screen; data updates daily) with the CC0 jsDelivr currency-api as fallback, into KV key `fx:NGN`.
  Last known rates are kept if both fail. Without rates only naira is shown (other currencies disabled in the switcher).
- `lib/pricing.ts` (shared by site and Worker): whole-unit rounding, "≈" for non-NGN, Intl.NumberFormat, converted instalments that add up exactly.
- Checkout states: "Paystack will charge ₦X in Nigerian naira (NGN)" plus the approximate converted amount. Orders store
  `display_currency`, `fx_rate` and `fx_at`.
- Files: `app/currency.tsx` (new), `lib/pricing.ts` (new), `src/server/routes/geo.ts`, `app/components.tsx` (Price uses Money; CloudBadges `dark`),
  `app/page.tsx`, `app/site-parts.tsx`, `app/programmes/[slug]/page.tsx`, `app/checkout/page.tsx`, `tests/phase4.test.ts`.

### Phase 5: timed price hold (dormant)
- Turns on only for a programme whose `timedPrice` is set in `lib/config.ts`. Today every programme has `timedPrice: null`, so the site
  makes no hold request at all.
- `GET /api/hold?p=<slug>` (src/server/routes/hold.ts): 48-minute hold, recorded in D1 (`holds`), signed HttpOnly `sma_hold_<slug>` cookie
  (HMAC-SHA256 with `HOLD_SIGNING_KEY`) plus a signed visitor cookie. No restart for 7 days, checked by visitor AND by IP hash.
  Checkout prices the order from config + a valid, unexpired hold only; the browser's amount is ignored.
- `app/hold.tsx`: countdown (screen readers hear only 30/10/5/1-minute milestones; minutes only with reduced motion), timed price
  with the regular price crossed out, "Offer ended. The regular price applies." Exit prompt once per visit (cursor leaves the top,
  back button, or returning to a hidden tab) with "Secure my seat" / "Not now"; focus is trapped, Escape closes, "Not now" after
  pressing back lets the visitor leave. No scarcity claims.
- Checked visually with a temporary timed price through `wrangler dev` (then reverted).
- Files: `app/hold.tsx` (new), `src/server/routes/hold.ts`, `app/programmes/[slug]/page.tsx`, `tests/phase5.test.ts`, `tests/worker-harness.ts` (config patching for tests).

### Phase 6: checkout, Paystack, instalments, groups
- Checkout asks `GET /api/status`. Server flow when the database + Turnstile (secret AND `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) are ready;
  card payments when `PAYSTACK_SECRET_KEY` is also set. Otherwise the ORIGINAL checkout (Google Form + Apps Script + Paystack popup)
  runs unchanged, with a "pay in 3 parts? message us on WhatsApp" line. So deploying before setup changes nothing for learners.
- Server flow: Pay in full / Pay in 3 parts (50/30/20) with amounts in naira plus the active currency, due dates (0/45/90 days;
  0/30/60 for 3-month training), "You pay ₦X now… Paystack charges in NGN", and "Live-session access is paused if a payment is more
  than 2 weeks late." The Worker computes the price (config + hold), saves everything, and initialises Paystack with the secret key;
  the learner is redirected to Paystack's page and back to `/checkout/?p=..&ref=..`, which confirms via `GET /api/order`.
- Webhook `POST /api/paystack/webhook`: HMAC-SHA512 signature check; payment recorded once per Paystack reference (D1 batch:
  payment + instalment + order status); amount and currency must match the part; welcome/receipt emails; mirror to the sheet.
- Instalments (cron, 06:00 Lagos): reminder 3 days before parts 2/3, signed `/api/pay?ref=..&t=..` link (redirects to a fresh
  Paystack payment) on the due date, overdue marked the day after, owner digest of parts more than 14 days late. Max 20 emails per run
  (free-plan limits). Bank-transfer orders are still confirmed by hand in the sheet, so they get no automatic reminders.
- Groups: `FLAGS.GROUP_ENABLED` (off) AND a programme `groupPrice` (all null). When on: lead adds 1-2 friends (name, email); one price;
  each friend gets their own registration row (role group_member, lead_id) and a welcome email.
- Home page shows a notice for `?notice=pay-unavailable` (pay link clicked before Paystack is set up).
- Files: `app/checkout/server-pay.tsx`, `app/turnstile.tsx` (new), `app/checkout/page.tsx`, `app/page.tsx`, `lib/config.ts` (turnstileSiteKey),
  `src/server/routes/payments.ts`, `src/server/cron.ts`, `src/server/repo.ts`, `wrangler.jsonc` (define), `tests/phase6.test.ts`.

### Phase 7: children's package
- New `/children/` page: parent account, consent, customised curriculum, one-on-one, flexible days. Parent enquiry form (name, email,
  phone, child's age 4-17, programme interest, optional message, consent, Turnstile) → `POST /api/children-enquiry` → D1 + email to
  the owner + confirmation to the parent + "Children enquiries" sheet tab. Without the backend it shows WhatsApp/email buttons.
- `FLAGS.CHILDREN_ENABLED` (off) plus `CHILDREN.programmes` (empty) in `lib/config.ts` gate a self-serve section; nothing shows today.
  Interpretation: the /children page and enquiry form are always visible (spec Phase 7.1-7.2); only self-serve checkout is behind the flag.
  The child checkout itself will be built when you supply ages, programmes and prices.
- New "Parents and children" card (6th) in "Who it's for" links to /children/. Sitemap lists /children/.
- Files: `app/children/page.tsx`, `app/children/enquiry-form.tsx` (new), `lib/config.ts` (CHILDREN, AUDIENCE links), `app/page.tsx`,
  `app/sitemap.ts`, `src/server/routes/children.ts`, `tests/phase7.test.ts`.

### Phase 8: trust and content
- `data/reviews.json` (Reviews section appears at 3+ valid entries) and `data/mentors.json` (Mentors section appears at 1+). Both empty:
  no invented reviews or mentors. Format in `data/README.md`; validation in `lib/content-rules.ts` (bad entries skipped, unsafe file names dropped).
- FAQ: new answers for AWS and Azure, the internship (no employment promise), instalments, certificates, the children's package and
  other currencies; the group-classes answer appears only when `GROUP_ENABLED` is on.
- Structured data: EducationalOrganization on every page (layout), FAQPage on the home page, Course on programme pages.
- Descriptive alt text on programme photos (hero slides, cards, checkout). Home footer now shows the contact email and phone.
- Legal text updated to match what the site now does (please have your lawyer review): Privacy (Resend, Cloudflare database and
  Turnstile, hashed IPs, instalment/currency/group/children data), Cookies (session/local storage items and the two hold cookies,
  which only exist when a timed offer is on), Terms v2026-11a (3-part payments and the 2-week pause; time-limited offers).
- Files: `data/*.json`, `data/README.md`, `lib/content.ts`, `lib/content-rules.ts` (new), `lib/config.ts` (FAQ, FAQ_GROUP, faqList),
  `app/page.tsx`, `app/layout.tsx`, `app/checkout/page.tsx`, `lib/legal.ts`, `lib/terms.ts`, `tests/phase8.test.ts`.

### Phase 9: quality
- Lighthouse mobile (local `wrangler dev`, simulated slow 4G): programme pages 90-94, checkout 95, children 92-94, terms 96-99 for
  Performance; 96-100 for Accessibility, Best Practices and SEO everywhere. Home page Performance 61-80 (original site, same test: 66-70),
  limited by the existing full-screen intro video; options for you in `docs/upgrade/LIMITS.md`.
- Home improvements that keep the same look: hero fades up with CSS only (no wait for JavaScript), first slide image high priority,
  intro video poster = its own first frame (`public/sma-intro-poster.webp`, cached a day in `_headers`). Checkout `<main id="main">` fixed
  (the skip link had no target).
- End-to-end browser run (Puppeteer + `wrangler dev` + local D1) of the new checkout: found and fixed a display bug where converted
  parts did not add up to the converted total (155+93+62 vs 311). Regression test added.
- Route-by-route free-plan review: `docs/upgrade/LIMITS.md`. Bundle ~60 KiB; cron capped at 20 learner emails per run.
- Colour diff vs the original upload: `app/globals.css`, both logos, `app/icon.png` and `public/og-share.jpg` are byte-identical; every hex
  value in the code is a Phase 0 brand value; new files use Tailwind tokens only (a test enforces this).
- Tests: 74 in 11 files (`npm test`), Worker integration tests in Miniflare.

## Acceptance tests (SPEC.md)
| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | IELTS and Data Analytics gone; old links redirect home | PASS | tests/site.test.ts; built HTML scan |
| 2 | All eight programmes live with Register; no "Coming soon" | PASS | built HTML scan; tests/programmes.test.ts |
| 3 | Cloud track: 3 programmes, prices, levels, AWS/Azure badges, comparison | PASS | tests/programmes.test.ts |
| 4 | Durations as training + internship; Digital Marketing 3 + 3 | PASS | tests/programmes.test.ts; built HTML |
| 5 | Hero headline largest text; band below it | PASS | tests/phase2.test.ts (font-size comparison across all pages) |
| 6 | Currency switching NGN/USD/GBP/EUR; checkout states the charged amount | PASS in tests and local browser run; live check needs your deploy | tests/phase4.test.ts; e2e |
| 7 | Checkout price = server calculation; tampering changes nothing | PASS | tests/phase5.test.ts, phase6.test.ts |
| 8 | Instalments add up exactly; webhooks idempotent | PASS | tests/phase6.test.ts, phase4.test.ts |
| 9 | Curriculum buttons open the right PDF in a new tab | PASS for the code; NEEDS YOUR STEP (upload the 8 PDFs) | tests/phase2.test.ts |
| 10 | Group and children features invisible while flags off | PASS | tests/phase6.test.ts, phase7.test.ts, phase8.test.ts |
| 11 | Forms reject submissions without a valid Turnstile token | PASS (Worker); live needs your Turnstile keys | tests/phase3.test.ts |
| 12 | Colour-token diff empty | PASS | tests/site.test.ts; byte comparison with the original upload |

## How to continue in a new chat
1. Make sure package installs are allowed in your network settings, then open a NEW chat.
2. Upload this ZIP and paste:
   "Continue the SMA website upgrade. Read docs/upgrade/HANDOVER.md and docs/upgrade/SPEC.md, run npm ci, npm run build, npm run lint and npm test, then start the next phase in the Status table."

## Owner decisions (these override the spec)
1. BRAND COLOURS: never change or add colours. The spec's mentions of "sage green" and "peach" are wrong. The only colours are
   the existing ones in `app/globals.css` (cream #fcf9db, paper #fffdf0, navy #14296b, indigo #1e0e6f, plum #5b2270,
   red #c8233a, orange #f7892b, ink #16163a), the existing gradients, and the few existing hex values listed in
   `colour-snapshot-phase0.txt`. That file's colour lines and hashes must stay identical after every phase.
2. Hero highlight: "one-on-one" uses the existing BRAND ORANGE (`text-brand-orange`, #f7892b). It is the largest type on the site,
   so it counts as large text. Keep it bold. If contrast on cream needs help, use a heavier weight or the existing indigo
   section background, never a new colour.
3. Cloud Engineering: ₦450,000 and KEEP ₦700,000 crossed out (36% OFF).
4. Cybersecurity: ₦650,000, NO crossed-out price (remove the ₦850,000), 4 months training + 2 months internship.
5. Testing: build and test after every phase (`npm ci`, `npm run build`, plus the tests you add).

## Phase 0 audit results
| Item | What exists today |
|---|---|
| Worker entry | None. Assets-only Worker (`wrangler.jsonc`). `src/worker.ts.example` is an unused placeholder. |
| D1 / KV / Cron | None (D1 block commented out in `wrangler.jsonc`). |
| Turnstile | None. The checkout has a hidden honeypot field only. |
| Email | No Resend. Emails go through Gmail by Google Apps Script (`docs/google-sheet-script.gs`, MailApp). |
| Paystack | Inline popup in the browser (`app/checkout/page.tsx`) with the public key. The amount is set in the browser, but the Apps Script verifies with the secret key and checks amount >= its own FEES list. Optional webhook path in the script. |
| Forms + Google Sheet | Registration posts to a Google Form (5 fields) and to the Apps Script `apply` action ("Applications" tab). Mailing list posts to `subscribe` ("Mailing list" tab). Bank-transfer flow: admin types PAID in the sheet. |
| Currency | No detection. Fixed `usdRate: 1400` in `lib/config.ts`. Hardcoded "≈ US$" labels on cards, hero slides, goal picker and checkout. |
| Timer / price hold | None. |
| Instalments | None. |
| Curriculum | `CURRICULUM_LINKS` in `lib/config.ts` all empty, so the modal shows "coming soon". No `/curricula/*.pdf` files. |
| Reviews | `REVIEW_SHOTS` (screenshot images), empty, so the section is hidden. No mentors section. |
| Redirects | `public/_redirects` sends old IELTS paths home. `/checkout/?p=ielts` is still a live page. |
| Programme pages | None. Programmes only appear as cards on the home page. |
| "Coming soon" | UI/UX, Data Analytics and Web Development cards, and the "Coming soon" text in `app/page.tsx`. |
| Homeschool wording | Hero, "Our approach" section and FAQ (more than two mentions). |
| Meta | Keywords tag present. OG image alt says "University". No Abuja in the description. |

Live site check (19 Nov 2026): it matches these files. Cybersecurity live: ₦650,000, was ₦850,000, no duration shown,
blurb and learn list as in `lib/config.ts`.

## Phase 1 results (cleanup and restructure)
- `lib/config.ts`: programmes now use the spec's shape (slug, price, was, trainingMonths, internshipMonths, level, audience,
  track, timedPrice null, fastTrack false, curriculum, groupPrice null). Eight live programmes: graphics, uiux, webdev,
  marketing, cybersecurity, cloud, devops, cloud-devops. IELTS and Data Analytics removed. The `live` flag is gone (all are live).
  Helpers: `findProgramme` (old slugs `cyber` and `web` still work), `duration`, `finalPrice`, `FAST_TRACK` (off), `PAY_PLAN`.
  Removed `usdRate` and the `DURATIONS` form options. Goal picker covers all eight programmes.
- Home page: no "Coming soon" anywhere, no "≈ US$" labels, durations read "X months training + Y months internship",
  AWS/Azure text badges on Cloud track cards, a new "Which one is right for me?" Cloud track comparison under the programme
  grid, and a dismissible notice when a visitor arrives from an old IELTS or Data Analytics link (`/?notice=removed`).
- Checkout: `/checkout/?p=ielts` (and `data`) sends the visitor to `/?notice=removed`. The "Preferred programme duration"
  question is removed; the programme's real duration is sent to the sheet in the same `duration` field. No dollar labels.
- Meta: keywords tag removed, Abuja added to the description, OG image alt now says "Academy".
- `public/_redirects`: IELTS and Data Analytics paths go to `/?notice=removed` (301).
- `docs/google-sheet-script.gs`: FEES and CURRICULUM now list the eight programmes by their exact names.
- `assets/photos/photo-ielts.webp` deleted. `photo-data.webp` is now the Cloud & DevOps photo.
- Tests: `tests/programmes.test.ts`, `tests/site.test.ts`, run with `npm test` (Node 22 built-in runner, no new packages).
  `site.test.ts` includes the colour-snapshot check: globals.css and logo hashes identical, and the same hex values in the
  same files as Phase 0 (line numbers are allowed to move, because editing a file shifts them).
- Colour diff: empty. `app/globals.css` was not touched.

## Owner to-do
The complete, ordered list with exact settings and commands is `docs/upgrade/OWNER-CHECKLIST.md`. Items kept below for history.

### Running list from earlier phases
Phase 2 adds: 7. Put the eight curriculum PDFs in `public/curricula/` named `graphics.pdf`, `uiux.pdf`, `webdev.pdf`, `marketing.pdf`,
`cybersecurity.pdf`, `cloud.pdf`, `devops.pdf`, `cloud-devops.pdf`. Add PDF bookmarks for the module headings if you want them shown.

Phase 3 adds (details and exact commands are in the final checklist): create D1 + KV and paste their ids into `wrangler.jsonc`,
run `npm run db:migrate`, set the Worker secrets, redeploy the updated Apps Script.

### From Phase 1
1. Copy the updated `docs/google-sheet-script.gs` FEES and CURRICULUM blocks into the live Apps Script and deploy a New
   version. Until then, applications for UI/UX, Web Development and Cloud & DevOps are silently dropped by the script.
2. Confirm the Web Development price (₦500,000 is a placeholder).
3. Review the new blurbs and "What you'll learn" lists for UI/UX, Web Development and Cloud & DevOps (written by Claude).
4. Level text for the non-cloud programmes is set to "Beginner to advanced". Change it in `lib/config.ts` if needed.
5. DevOps went from ₦450,000 to ₦500,000, as the spec says.
6. The share image itself (`public/og-share.jpg`) still says "University" in the picture. Only its alt text was fixed.

## Files not in the original upload (not needed)
`assets/photos/photo-megaphone.webp` (unused) and `public/reviews/README.txt`.

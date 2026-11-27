# Skill Mountain Academy — Expansion Stage B Report
## Database-backed programme catalogue, six schools and dual tuition structure

Date: 27 November 2026 · Status: implemented locally, ready for owner review · Stage C has not been started.

The 2027 catalogue now lives in the database: 21 unpublished drafts in six schools, each with a separate international USD price and local NGN price. The public website still shows the same nine programmes, and nothing in the build output changed. Only the owner, or a Super Administrator the owner authorises, can publish. That person also has to have entered their authenticator code in the current session.

---

## 1. Files changed

**New**

| File | Purpose |
|---|---|
| `migrations/0011_catalogue.sql` | Additive catalogue migration (section 2) |
| `lib/catalogue-2027.ts` | The owner's 21-programme / 6-school table. Reference data only: it seeded 0011 and is used by tests, never by the site |
| `lib/catalogue-types.ts` | Shared snapshot types |
| `lib/catalogue.published.ts` | Build-time snapshot of the published catalogue. Committed as `null`, which means the site uses the seed list |
| `scripts/catalogue-export.mts` | Prebuild export: `GET /api/catalogue`, strict validation, writes the snapshot; it never fails the build |
| `scripts/sheet-fees.mts` | `npm run sheet:fees` prints the Google Sheet `FEES` block from the published catalogue; `-- --check` compares |
| `src/server/catalogue.ts` | Published-catalogue reader with fallback, server price resolution, publication rules, reserved slugs |
| `src/server/lms/data/catalogue.ts` | Catalogue SQL (data layer) |
| `src/server/lms/routes/catalogue.ts` | Admin and owner catalogue routes |
| `app/app/catalogue-admin.tsx` | Admin › Programmes › Catalogue |
| `tests/stageB-catalogue.test.ts` | 14 Stage B tests |
| `docs/EXPANSION_STAGE_B_REPORT.md` | This report |

**Modified**

| Area | Files | Change |
|---|---|---|
| Site library | `lib/config.ts` | `PROGRAMMES` is now the published snapshot when one exists, otherwise `SEED_PROGRAMMES` (the controlled fallback). Adds `ALLOWED_TONES`/`safeTone`, `programmeName()` (resolves retired names), `SCHOOLS`. Retired programmes join `REMOVED_SLUGS`; the programme-count words go up to 25 |
| | `lib/photos.ts` | `photoFor` / `focusFor` fall back to the Academy photo, so a new programme cannot break the build |
| | `lib/pricing.ts` | `internationalAmount()`: USD, plus GBP and EUR via the cross rate of the existing approved rates; never NGN |
| Site pages | `app/components.tsx`, `app/brand.tsx`, `app/page.tsx`, `app/checkout/flow.tsx`, `app/programmes/[slug]/page.tsx` | Use the photo fallback |
| Admin | `app/app/admin.tsx` | "Catalogue" segment on the Programmes tab, shown only to groups that can read the catalogue |
| Worker | `src/worker.ts` | Public `GET /api/catalogue` |
| | `src/server/routes/geo.ts`, `register.ts` | Quote and registration are priced from the database's published row (bundled list only on a database older than 0011) |
| | `src/server/routes/payments.ts`, `src/server/cron.ts` | Programme names come from `programmeName()`, which also resolves retired names (R-05) |
| LMS | `src/server/lms/permissions.ts` | New `catalogue` area and 8 route entries |
| | `src/server/lms/index.ts` | Registers the routes |
| | `accounts.ts`, `routes/teaching.ts`, `data/enrolments.ts`, `routes/engagement.ts` | Duration snapshot written on new enrolments and used for the student's phase |
| Schema | `src/server/schema-version.ts` | `EXPECTED_MIGRATION` is now `0011_catalogue.sql` |
| DB tooling | `scripts/db/rollback.mts` | COMPAT entry for 0011, with a rollback check |
| | `classification.mts`, `anonymise.mts` | New tables and columns |
| | `db/schema.expected.json` | Regenerated |
| | `db/migration-reviews.json` | 0011 review; the owner decision is still open |
| Docs and config | `docs/lms/API.md` | Regenerated |
| | `docs/google-sheet-script.gs` | Comment only |
| | `package.json` | Prebuild export; `sheet:fees` |

**Tests adjusted.** Only intent-preserving changes for the new migration:
- `db-gate`, `db-preflight`, `stage3b-gates`: the hypothetical "future" migration is renamed from 0011 to 0012.
- `db-preflight`, `db-recovery`, `stage3c-staging`: the pending list and rehearsal now cover 0010 and 0011. They assert that only `programmes` and `enrolments` change, with the same row counts, and that the new rollback check exists.
- `phase5`, `phase6`: the patched timed and group prices are also set in the database, because registration now prices from it.
- `site`: `lib/catalogue-2027.ts` is excluded from the "no Data Analytics" rule (see section 12).

## 2. Database: migration 0011 (additive only)

**New table: `schools`** (6 rows)
- Columns: slug, code, name, tab label, tone (an existing card gradient), position, timestamps.

**New columns on `programmes`**
- The table stays the **live** catalogue.
- Added columns:
  - school;
  - tag, tone, short description (`blurb`), full `description`;
  - learning outcomes and curriculum (`learn_json`, `curriculum_json`), `final_project`;
  - audience, track, `full_payment_only`;
  - `price_usd_cents`, `status` (published / paused / retired);
  - `published_at`, `position`, `created_at`, `updated_by`;
  - `retired_at`, `retired_by`, `retired_reason`.
- The existing `price_kobo` stays the local NGN tuition. It is not reinterpreted.

**New table: `programme_drafts`**
- Holds unpublished edits and new programmes, one per slug.
- It is a separate table because a live programme and its 2027 draft must coexist under the same slug.
- Publishing copies the draft into `programmes` in one batch and removes the draft. The full before and after values are kept in the audit log.

**New columns on `enrolments`**
- `training_months` and `internship_months`, filled for existing enrolments from the current durations.

**Data writes in 0011**
- The 9 live rows get their current website text and order in the **new** columns.
- Cloud's stale crossed-out price (`was_kobo` ₦700,000 from 0002, never shown on the live site) is cleared. This is pending owner confirmation.
- No live price, duration or name is rewritten (a test enforces this).
- Orders, payments, instalments and registrations are not touched.

**Rollback guidance**
- COMPAT marks 0011 as "check". The check `catalogue_published_changes` counts publications, pauses and retirements.
- With none, rolling back to a 0010 Worker is safe, because the older Worker prices from its bundled list, which equals the database.
- After the first catalogue publication, rolling back is unsafe.

## 3. Catalogue

21 programmes in 6 schools. All are `programme_drafts` rows, unpublished.

| School | Programmes |
|---|---|
| 01 AI & Intelligent Systems | 4 |
| 02 Software Engineering & Computing | 3 |
| 03 Cloud, DevOps & Digital Infrastructure | 3 |
| 04 Data Science & Analytics | 2 |
| 05 Creative Technology & Digital Media | 5 |
| 06 Business, Management & Remote Operations | 4 |

Titles, USD prices and training and internship durations match the brief exactly. A test checks them against an independently typed copy of the owner's table. There is no 22nd programme.

**Slug mapping**

- **Reused (the 2027 version replaces the live one on publication):** `ai-automation`, `webdev`, `cloud`, `devops`, `cybersecurity`, `graphics`, `uiux`, `marketing`.
- **New:**

  | # | Programme | Slug |
  |---|---|---|
  | 2 | AI Engineering & LLM Application Development | `ai-engineering` |
  | 3 | AI Chatbot & Conversational AI Development | `ai-chatbot` |
  | 4 | AI Data Annotation & Model Evaluation | `ai-data-annotation` |
  | 6 | Python Programming & Applied Software Development | `python` |
  | 7 | Software Testing & Quality Assurance Engineering | `software-testing` |
  | 11 | Data Analytics & Business Intelligence | `data-analytics-bi` |
  | 12 | Data Science & Machine Learning | `data-science-ml` |
  | 15 | Product Management | `product-management` |
  | 16 | AI Video Production & Professional Video Editing | `ai-video` |
  | 18 | Virtual Assistance & Remote Business Operations | `virtual-assistance` |
  | 19 | Project Management | `project-management` |
  | 20 | Business Analysis | `business-analysis` |
  | 21 | Technical Writing & Documentation | `technical-writing` |

- **Reserved (never reused):** `data`, `data-analytics`, `ielts`, `cyber`, `web`, `cloud-devops`.
- `cloud-devops` stays published and unchanged until the owner decides (section 12).

## 4. Pricing

| Field | Unit | Status |
|---|---|---|
| `price_usd_cents` | Integer US cents | Separate field; seeded from the brief |
| `price_kobo` | Integer kobo, local NGN tuition | Separate field; unset on all 21 drafts |

- Nothing converts USD to NGN.
- Publishing is refused while the NGN price is missing, even for the owner (tested).
- **Missing NGN tuition: all 21 programmes.** This includes the eight that reuse a live slug: their 2026 live NGN price stays in force until the owner sets and publishes the 2027 one. It is not copied over.
- **GBP and EUR:** `internationalAmount()` uses the existing approved rates feed (the KV rates, refreshed at 05:00 and 17:00 UTC, which are NGN-based) as a cross rate, with the existing whole-unit rounding. Without a rate it shows nothing.
  - Today this is used only for the admin preview.
  - Showing international prices to visitors by location, and charging them, is the later pricing stage.
  - Also left to that stage: `register.ts` still records a browser-sent display currency on the order (R-03). Charging stays NGN-only and server-computed.

## 5. Public website

- Programme data now comes from the database through a safe build-time export (`prebuild` → `scripts/catalogue-export.mts`).
  - It writes only published, validated data.
  - Card colours are limited to existing gradient classes.
  - If the export cannot reach the database, it keeps the seed. Today production has no `/api/catalogue` yet, so the seed is used.
- `lib/config.ts` remains only as that controlled fallback and is labelled as such.
- **Unchanged:** the build before and after has the same 31 pages, and 0 pages have different visible text. Design, the nine programmes, prices and links are unchanged.
- Schools appear through the existing catalogue tabs, using the school's tab label, once programmes with a school are published. The current nine have no school, so the tabs are unchanged.
- After a publication, the website updates on the next normal Git → GitHub → Cloudflare build. Registration and quotes use the database at once.

## 6. Admin dashboard (Programmes › Catalogue)

Staff can:
- see the schools, with programmes grouped under each, plus the current programmes that have no school;
- see counts and the red flags "NGN price missing" and "USD price missing";
- create a draft;
- edit the title, school, level, durations, USD and NGN tuition (typed in whole units and sent as minor units), short and full description, outcomes, curriculum, final project, audience and full-payment-only;
- reorder programmes;
- preview a programme in the catalogue card style;
- see status badges, and who last changed a programme and when.

The owner and authorised delegates also get **Publish / Resume**, **Pause** and **Retire** (retire needs a reason). The owner gets the delegation checkbox.

Checked in a local browser: the list and a programme's detail view both render with no errors.

## 7. Security

**Permission table:** 8 new routes, all registered under default-deny.

| Route | Area |
|---|---|
| `GET /api/app/admin/catalogue` | catalogue |
| `POST /api/app/admin/catalogue/programmes` | catalogue |
| `PATCH /api/app/admin/catalogue/programmes/:slug` | catalogue |
| `PUT /api/app/admin/catalogue/order` | catalogue |
| `POST /api/app/admin/catalogue/programmes/:slug/publish` | catalogue, plus the publisher rule below |
| `POST /api/app/admin/catalogue/programmes/:slug/pause` | catalogue, plus the publisher rule below |
| `POST /api/app/admin/catalogue/programmes/:slug/retire` | catalogue, plus the publisher rule below |
| `PUT /api/app/owner/catalogue-policy` | owner |

**Who can do what**
- The `catalogue` area is open to the Academic group (Head of Programmes) for reading and writing, to Reporting for reading only, and to Super Administrators and unassigned legacy administrators. Admissions, Finance, Faculty and Support have no access.
- Students and instructors cannot reach any of these routes.

**Publisher rule:** publish, pause and retire need the **owner**, or a **Super Administrator** while the owner's `superMayPublish` policy is on (off by default). In both cases the session must have passed the authenticator code. Live tuition can only change through publish.

**Validation and CSRF**
- Every input is validated on the server: slug pattern, reserved slugs, school must exist, integer minor-unit bounds, month ranges, text lengths.
- A currency or country sent by the browser is ignored.
- The existing same-origin (CSRF) check applies.

**Audit log**

| Event | Recorded as |
|---|---|
| Creation | `catalogue.create` |
| Edit | `catalogue.edit`, with field changes |
| Price change | `catalogue.price_change`, with previous and new values, for drafts and on publication |
| School change | `catalogue.school_change` |
| Publish | `catalogue.publish`, with before/after values; also used for resume |
| Unpublish | `catalogue.unpublish` |
| Retirement | `catalogue.retire` |
| Reorder | `catalogue.reorder` |
| Refused attempt | `catalogue.refused` |
| Delegation change | `owner.catalogue_policy` |

The public `/api/catalogue` returns published rows only, with no internal fields. Retired programmes appear only as their names.

## 8. Historical compatibility

- **Orders and amounts:** orders keep their stored amounts. A test publishes a new price and duration for `webdev` and shows the existing order is unchanged.
- **Enrolment durations:** existing enrolments keep their durations through the 0011 snapshot. New enrolments record theirs, best effort: on an older database nothing is written and the enrolment uses the programme's current durations, as before. The student's phase uses the snapshot.
- **Retired programmes:** they are never deleted. Their names still resolve through `/api/catalogue` (`retired`) and `programmeName()`, and their addresses are never reused.
- **`cloud-devops`:** untouched and still published.
- **Removed data slugs:** `data` and `data-analytics` are reserved and cannot be reused.

## 9. Google Sheet

- `docs/google-sheet-script.gs` keeps its own `FEES` list, keyed by programme **name**. The sheet uses it for application checks, its own emails and its payment checks.
- The Worker never relies on it (it sends `notify=false` and prices from the database).
- The Apps Script is deployed by the owner in Google, so Stage B does not change or disable it.
- Added `npm run sheet:fees`, which prints the block from the published catalogue, and `-- --check`. The existing test still keeps `FEES` equal to the published list.
- **Follow-up action:** when a programme is published with a new name or price, paste the generated block into the Apps Script before (or right after) the next build. Otherwise the sheet's checks will flag the renamed programmes.

## 10. Tests (commands actually run, 27 Nov 2026)

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx tsc --noEmit -p src/tsconfig.json` | PASS |
| `npx eslint` | PASS (0 problems) |
| `npm run db:check` | PASS, 11 files. Notes: the standing 0007 note, and the new 0011 owner-decision note |
| `node --test` (35 files, run in two halves to fit the time limit) | **319 of 320 pass**: 134/134 and 185/186. This includes the 14 new Stage B tests |
| `npm run build` | PASS: catalogue export fell back to the seed, as expected offline; 33 static routes |
| Before/after build text comparison | Same 31 HTML pages, 0 with different visible text |
| `npm run security:csp` | PASS: 30 pages, report mode |
| `npm run security:secrets` | PASS |
| `npm audit` | 0 vulnerabilities |
| `npm run sheet:fees -- --check` | PASS |

**The one failure is pre-existing, not from Stage B:** `3B.1: staging configuration …` expects `account_id is not pinned`. It has been failing since the staging IDs were added on 22 November, and it belongs to the security workstream.

## 11. Migration safety

- 0011 was applied only to local test databases (Miniflare) and to an isolated local D1 (`--persist-to /tmp/sma-ui`) for the browser check.
- It was **not** staging-rehearsed on Cloudflare.
- **No production migration, deployment, DNS, secret or production data change took place.** 0010 and 0011 were not applied anywhere remote.
- `db/migration-reviews.json` marks 0011 as needing the owner's decision before production. The preflight therefore fails on purpose until the owner approves.

## 12. Owner decisions needed

1. Local NGN tuition for each of the 21 programmes. All are unset, and none can be published until set.
2. Cloud Engineering's crossed-out ₦700,000 in the database: confirm clearing it (the live site shows none).
3. Confirm the permanent enrolment duration snapshot: existing students keep the durations they started with.
4. `cloud-devops`: keep it open for new admissions, pause it, or retire it.
5. The new slugs listed in section 3, especially `data-analytics-bi` and `data-science-ml`.
6. When "Data Analytics & Business Intelligence" is published, the site content rule that bans "Data Analytics" (from the removed programme) must be relaxed.
7. GBP and EUR policy: the source, the refresh frequency, and whether the cross rate of the current NGN-based feed with whole-unit rounding is acceptable.
8. Instalment and full-payment-only rules for each new programme. They are currently not set, except `ai-automation`, which keeps full payment only.
9. Cloud and DevOps curriculum wording, where the 2027 catalogue and the current website differ.
10. Publication date, and how pending or unpaid orders are handled at switch-over.
11. Whether Super Administrators should be allowed to publish. The setting is off.

## 13. Stage B acceptance: gaps

- **Curriculum and final-project text.** The fields exist, are editable and are shown in the preview. Only programme 1's introduction from the owner's catalogue text was seeded: the per-programme curriculum bullets and final projects were not in this session's files, so I left them empty rather than retype them from memory. Short descriptions, levels and learning outcomes are also empty for the 20 others. Staff enter them in the editor, and publishing is blocked until the required ones are present.
- **"Each programme belongs to exactly one school":** true for all 21 drafts. The nine current live programmes, including `cloud-devops`, have no school until their 2027 versions are published or the owner decides, so the public page stays unchanged.
- **Location-based display and charging** of international prices is left to the later pricing stage, as the brief says (R-03 noted).
- **Staging rehearsal** on Cloudflare was not run. It needs the Stage 3D staging items that are still outstanding.

Stage B stops here for owner review.

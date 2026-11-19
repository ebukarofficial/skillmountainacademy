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
| 5 to 9 | see the phase log below |

Every phase must end with `npm run build`, `npm run lint` and `npm test` all passing.

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

## Owner to-do (running list)
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

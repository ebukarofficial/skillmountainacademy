# Upgrade handover: read this first

This ZIP is the live skillmountainacademy.com project, upgraded by Claude following `docs/upgrade/SPEC.md`.
Phase 0 (audit) and Phase 1 (cleanup and restructure) are done. Phases 2 to 9 have not started yet.

**Phase 1 was NOT build-tested.** Package installs were blocked in that chat, so `npm ci` and `npm run build` could not run.
The edited files were type-checked against stand-in React/Next types and `npm test` passes (13 tests). Before Phase 2, the next
chat must run `npm ci`, `npm run build`, `npm run lint` and `npm test`, and fix anything they report.

## How to continue in a new chat
1. Make sure package installs are allowed in your network settings, then open a NEW chat.
2. Upload this ZIP and paste:
   "Continue the SMA website upgrade. Read docs/upgrade/HANDOVER.md and docs/upgrade/SPEC.md, run npm ci and npm run build, then start Phase 1."

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

## Owner to-do after Phase 1 (before deploying it)
1. Copy the updated `docs/google-sheet-script.gs` FEES and CURRICULUM blocks into the live Apps Script and deploy a New
   version. Until then, applications for UI/UX, Web Development and Cloud & DevOps are silently dropped by the script.
2. Confirm the Web Development price (₦500,000 is a placeholder).
3. Review the new blurbs and "What you'll learn" lists for UI/UX, Web Development and Cloud & DevOps (written by Claude).
4. Level text for the non-cloud programmes is set to "Beginner to advanced". Change it in `lib/config.ts` if needed.
5. DevOps went from ₦450,000 to ₦500,000, as the spec says.
6. The share image itself (`public/og-share.jpg`) still says "University" in the picture. Only its alt text was fixed.

## Files not in the original upload (not needed)
`assets/photos/photo-megaphone.webp` (unused) and `public/reviews/README.txt`.

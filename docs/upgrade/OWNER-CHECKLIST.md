# Owner checklist: everything only you can do, in order

Work top to bottom. Until a step is done, the site keeps working safely: the original checkout, Google Form and Apps Script
flow carry on, and any new feature that is not set up shows a clear "contact us" message instead of breaking.

You need: a computer with Node 22, this project cloned from GitHub, and one login to Cloudflare from the terminal:
```
npm ci
npx wrangler login
```

## A. Before you push this code

1. **Google Apps Script (do this first).** Open the Google Sheet > Extensions > Apps Script. Paste the whole of
   `docs/google-sheet-script.gs` over the old code. Then Deploy > Manage deployments > pencil (Edit) > Version: **New version** > Deploy.
   The web-app address stays the same. (Without this, applications for UI/UX, Web Development and Cloud & DevOps are dropped by
   the old script, and bank-transfer learners may get two emails.)

2. **Create the D1 database.**
   ```
   npx wrangler d1 create skillmountainacademy-db
   ```
   Copy the `database_id` it prints into `wrangler.jsonc`, inside `d1_databases`, so the line reads:
   `{ "binding": "DB", "database_name": "skillmountainacademy-db", "database_id": "PASTE-ID-HERE", "migrations_dir": "migrations" }`

3. **Create the tables.**
   ```
   npm run db:migrate
   ```
   (This runs `wrangler d1 migrations apply skillmountainacademy-db --remote`. Answer **y**. It creates the tables and copies the
   eight programmes in.) Later, after changing prices in `lib/config.ts`:
   `npm run db:seed-sql` then `npx wrangler d1 execute skillmountainacademy-db --remote --file db/seed-programmes.sql`

4. **Create the KV namespace (exchange-rate cache).**
   ```
   npx wrangler kv namespace create skillmountainacademy-cache
   ```
   Copy the `id` into `wrangler.jsonc`: `"kv_namespaces": [{ "binding": "KV", "id": "PASTE-ID-HERE" }]`

5. **Cloudflare Turnstile (form protection).** Cloudflare dashboard > **Turnstile** > **Add widget**:
   - Widget name: `SMA forms`
   - Hostnames: `skillmountainacademy.com` and `www.skillmountainacademy.com` (add your `*.workers.dev` address too if you test there)
   - Widget mode: **Managed**. Pre-clearance: **No**.
   - Copy the **Site key** to: Workers & Pages > `skillmountainacademy` > Settings > Build > Variables and secrets > Add,
     name `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (a build variable, because the website reads it at build time).
   - Copy the **Secret key** into the Worker:
     ```
     npx wrangler secret put TURNSTILE_SECRET
     ```

6. **Resend (emails).** Sign up at resend.com.
   - Domains > **Add domain** > `skillmountainacademy.com`.
   - Add **exactly** the records Resend shows, in Cloudflare > DNS > Records, all **DNS only** (grey cloud). Usually: an `MX` record
     named `send` (priority 10), a `TXT` record named `send` (SPF), and a `TXT` record named `resend._domainkey` (DKIM). Newer
     Resend domains may show CNAME records instead: copy whatever it lists. Type only `send`, not `send.skillmountainacademy.com`.
   - Do **not** change your existing root `MX`, SPF `TXT` or `_dmarc` records: they run the admission@ mailbox.
   - Click **Verify DNS records** and wait until it says Verified (often 15 minutes).
   - API Keys > **Create API key**: permission **Sending access**, domain `skillmountainacademy.com`. Then:
     ```
     npx wrangler secret put RESEND_API_KEY
     ```
   - The sender is already set in `wrangler.jsonc`: `Skill Mountain Academy <admission@skillmountainacademy.com>`.

7. **Paystack.** Dashboard > Settings > **API Keys & Webhooks**. Start in **Test mode**:
   - Copy the **Secret key** (`sk_test_...`):
     ```
     npx wrangler secret put PAYSTACK_SECRET_KEY
     ```
   - **Webhook URL** (set it in both Test and Live): `https://skillmountainacademy.com/api/paystack/webhook`
   - Callback URL: leave empty (the Worker sends its own for each payment).
   - If the webhook URL used to point at the Google Apps Script, replacing it is fine: the old checkout's payments are still
     confirmed by the script's 5-minute check.

8. **Hold-token signing key** (a long random secret):
   ```
   openssl rand -base64 48 | npx wrangler secret put HOLD_SIGNING_KEY
   ```
   (On Windows without openssl, run `npx wrangler secret put HOLD_SIGNING_KEY` and paste 60+ random characters.)

9. **Google Sheet mirror.** The same Apps Script web-app address as `NEXT_PUBLIC_SHEET_URL`:
   ```
   npx wrangler secret put SHEET_WEBHOOK_URL
   ```

10. Optional: put your Calendly class-booking link in `wrangler.jsonc` > `vars` > `CLASS_BOOKING_URL` (used in welcome emails).

Secrets list (all set with `npx wrangler secret put NAME`, or Workers & Pages > skillmountainacademy > Settings > Variables and
secrets > Add > type **Secret**): `TURNSTILE_SECRET`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `HOLD_SIGNING_KEY`, `SHEET_WEBHOOK_URL`.
None of them is in the repository.

## B. Deploy

11. Commit the two ids in `wrangler.jsonc` and push to `main`. Workers Builds runs as before:
    build command `npm run build`, deploy command `npx wrangler deploy`, build variable `NODE_VERSION` = `22`.
    (Optional: make the deploy command `npm run db:migrate && npx wrangler deploy` so future migrations apply automatically,
    if the build token has D1 edit permission.)

## C. Check it works (with Paystack TEST keys)

12. Open `https://skillmountainacademy.com/api/status`. Every value under `ready` should be `true`.
13. Register for a programme with "Pay in 3 parts" and Paystack. Use a test card from Paystack's docs
    (https://paystack.com/docs/payments/test-payments/). You should return to "Payment received" and get the welcome email.
    Check the database:
    ```
    npx wrangler d1 execute skillmountainacademy-db --remote --command "SELECT reference, status, total_kobo FROM orders ORDER BY created_at DESC LIMIT 5"
    ```
14. Send a children's enquiry from `/children/` and check your inbox and the "Children enquiries" tab.
15. Go live: `npx wrangler secret put PAYSTACK_SECRET_KEY` with your `sk_live_...` key, and make sure the build variable
    `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` is your `pk_live_...` key (the original checkout still uses it). Redeploy. Make one small real payment.

## D. Content only you can supply

16. Curriculum PDFs: `public/curricula/graphics.pdf`, `uiux.pdf`, `webdev.pdf`, `marketing.pdf`, `cybersecurity.pdf`, `cloud.pdf`,
    `devops.pdf`, `cloud-devops.pdf`. Add PDF bookmarks for module headings if you want them listed on the programme pages.
17. Real reviews in `data/reviews.json` (shown from 3) and mentors in `data/mentors.json` (format in `data/README.md`).
18. Confirm the Web Development price (₦500,000 is a placeholder) and the new blurbs for UI/UX, Web Development and Cloud & DevOps.
19. Have your lawyer review the updated Privacy, Cookies and Terms text (Terms version 2026-11a).
20. `public/og-share.jpg` still says "University" in the picture itself; replace the image if you want.
21. When ready: set `timedPrice` on a programme to start a timed offer; set `groupPrice` values and `FLAGS.GROUP_ENABLED`; set
    `CHILDREN` ages/programmes/prices and `FLAGS.CHILDREN_ENABLED` (the child checkout will then need building).
22. Decide on the intro video if you want the home page above 90 in Lighthouse (see `docs/upgrade/LIMITS.md`).
23. Optional clean-up: `.github/workflows/deploy.yml` still deploys to GitHub Pages on every push. If you no longer use GitHub Pages,
    delete that file (Cloudflare Workers Builds does the real deploy).

## E. Learning platform (dashboards at /app/)

It uses the same database, secrets and Turnstile/Resend setup as above. Sign-in needs **Turnstile (A5)** and **Resend (A6)**.

24. **Tables.** `npm run db:migrate` also creates the learning-platform tables (migration `0003_lms.sql`). If you already ran it
    before this update, run it again; only the new migration is applied.
25. **Your admin address.** In `wrangler.jsonc` > `vars` > `ADMIN_EMAILS`, list the email(s) that should become admins on first sign-in
    (comma-separated; default `admission@skillmountainacademy.com`). Push to deploy.
26. **First sign-in.** Open `https://skillmountainacademy.com/app/login/`, enter that address, open the email, press **Sign in**.
27. **Instructors.** Admin > **Users** > Add a user > role *instructor*. They get a sign-in email.
28. **Students.** Learners who pay online get an account and enrolment automatically. For bank transfers: Admin > **Orders** >
    *Confirm bank payment* (this records the payment and creates the account). You can also add students by hand in **Users**,
    then enrol them in **Enrolments**.
29. **Each enrolment.** Admin > **Enrolments** > Manage: choose the instructor, then set the **fixed weekly class time**
    (day, start time in Lagos time, 45 or 60 minutes). The next 14 days of classes are created and both are notified.
30. **Courses and lessons.** Admin > **Courses**: add each programme's courses and lessons (they drive the progress bars).
31. **Materials.** Admin > **Materials**: add links/documents; paste the key text into "Text for the AI assistant" so the assistant
    can use it. Instructors can add materials too; you approve them before students see them.
32. **File uploads (R2).** Cloudflare dashboard > **R2 Object Storage** > turn it on (asks for a payment method; the free tier
    includes 10 GB). Then:
    ```
    npx wrangler r2 bucket create skillmountainacademy-files
    ```
    In `wrangler.jsonc`, remove the `//` in front of the `"r2_buckets"` line. Push. Until then, students can still type answers.
33. **AI assistant.** Works on the free plan, but the free allowance (10,000 neurons/day for the whole account) is roughly
    15-25 answers a day. For regular use: Workers & Pages > Plans > **Workers Paid** ($5/month, then $0.011 per 1,000 neurons).
    To change model: `npx wrangler ai models list`, then set `AI_MODEL` in `wrangler.jsonc`.
34. **Website traffic.** Cloudflare dashboard > **Web Analytics** > Add a site (free). Search rankings: Google Search Console.
35. **Local preview.** `npx wrangler dev` now needs `npx wrangler login` first (the AI binding only runs on Cloudflare).
36. **Lawyer review.** The Privacy and Cookies pages now describe the learning-platform data (messages, uploads, AI chats, sign-in cookie).

## F. Institutional transformation (20 Nov 2026)

37. **Run the new migration.** `npm run db:migrate` again (adds `0004_admissions.sql`: admissions, capacity and instructor
    verification). It is safe on live data: every programme starts **open** with capacity limits **off**, and instructors you
    already added count as **approved**. Until it runs, the site behaves as before (everything open).
38. **Check your existing instructors meet the standard.** They were marked approved automatically. Open Admin >
    **Recruitment** and record their checks (identity, credentials, technical assessment), so the public statement
    "every instructor passes verification" is true for all of them.
39. **New instructors go through Recruitment.** Admin > Recruitment > Add a candidate > record the checks > Approve. Approval
    sends their sign-in invitation. Candidates cannot sign in or be assigned students before that.
40. **Faculty page.** For each approved instructor who agrees, tick "Show on the public Faculty page". Ask them to complete
    their profile (photo, biography, qualifications, LinkedIn) in their dashboard first. Photos need R2 (item 32).
41. **Capacity.** Admin > **Admissions** > Manage: assign approved instructors to each programme with their maximum students.
    Only turn **Limit** on for a programme once its instructors are assigned; with no instructors the capacity is 0 and the
    programme shows as fully subscribed.
42. **Admission periods.** To run intakes, set a programme's mode to "By admission period" and add periods (Lagos time).
    "Closed" closes it immediately; "Open" ignores periods.
43. **Review the new copy.** Please read and correct, especially facts only you can confirm: About (founded in Abuja in
    2021; "not accredited by a government body"), programme pages (discipline text, "What you will master", outcomes and
    the completion wording), the Faculty selection stages, and the FAQ answers on admissions and class times.
44. **Currency markets.** Nigeria shows naira; the UK pounds; eurozone euros; everywhere else US dollars (guide amounts at
    the live rate, payment always in naira). To show naira to other African countries, add their codes to `NAIRA_MARKETS`
    in `lib/pricing.ts`.
45. **Lawyer review.** The Privacy Policy now covers instructor verification records and public faculty profiles, and the
    Cookie Policy covers the remembered country.

## G. Premium experience, admissions and sign-in (21 Nov 2026)

1. **Update the database (required).** From the `sma-site` folder in Command Prompt, after `git pull`:
   ```
   npm run db:migrate
   ```
   Answer **y**. This applies `0004` (instructor verification, the cause of the "no such column: verification" errors and of
   "could not add a tutor") and `0005` (registration numbers, staff numbers, notification priority, email preferences).
   Both only add columns and tables; no existing record is changed or removed. Until you run it, the dashboard shows
   "The database needs its latest update. Run npm run db:migrate" instead of a raw error.
2. **Bookmark the two private entrances.** The public website no longer shows any Sign in link.
   - Students: `https://skillmountainacademy.com/app/login/`
   - Faculty and staff (you): `https://skillmountainacademy.com/app/staff/`
   Your role still comes from your account, whichever page you use.
3. **Admit a student who paid by transfer or cash:** Admin > **Admit a student**. Fill in the form after the money is in the
   bank. It issues the registration number, records the payment and sends the admission and sign-in emails.
4. **Add `PAYSTACK_SECRET_KEY`** as a Secret (Workers > skillmountainacademy > Settings > Variables and Secrets) when you are
   ready to take card payments. Until then, online payment shows a "pay by transfer" message.
5. **Founding year.** The site no longer states a year (the old pages said both 2021 and other dates). If you want one shown,
   tell me the correct year and I will add it in one place.
6. Read the new home, programme and About pages and tell me any wording you want changed.

## H. Three private entrances (21 Nov 2026)
- Students: https://skillmountainacademy.com/app/student/login/
- Instructors: https://skillmountainacademy.com/app/instructor/login/
- Administrators only: https://skillmountainacademy.com/app/login/
A sign-in link is only sent when the account matches the entrance. Anyone using the wrong one gets an email pointing to
theirs (with no link). The old /app/staff/ page forwards to the instructor entrance.

**Email speed.** The Worker hands the email to Resend the moment the button is pressed. Any further delay is between
Resend and the receiving mailbox. To see where the time goes: Resend dashboard > Emails > open the email: "Sent" and
"Delivered" times. If Resend shows "Delivered" within a few seconds but the email shows up later, the delay is the
mailbox's own spam scanning (Northwest webmail). Gmail and Outlook addresses usually receive within seconds.

## I. If an email does not arrive
1. Admin > Platform > **Send a test email**. It shows Resend's exact answer:
   - "RESEND_API_KEY is not set": add it again as a **Secret** in Cloudflare (Workers > skillmountainacademy > Settings > Variables and Secrets).
   - "Resend refused the email (HTTP 401/403)": the API key is wrong or the domain is not verified in Resend.
   - "Accepted by Resend": the problem is the receiving mailbox. Check spam, and compare with a Gmail address.
2. Every failed email is also listed under Admin > Platform > Recent errors, with the reason.

## J. Instructor onboarding and sign-in pages (21 Nov 2026)
1. Run `npm run db:migrate` once after pushing (adds migration 0006: instructor profile fields; nothing existing changes).
2. Add an instructor: Admin > Recruitment > Add a candidate (or People). They get a congratulations email with their faculty
   entrance and a sign-in button that lasts 24 hours. After signing in they see only "My faculty profile": photo, citation,
   biography, languages, countries, LinkedIn / X / Facebook / portfolio, achievements and certifications with verification links.
3. When they submit, you get an email and a notification. Open Recruitment, check the profile (each certificate has a
   "Verify" link), tick the required checks and press Approved. They are emailed, the verified badge shows next to their name
   everywhere (their workspace, their students' dashboards, the public Faculty page if you list them) and their full workspace opens.
4. Sign-in pages show a different famous quotation on each visit over a faint photo (different for students, faculty and admins).
5. Abuja and Nigeria were removed from the site, sign-in pages and emails. They remain only in the Privacy Policy and Terms
   (data-protection regulator, governing law and the business address), which the law expects there. Ask your lawyer before changing those.

## K. Final refinement (21 Nov 2026)
1. **Run the database migration** before deploying the Worker: `npm run db:migrate` (applies `0007_refinement.sql`). It only
   adds the AI Automation row, new tables and new columns; existing records are untouched.
2. **No new secrets.** The admissions assistant uses the existing Workers AI binding; call requests use Resend and Turnstile.
3. **AI Automation photo.** The programme uses the Academy photo for now. Send a licensed photo and it will replace it in
   `lib/photos.ts`. Upload a curriculum PDF if you have one.
4. **Paystack currency.** Payments stay in naira. Paystack does not support GBP or EUR for Nigerian businesses, and USD only
   with an approved domiciliary account. Visitors see their own currency as a dated approximation and the naira amount
   before paying. Tell us if Paystack approves USD for your account.
5. **WhatsApp.** The public WhatsApp chat button was replaced by the admissions assistant and Book a call. No WhatsApp
   Business API is connected, so staff are notified by email and in the dashboard only.
6. **Review the copy** on the homepage, About, Admissions, Faculty, Learning Experience and the AI Automation page,
   including the pre-footer statement (an original line attributed to the Academy, not a quotation).
7. **Guardian contact.** Before ticking "Contact with the guardian is authorised" for a student, make sure you hold written
   consent; the note you enter is kept with the record.
8. **Assistant questions** are kept for 180 days (privacy policy section 6 says so). Check Admin > Admissions > Assistant
   enquiries regularly for questions marked for follow-up.

## L. Stage 2 security (22 Nov 2026)
Read `docs/SMA_SECURITY_REMEDIATION.md` first. Section 15 lists every step in order: backup, check migrations, apply 0008
with approval, set `IP_HASH_SALT` and `MFA_ENCRYPTION_KEY`, deploy (CSP report-only), enrol in two-step sign-in, assign
administrator groups, then switch on `MFA_ENFORCE_ADMINS` and the enforced CSP. Students are signed out after 10 minutes
without activity from this release.

## M. Stage 2B: owner console and set-up (22 Nov 2026)

Full detail: `docs/SMA_STAGE_2B_SECURITY_VERIFICATION.md` (sections 4, 7 and 15).

1. Back up D1, then apply migrations (0008 and 0009 are additive): `npx wrangler d1 migrations apply skillmountainacademy-db --remote`.
2. Set three secrets yourself (generate random values; never share them):
   `npx wrangler secret put IP_HASH_SALT`, `npx wrangler secret put MFA_ENCRYPTION_KEY`, `npx wrangler secret put OWNER_RECOVERY_TOKEN`.
   Keep the recovery token offline (paper or password manager). It works once; set a new one after any use.
3. Deploy. Sign in at `/app/login/` as bookebukar@gmail.com, turn on two-step sign-in under **Security** FIRST (Stage 2C: the owner
   console only opens with the authenticator code), then open **Owner console** and press **Complete set-up** (once).
4. Assign each existing administrator a group (Users or Owner console). Only you can appoint Super Administrators.
5. In Admin > Security confirm "IP key: secret", then add the var `IP_HASH_STRICT` = `"true"` and deploy again.
6. Lost your authenticator and recovery codes: sign in by email, open "Platform owner: break-glass recovery" and enter the
   token; or use the D1 command in section 7 of the Stage 2B document.

## N. Stage 2C: final security gate (22 Nov 2026)

Full detail: `docs/SMA_STAGE_2C_FINAL_SECURITY_GATE.md`.

1. `MFA_ENCRYPTION_KEY` must be set before anything in the owner console works. An email link alone never authorises owner or
   administrator-management actions (groups, new administrators, MFA resets, removals, audit search).
2. Apply migrations up to 0010 (owner record and audit-log protection). Check afterwards:
   `npx wrangler d1 execute skillmountainacademy-db --remote --command "SELECT name FROM sqlite_master WHERE type='trigger'"` (4 names).
3. After set-up: Owner console > **Review needed** lists administrators without a group. Assign each one a group, then tick
   "Make administrators without a group read-only".
4. "Revoke access permanently" never deletes records. If an instructor is removed, reassign the listed enrolments in
   Academics > Enrolments.
5. Ownership can only move to another account through the documented D1 owner-transfer procedure (section 4 of the report).

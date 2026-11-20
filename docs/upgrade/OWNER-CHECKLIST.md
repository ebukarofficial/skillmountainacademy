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

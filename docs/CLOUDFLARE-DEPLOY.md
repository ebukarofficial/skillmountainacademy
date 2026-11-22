# Deploying skillmountainacademy.com on Cloudflare

> **Production route (Stage 3B.2, 22 Nov 2026, owner instruction).**
> - Production is published by the owner's intended arrangement: work locally → push to GitHub → Cloudflare, connected to the repository, builds and publishes (`npm run build`, then `npx wrangler deploy`).
> - That route publishes **application code only**. D1 migrations are a separate, owner-approved step: `docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md`.
> - Never add a migration command to the Cloudflare deploy command. Since Stage 3A, `npm run db:migrate` without approvals refuses and exits 1, so it would also stop every publish.
> - The optional `deploy-worker.yml` workflow is not part of this route.

## What this project is
| Item | Value |
|---|---|
| Framework | Next.js 16 (App Router), static export (`output: "export"`), Tailwind CSS 4, TypeScript |
| Node version | 22 (pinned in `.nvmrc` and `package.json` "engines"; tested on 22.22) |
| Package manager | npm (`package-lock.json` is committed; the build uses `npm ci`) |
| Build command | `npm run build` (runs `next build`) |
| Output directory | `out` (set in `wrangler.jsonc` as `assets.directory`) |
| Hosting | Cloudflare Workers with static assets. One Worker (`src/worker.ts`) answers `/api/*` only; every page is static |

## Build settings to enter in Cloudflare
Workers & Pages > Create > Import a repository (GitHub) > pick this repo. Then, under the project's **Settings > Build**:

| Setting | Value |
|---|---|
| Project / Worker name | `skillmountainacademy` (must match `name` in `wrangler.jsonc`) |
| Production branch | `main` |
| Root directory | `/` (leave empty) |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Output directory | not a setting for Workers. It is `out`, read from `wrangler.jsonc` |
| Build variable `NODE_VERSION` | `22` |

Workers Builds installs packages itself from `package-lock.json` (like `npm ci`), so you do not add an install command.

## Variables: what the site needs and where to put it
The website pages have no runtime variables (static export); the Worker has secrets (see "Backend" below). Next.js copies `NEXT_PUBLIC_*` values into the files at BUILD time,
so they must be **build** variables: Settings > Build > **Variables and secrets** (the build section, not the Worker runtime section).
If you add or change one, trigger a new build (Deployments > Retry build, or push a commit).

| Name | Public or private | Type in Cloudflare | Value |
|---|---|---|---|
| `NODE_VERSION` | public | Build variable | `22` |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | public (the pk_ key) | Build variable | your Paystack public key, e.g. `pk_live_...` |
| `NEXT_PUBLIC_SHEET_URL` | public | Build variable | your Google Apps Script web app address (`https://script.google.com/macros/s/.../exec`) |
| `NEXT_PUBLIC_WHATSAPP` | public, optional | Build variable | e.g. `2347061000472` (the code already has this as default) |
| Paystack SECRET key (`sk_...`) | PRIVATE | Worker **secret** `PAYSTACK_SECRET_KEY` (never a build variable, never in GitHub) | also stays in Apps Script > Script Properties > `PAYSTACK_SECRET` for the original checkout |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | public | Build variable | Turnstile site key (see docs/upgrade/OWNER-CHECKLIST.md) |

Set in code, not in Cloudflare (all public, in `lib/config.ts`): the Google Form address and question codes (`GFORM`), the Calendly link (`calendlyConsult`), the curriculum links (`CURRICULUM_LINKS`), business details.
Later, if you add a Worker: secrets go in Settings > Variables and secrets as **Secret** (or `npx wrangler secret put NAME`), and the D1 database is a binding, not a variable.

## Custom domain and DNS (do this carefully: email depends on it)
1. In GitHub: Settings > Pages > remove the custom domain (or unpublish the site), so the domain is free.
2. Cloudflare: add the site `skillmountainacademy.com` (Add a domain). Cloudflare scans the old DNS. Check that it copied EVERY record from Northwest, especially the email ones:
   - `MX` for `@` to `mailserver.businessidentity.llc` (priority 10)
   - `TXT` for `@` (the SPF record: `v=spf1 a mx include:spf.postal.businessidentity.llc ~all`)
   - `TXT` for `_dmarc`
   - `TXT` for `postal-g84940._domainkey` (DKIM)
   - `CNAME` for `psrp` to `rp.postal.businessidentity.llc`
   Set all of these to **DNS only** (grey cloud), never proxied. Compare with the Northwest DNS page before changing anything.
3. Delete the old website records: the four `185.199.x.153` A records, and the `www` CNAME that points to `github.io`. The old `*` record (`66.223.49.89`) is Northwest's catch-all; remove it too once everything works.
4. At Northwest, change the nameservers to the two Cloudflare gave you. Wait until Cloudflare shows the domain as **Active**.
5. In your Worker: Settings > **Domains & Routes** > Add > Custom domain: `skillmountainacademy.com`, and again for `www.skillmountainacademy.com`. Cloudflare creates the DNS records and certificates.
6. Make `www` go to the main address: Rules > Redirect Rules > `www.skillmountainacademy.com/*` to `https://skillmountainacademy.com/${1}` (301).
7. SSL/TLS mode: **Full (strict)**. Turn on Always Use HTTPS.
8. Send a test email to `admission@skillmountainacademy.com` from another address, and reply from the mailbox. Check the spam folder.

## What I checked, and what you must update
| Service | Does it need the domain? | Action |
|---|---|---|
| Paystack | The inline checkout script runs on any HTTPS website, so there is no code change. The public key is a build variable. | In the Paystack dashboard, if you see a website, callback or allowed-domain field (Settings > API Keys & Webhooks), set it to `https://skillmountainacademy.com`. Make a small test payment after launch. |
| Google Form (registration) | The form accepts posts from any website. No allowed-domain list. | None. Keep "limit to 1 response" and sign-in OFF. |
| Google Apps Script (payment check, emails) | The web app is set to "Anyone", so there is no domain setting. | None. If you ever redeploy the script, use Deploy > Manage deployments > Edit > New version so the address stays the same. |
| Calendly | Embeds work on any domain. | None (add your link in `lib/config.ts`). |
| Google Search Console | A new property is needed for the domain over Cloudflare. | Re-verify `skillmountainacademy.com` and submit `https://skillmountainacademy.com/sitemap.xml`. |
| Social profile links, email signatures | They already use the same domain. | None. |
| "Timed-price" features | I searched the code: this version has NO timed or countdown pricing (prices are fixed in `lib/config.ts` and the Google script). Nothing depends on the host. | If you have a timed-price version elsewhere, send it to me. A static site fixes the price when it is built, so time-limited prices must be calculated in the visitor's browser, or the site must be rebuilt on a schedule. |

## Files for headers, redirects and 404
- `public/_headers` and `public/_redirects` are copied into `out/` by the build and read by Cloudflare.
- IELTS Training and Data Analytics are no longer offered. `_redirects` sends old paths such as `/ielts`, `/ielts-checkout`, `/checkout/ielts` and `/data-analytics` to `/?notice=removed`, where the home page shows a short notice. `_redirects` cannot match query strings, so `/checkout/?p=ielts` and `/checkout/?p=data` are sent to the same notice by the checkout page itself.
- `app/not-found.tsx` becomes `out/404.html`. Cloudflare serves it with a real 404 status.

## Backend (Worker, D1, KV, secrets)
Since the Nov 2026 upgrade, `wrangler.jsonc` has `main: src/worker.ts`, `run_worker_first: ["/api/*"]`, a D1 binding `DB`, a KV binding `KV`
and one cron. Setup steps, secrets and dashboard settings (Turnstile, Resend, Paystack) are in `docs/upgrade/OWNER-CHECKLIST.md`.
New build variable: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Worker secrets: `TURNSTILE_SECRET`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`,
`HOLD_SIGNING_KEY`, `SHEET_WEBHOOK_URL`. Free-plan limits per route: `docs/upgrade/LIMITS.md`.

## Test checklist after the first deploy
1. Build log ends with "Success" and shows the deploy URL (`skillmountainacademy.<account>.workers.dev`).
2. Open `https://skillmountainacademy.com/`: home page loads with fonts, photos and the sliding cards. Hard refresh (Ctrl+Shift+R).
3. Open `/checkout/?p=cloud`, `/terms/`, `/privacy/`, `/cookies/`, `/refunds/`: each loads. `/checkout` (no slash) goes to `/checkout/`.
4. Open `/ielts-checkout`, `/ielts` and `/checkout/?p=ielts`: each goes to the home page and shows the "no longer offered" notice. Open `/no-such-page/`: the 404 page appears.
5. `https://skillmountainacademy.com/robots.txt` and `/sitemap.xml` load.
6. Paste the link in WhatsApp: the preview image shows (if cached from before, test with Facebook Sharing Debugger).
7. Submit a test application with bank transfer: a new row appears in the "Form Responses 1" and "Applications" tabs, and the acknowledgement email arrives.
8. Do one small Paystack payment (test key first if you have one): row becomes PAID and the welcome email arrives.
9. Check security headers at securityheaders.com for the domain.
10. Send and receive a test email on `admission@skillmountainacademy.com`.
11. Delete `.github/workflows/deploy.yml` from the GitHub repo if it is still there, and turn GitHub Pages off.

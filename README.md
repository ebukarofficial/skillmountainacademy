# Skill Mountain Academy (SMA) platform

One-on-one training site. Next.js 16, Tailwind 4, hosted on GitHub Pages.

## 1. Google Sheet (registrations)
1. Create a Google Sheet. Extensions > Apps Script, paste `docs/google-sheet-script.gs`.
2. Deploy > New deployment > Web app. Execute as: Me. Access: Anyone.
3. Copy the web app URL. It is your `NEXT_PUBLIC_SHEET_URL` and the Supabase `SHEET_URL` secret.

## 2. Paystack + email (Supabase Edge Function)
```
supabase functions deploy paystack-webhook --no-verify-jwt
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_... RESEND_API_KEY=... MAIL_FROM="SMA <hello@yourdomain>" SHEET_URL=<apps script url>
```
- Paystack dashboard > Settings > API Keys & Webhooks: set the webhook URL to the function URL.
- Edit the resource links in `supabase/functions/paystack-webhook/index.ts`.
- The Paystack secret key lives only in Supabase. Never put it in the site or in GitHub.

## 3. GitHub
1. Push this folder to github.com/ebukarofficial/sma-platform (branch `main`).
2. Settings > Pages > Source: **GitHub Actions**.
3. Settings > Secrets and variables > Actions, add `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` and `NEXT_PUBLIC_SHEET_URL` (optional: `NEXT_PUBLIC_WHATSAPP`).
4. Every push to `main` builds and deploys to https://ebukarofficial.github.io/sma-platform

## 4. Google search
Add the URL above in Google Search Console and submit `/sitemap.xml`.

## Change programmes or fees
Edit `lib/config.ts` and keep fees in sync with the webhook function. Set `live: true` to open a programme.

## Local dev
Copy `.env.example` to `.env.local`, then `npm install && npm run dev`.

## Assets
Logos in `assets/` and the round badge `app/icon.png` (favicon) are used exactly as supplied.

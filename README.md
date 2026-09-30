# Skill Mountain Academy (SMA) site

One-on-one skill training. Next.js 16 + Tailwind 4, hosted on GitHub Pages. Registrations, payment checks and resource emails run in a Google Sheet script (no other server).

## Upload to GitHub
1. Delete the old `supabase` folder from the repo (no longer used).
2. Upload everything in this folder, replacing existing files. GitHub's web upload skips folders that start with a dot, so `.github/workflows/deploy.yml` must already exist in the repo (yours does). If you change it, edit it on GitHub.
3. Settings > Pages > Source: **GitHub Actions**.
4. Settings > Secrets and variables > Actions, add: `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (pk_...) and `NEXT_PUBLIC_SHEET_URL`. Optional: `NEXT_PUBLIC_WHATSAPP` (e.g. 2347061000472).
5. Site address: https://ebukarofficial.github.io/skillmountainacademy/

## Google Sheet + payments (one-time setup)
Follow the steps at the top of `docs/google-sheet-script.gs`. In short: paste it in Apps Script, add the `PAYSTACK_SECRET` script property, put your real resource links in `RESOURCES`, run `setup()`, deploy as a web app, and use the URL as `NEXT_PUBLIC_SHEET_URL`.

How a payment flows: registration is saved as PENDING > Paystack opens (card or transfer) > the script confirms the payment with Paystack itself > row becomes PAID > resources are emailed once. A 5-minute timer also checks pending rows, so bank transfers that confirm later are still caught.

## Edit content
- Programmes, fees, curriculum, "who it's for": `lib/config.ts`. If you change a fee, change it in `docs/google-sheet-script.gs` too.
- Phone/WhatsApp in the footer comes from your admissions flyer. Change it in `lib/config.ts` if needed.
- Photos: `assets/photos/`. Logos: `assets/` and `app/icon.png` (favicon), used exactly as supplied.
- Logo intro animation: `public/sma-intro.mp4` (plays once per visit, with a Skip button).

## Local development
Copy `.env.example` to `.env.local`, then `npm install && npm run dev`.

## Google search
Add the site in Google Search Console and submit `/sitemap.xml`.

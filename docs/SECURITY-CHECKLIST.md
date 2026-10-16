# Security checklist for this site

## What this site is (and why most "hacking" risks do not apply yet)
It is a static website on GitHub Pages. It has no database, no login, no admin area, no passwords and no server of its own.
The only things that receive data are your Google Form, your Google Sheet script and Paystack. So IDOR, mass assignment, password hashing
and admin-route protection do NOT apply today. They will apply when you build the learner portal (see the end of this file).

## Already done in this version
- No secret keys in the code or the website. The Paystack SECRET key lives only in Google Apps Script "Script Properties". The Paystack PUBLIC key is meant to be public.
- `.env*` files are in `.gitignore`. The built site was scanned: no secret keys, no source maps, no stray files.
- Payments are checked on the server (Google script) against Paystack, using the script's own price list. The browser cannot change the price or mark itself paid.
- The Google script now: checks every field and limits its length; blocks spreadsheet formula injection (values starting with = + - @); escapes text before putting it in emails (stops HTML injection); rate-limits applications, verifications and sign-ups; ignores unknown actions and oversized requests; saves only a fixed list of fields (no "mass assignment").
- The application form has a hidden bot trap, length limits, and only collects what is needed.
- React escapes all text, and the code has no `dangerouslySetInnerHTML`, `eval` or inline HTML injection, so XSS from form data is blocked.
- Calendly (third party) loads only after the visitor clicks. No analytics, ads or trackers. The exchange-rate lookup was removed (a fixed rate is used), so visitors' browsers contact no extra third party. Fonts are bundled at build time (not loaded from Google by visitors).
- Dependencies updated: `npm audit --omit=dev` (what ships) reports 0 vulnerabilities. The unused Supabase package was removed. 5 "high" notes remain in the dev-only linter chain (eslint-config-next); they are not part of the live site.
- A basic Content-Security-Policy tag blocks plugins and base-tag tricks.

## Limits you should know about
- GitHub Pages does not let you set HTTP security headers (HSTS, X-Frame-Options, a full CSP). HTTPS is enforced. If you want the full set, put the site behind Cloudflare (free) and add headers there.
- Your Google Form and Apps Script web address are public by design, so someone can send junk to them. The script limits the damage. For stronger protection later, add Cloudflare Turnstile.
- CORS: nothing to configure. The site sends one-way requests to Google, and your script has no private data to read back.
- Anyone who gets into the Google account that owns the Sheet can see all applications. Turn on 2-step verification for skillmountainacademy@gmail.com, use a strong unique password, and share the Sheet with as few people as possible.
- Bank details on the site are public by nature. Check the account for unexpected credits and only confirm payments yourself.

## Do these yourself (I cannot do them from here)
1. Search your GitHub history for leaked secrets: install `gitleaks` or `trufflehog` and run it on the repo, or use GitHub: Settings > Code security > Secret scanning (turn it on). If your Paystack SECRET key (sk_...) was EVER pasted into GitHub, a chat, or a public file, regenerate it in Paystack now.
2. Turn on 2-step verification for GitHub, Google, Paystack and Northwest.
3. In Paystack: add `skillmountainacademy.com` to the allowed domains if that option exists, and use a test key while testing.
4. In GitHub: Settings > Branches, protect `main`; keep the repo owner list short.
5. Re-run `npm audit` every month and update `next` when security patches come out.

## When you build the learner portal (later)
Use a real backend (for example Supabase or Firebase) and follow these rules from day one:
- Row Level Security on every table, so each learner can only read their own rows. Take the user ID from the server session, never from the browser.
- Never let the browser pick fields like role, price, balance or status. Name the columns you accept one by one.
- Rate-limit login, password reset and anything that sends email or costs money.
- Hash passwords with a proven library (bcrypt/argon2) or use the provider's auth. Do not invent your own.
- Hiding a button is not a permission. Check every action on the server.
- Keep service-role/secret keys in server-side environment variables only.

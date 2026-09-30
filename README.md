# Skill Mountain Academy (SMA) site

Personalized skill university, one-on-one training. Next.js 16 + Tailwind 4 on GitHub Pages. Registrations, payment checks and confirmation emails run on Google (Forms, Sheets, Apps Script). No other server.

## Upload to GitHub
Upload everything in this folder EXCEPT the `.github` folder (GitHub's web upload skips dot-folders; yours already exists in the repo). Commit. The site rebuilds itself.

## One-time Google setup
Follow the steps at the top of `docs/google-sheet-script.gs`. Summary:
1. New Google Sheet (use skillmountainacademy@gmail.com) > Extensions > Apps Script > paste the file.
2. Script Properties: `PAYSTACK_SECRET` = your Paystack secret key.
3. Put your real learning links in `RESOURCES`.
4. Run `createRegistrationForm()`, copy the printed `FORM` block into `lib/config.ts`.
5. Run `setup()`. Deploy as a web app. Put its URL in the GitHub secret `NEXT_PUBLIC_SHEET_URL`.
GitHub secrets needed: `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (pk_...) and `NEXT_PUBLIC_SHEET_URL`.

## Flow
Programme card > checkout page > details saved to the Google Form/Sheet as a new row > Paystack (card or transfer) > the script confirms the payment with Paystack > row becomes PAID > payment confirmation email with resources is sent to the buyer (copy to the academy inbox).

## Edit content (lib/config.ts)
Programmes, prices (`fee` = what they pay, `was` = crossed-out price), learning lists, contact, social handles, real testimonials (section appears when you add some). Keep fees in step with `docs/google-sheet-script.gs`.

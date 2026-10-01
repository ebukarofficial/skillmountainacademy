# Skill Mountain Academy (SMA) site

Next.js 16 + Tailwind 4 on GitHub Pages. Registrations go to a Google Form, payment is taken with Paystack, and a Google script confirms the payment and emails the learner.

## Upload to GitHub
Unzip, then drag everything EXCEPT the `.github` folder into the repo (GitHub's upload page cannot take dot-folders; your existing `.github/workflows/deploy.yml` stays). Commit, then watch the Actions tab.
Settings > Pages > Source must be **GitHub Actions**.
Repo secrets (Settings > Secrets and variables > Actions): `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (pk_...) and `NEXT_PUBLIC_SHEET_URL` (from step 3 below).

## 1. Google Form (registrations)
1. Create a Google Form with 5 short-answer questions, titled exactly: **Full name, Email, Phone, Programme, Reference**.
2. Responses tab > Link to Sheets (creates the response sheet).
3. Get the form address: Send > link icon. It looks like `https://docs.google.com/forms/d/e/XXXX/viewform`. Change `viewform` to `formResponse`.
4. Get each question's id: three-dot menu > Get pre-filled link. Type any text in each question, click Get link, paste it somewhere. It contains `entry.123456=...` for each question.
5. Open `lib/config.ts` on GitHub and fill in `GFORM`:
   `url` = the formResponse address, and `entries` = the five entry.… ids (name, email, phone, programme, reference).

## 2. Paystack
Put your PUBLIC key in the GitHub secret above. Your SECRET key goes only in step 3 (never in GitHub).

## 3. Payment check + confirmation email (Google Apps Script)
Follow the steps at the top of `docs/google-sheet-script.gs` inside the response Sheet. Use the skillmountainacademy@gmail.com account so emails come from SMA. Put real resource links in `RESOURCES`.
Flow: learner submits the form > pays on the checkout page > the script confirms the payment with Paystack > row becomes PAID > the confirmation email and resources are sent straight away (a 5-minute timer also catches bank transfers that confirm later).

## Edit content
- Programmes, prices, "was" (crossed-out) prices, curriculum: `lib/config.ts`. Prices are enforced in `docs/google-sheet-script.gs` too, so change both.
- Learner reviews: add real social posts to `TESTIMONIALS` in `lib/config.ts`.
- Social links (footer icons only): `SOCIAL` in `lib/config.ts`.
- Email shown: admission@skillmountainacademy.com opens an email to the Gmail until the domain is bought. Change `emailShown` and `emailReal` in `lib/config.ts` then.
- Logos: `assets/` and favicon `app/icon.png`, used exactly as supplied.

## Local development
Copy `.env.example` to `.env.local`, then `npm install && npm run dev`.

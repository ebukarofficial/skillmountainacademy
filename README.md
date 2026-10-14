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


## Application, curriculum, bank transfer and class booking (latest update)
- **Application form:** Register opens a 3-step checkout (your details, a few questions, payment). Every answer is saved on an "Applications" tab in your Google Sheet. The 5 core fields also go to your Google Form.
- **View curriculum:** each programme card and the checkout page have a View curriculum button. To add a download button, paste each public Google Drive link into `CURRICULUM_LINKS` in `lib/config.ts`.
- **Free consultation (Calendly):** paste your consultation link into `calendlyConsult` in `lib/config.ts`. Until then the section shows a WhatsApp button.
- **Payment options:** Paystack (card or transfer) and manual bank transfer (UBA account details with Copy buttons).
- **Paystack payments:** confirmed automatically, then the welcome email is sent.
- **Bank transfers:** the learner gets an "application received" email, then sends their teller. After you confirm the money in UBA, type PAID in the Status column on the "Form Responses 1" tab. The welcome email is sent automatically, once.
- **Welcome email:** payment confirmation, curriculum link (Google Drive), a Calendly link to book class days and time, and a request for a passport photograph. Edit `CURRICULUM`, `CALENDLY_CLASSES` and `CLASS_LINK` at the top of `docs/google-sheet-script.gs`, then redeploy a New version.
- **Calendly setup:** create a 45-minute event type for class sessions. Connect Google Meet or Zoom in Calendly so every booking gets its own class link.

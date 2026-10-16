# Compliance review and risk flags (Nigeria first, plus visitors from abroad)

I am an AI assistant, not a lawyer. This is a careful checklist, not legal advice. Please have a Nigerian lawyer review the Terms, Privacy, Cookie and Refund pages before you launch.

## What was added or changed in the site
- Pages: Terms and Conditions (/terms/), Privacy Policy (/privacy/), Cookie Policy (/cookies/), Refund Policy (/refunds/), linked in the footer and at checkout. Each shows your business details.
- Checkout consent: a required tick box naming the Terms, Refund Policy and Privacy Policy, with a line for parents and guardians. The date and version of the terms accepted are saved with each application. The mailing-list box has its own required consent tick.
- Data minimisation: removed gender, date of birth (replaced by "18 or older?"), state of origin, marital status, street addresses, the market-analysis question and the passport photo request. Kept only what is needed to teach, contact and bill the learner.
- Claims removed: "300+ learners", the stats cards, "credentials that matter globally", "Discounted for you" on programmes with no previous price, the "Real Learners" section (it now appears only once you add real, permitted posts), and the word "university" in the site text.
- Cookies and tracking: there is no analytics, advertising or tracking. Calendly loads only after a click. The live exchange-rate request was removed. Fonts are bundled at build time.
- Accessibility: skip-to-content link, text contrast raised to meet WCAG AA (including button text), clear button labels, keyboard-friendly forms and radio buttons with visible focus, focus moved into pop-ups, form errors announced to screen readers, motion respects "reduce motion", descriptive alt text on meaningful images (decorative photos are hidden from screen readers because their text label is next to them).

## Do I need a cookie banner?
Not for what the site does today. It sets no cookies of its own, uses one session-only item to remember the logo animation, and does not use analytics or advertising. Paystack (checkout only) and Calendly (after a click) are used on request. Nigerian (NDPA) and EU/UK rules require consent for non-essential cookies, so the moment you add Google Analytics, Meta Pixel, ads, a chat widget or YouTube embeds, you must add a consent banner and update the Cookie Policy.

## Risks to decide on (highest first)
1. The word "university". Using "University" for a business in Nigeria is regulated, and the National Universities Commission (NUC) warns against unapproved institutions. Your share image (SMA_Site_link_display.jpg) says "One-on-One Skill University". I used "Skill Academy" in the site text. Please check with a lawyer or the NUC before using "university" anywhere, and consider remaking the share image with "Academy".
2. Company details. Make sure Skill Mountain Academy Limited is registered with the Corporate Affairs Commission (CAC). Add your RC number in `BUSINESS.rc` in `lib/config.ts`. It then shows in the footer and on the legal pages.
3. Data protection (NDPA 2023). Check whether you must register with the Nigeria Data Protection Commission as a data controller of major importance, and whether you need a data protection officer. Keep a short record of what data you hold and why.
4. Children. You accept learners under 18. Make sure only parents or guardians register them, and keep mentors' background checks and a child-safeguarding policy. Under US law (COPPA) and EU/UK rules, extra rules apply to children, so do not accept under-13s from those places without proper parental consent.
5. Visitors from abroad. You show US dollar prices, so you may be "targeting" people in other countries. The EU/UK GDPR and some other laws can then apply. The Privacy Policy covers the basics, but get advice if you actively market abroad.
6. Refunds and price claims. The Refund Policy I wrote is a DRAFT (7-day full refund before the first session; pro-rata refund within 14 days after it). Change it to what you will honestly honour. Only show a crossed-out price if it was a genuine earlier price (Nigeria's FCCPC law treats misleading price claims as an offence). The 36% / 24% badges rely on the old prices you gave me (Cloud ₦700,000, Cybersecurity ₦850,000).
7. Results and credentials. The site now says a certificate is an SMA certificate, not a degree, and that no job or income is guaranteed. Do not add claims like "guaranteed job", "internationally recognised" or "accredited" unless you can prove them.
8. Inclusive learning claim. The point about learners who need additional support is a promise. Only keep it if mentors are trained for it.
9. Reviews and testimonials. Only use real posts, with the person's permission, and never edit the wording. Do not buy or invent reviews.
10. Image copyright. See docs/IMAGE-LICENSES.md. Free stock photos usually need a credit; some cannot be used commercially without a paid plan. Keep receipts.
11. Email marketing. Only email people on the mailing list who ticked the box. Every email needs an unsubscribe link and your business address. Keep the sign-up date (saved in the "Mailing list" tab).
12. Taxes and records. Keep payment receipts and consider VAT and company tax rules with an accountant. Nigeria Cybercrimes Act and anti-fraud rules mean you should only confirm bank transfers after checking your bank.
13. Education approvals. Depending on the state and the type of training, you may need approval or registration for a skills or training centre. Ask your state education ministry or a lawyer.

## About the video you shared
It quotes large fines for US and EU laws (COPPA, GDPR, California wiretapping and CAN-SPAM). Those laws do exist, but the amounts and examples are exaggerated or depend on the situation, and not all apply to a Nigerian business. The safe steps from the video that DO apply here are included: no age-blind sign-up, no tracking, no session replay, fonts bundled instead of loaded from Google, an unsubscribe and consent for emails, clear consent text before payment, and image licence checks.

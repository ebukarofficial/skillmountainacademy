You are a senior full-stack engineer improving https://skillmountainacademy.com. The site is
live on Cloudflare (Workers with static assets, deployed from GitHub) and works well. Do not
break it. Work phase by phase. After each phase: run the build and tests, list what changed,
and ask me only if something blocks you.

HARD RULES
1. THE SMA BRAND COLOURS MUST NEVER CHANGE. They are used across all branding and media.
   Do not change any existing colour value (cream, sage green, peach and every other
   existing colour), gradient, logo or badge. Build all new UI only from the existing
   colour variables or Tailwind tokens, and add no new colours. If a design seems to need a
   new colour, reuse the closest existing one. Before and after every phase, diff the
   colour tokens and theme config: the diff must be empty.
2. Keep the look, layout and behaviour of everything not mentioned here exactly as it is.
3. Keep the Cloudflare hosting and deploy setup. Only add bindings that are needed.

SCOPE: the public website and its shared backend. Do NOT build the student, instructor or
admin dashboards, login, video, or whiteboard; they come later from a separate spec.

1. TECH (Cloudflare Workers Free plan; stay inside its limits)
- One Worker serves the static site and the API (/api/*). TypeScript.
- Use D1 (versioned migrations, prepared statements, D1 batch() for atomic writes), KV for
  caching only, Cron Triggers (few), Turnstile on every public form, Resend for email,
  Paystack for payments. Secrets only as Wrangler secrets or dashboard variables, never in
  the repo.
- The Worker has about 10 ms of CPU per request: no heavy computation in routes.
- Keep database access behind one repository layer so it can be moved later.
- Prepared for the dashboard but NOT built now: R2, Durable Objects, passwordless auth, video
  behind a VideoProvider adapter (Google Meet link in year 1), Cloudflare Workers AI.

2. PROGRAMME DATA (one config file is the single source of truth; NGN)
All programmes are online, one-on-one, teacher-to-student, with a Skill Mountain Academy
certificate, and can be paid in 3 parts (50/30/20). Each has: slug, name, price,
trainingMonths, internshipMonths, level text, timedPrice (null), fastTrack (false),
curriculum file, groupPrice (null).
- graphics: Graphics Design. N350,000. 4 months training + 2-month internship.
- marketing: Digital Marketing. N300,000. 3 months training + 3-month internship.
- uiux: UI/UX Design (Product Design). N400,000. 4 + 2.
- webdev: Web Development. N500,000 (placeholder, owner to confirm). 4 + 2.
- cybersecurity: Cybersecurity. KEEP the price and details it has on the live site today;
  report them to me. 4 + 2.
Cloud track (teaches BOTH AWS and Azure):
- cloud: Cloud Engineering. Beginner-friendly. N450,000. 4 + 2.
- devops: DevOps Engineering. Mid-level, for learners with basic cloud knowledge. N500,000. 4 + 2.
- cloud-devops: Cloud & DevOps Engineering. Covers beginner-level cloud through to DevOps.
  N650,000. 5 months training + 2-month internship.
IELTS and Data Analytics are removed entirely. ALL eight programmes above are LIVE with a
Register button. There are no "Coming soon" tags, waitlists, or notify-me forms anywhere.
The 3-month fast track (35% off) is switched OFF for every programme; keep it as a disabled
option in the config. Final price = price (or timedPrice if an active hold exists).
Instalment due dates default to day 0, 45 and 90 (3-month training: 0, 30, 60), configurable.
Show duration everywhere as "X months training + Y months internship".

CAREER LAUNCH PACKAGE (shown on every programme page)
- LinkedIn profile setup and positioning
- Professional CV/resume development
- GitHub profile setup and project documentation (tech programmes: cloud, devops,
  cloud-devops, webdev, cybersecurity). For graphics, uiux and marketing, show
  "Portfolio setup and project documentation" instead.
- Job-search strategies and application techniques
- Interview preparation and feedback on practical projects
- The internship (length from each programme's config)
Never claim job placement, job guarantees or income outcomes anywhere on the site.

3. BRAND MESSAGE (make it LOUD, using only existing colours)
- The hero headline is "Flexible, one-on-one learning." It is the largest type on the site
  (fluid size, bold), with "one-on-one" highlighted in the existing sage green.
- Directly under the hero, add a full-width band with pillars: "One teacher. One student."
  and "Flexible: pick your day and time (weekday or Saturday), pay in 3 parts, learn online
  from anywhere." If group classes are enabled, add "Learn with 1 or 2 friends."
- Repeat the message in the page title and meta description, at the top of every
  programme page, and on the registration page header.
- Elsewhere keep the "homeschool" wording to two mentions at most.

PHASES

PHASE 0: Audit (read only)
Report what already exists: Worker entry, D1, KV, Turnstile, Resend, Paystack, forms and the
Google Sheet mirror, currency detection, timer, instalments, curriculum links, reviews. Build
only what is missing; do not rebuild what works. Save a snapshot of the colour tokens.

PHASE 1: Cleanup and restructure
1. Remove IELTS and Data Analytics everywhere: cards, FAQs, meta description and keywords,
   category tabs, goal picker, links, structured data and the sitemap. Redirect old IELTS and
   Data Analytics URLs (including /checkout/?p=ielts) to the home page with a short notice.
2. Remove every "Coming soon" tag, notify-me form and waitlist. Goal-picker options map to
   live programmes only (for example "Protect systems and data" -> Cybersecurity).
3. Present the Cloud track as three programmes with a "Which one is right for me?" comparison:
   level, who it's for, duration, price, and "AWS and Azure" badges.
4. Remove all hardcoded "≈ US$" labels. Fix the OG image alt text ("University" -> "Academy").
   Remove the meta keywords tag. Add Abuja to the meta description. Replace any "6 months"
   wording with the training + internship format.

PHASE 2: Programme pages and the louder message
1. Build the hero, band and repeats from section 3.
2. A static page per programme at /programmes/[slug]/ with its own title, description and
   Course structured data. Show: price, duration (training + internship), "What you'll learn"
   (from the curriculum PDF headings), a "View curriculum" button, the Career Launch Package,
   trust lines (certificate, online one-on-one, pay in 3 parts, link to the Refunds page), and
   a Register button.
3. View curriculum opens /curricula/{slug}.pdf in a NEW TAB (target=_blank, rel=noopener) with
   a separate Download link. If a PDF is missing, disable the button and log a build warning.

PHASE 3: Forms and orders (Worker + D1; only what the audit shows is missing)
1. D1 tables: programmes (seeded from config), registrations (learner, parent, child, group
   members), orders, payments, instalments, holds, children_enquiries.
2. Endpoints for registration and children enquiries, protected by Turnstile, validated and
   rate-limited, with confirmation emails via Resend.
3. D1 is the primary store. Until the admin dashboard exists, also mirror each registration to
   the existing Google Sheet through the existing webhook so I can still see them.

PHASE 4: Currency
1. Detect the visitor's country in the Worker (request.cf.country, with browser
   timezone/locale as a fallback). NG -> NGN, US -> USD, GB -> GBP, eurozone -> EUR,
   everywhere else -> USD. Add a header currency switcher that overrides detection.
2. A cron job fetches live FX rates from a free, no-key FX API (check its terms) every 12
   hours into KV, keeping the last known rates if the API fails. Convert from NGN, round
   sensibly, show "≈" for non-NGN, use Intl.NumberFormat.
3. At checkout, state clearly what will be charged and in which currency (Paystack charges in
   NGN unless I enable others). Save the FX rate used with each order.

PHASE 5: Timed price hold (built now, dormant until a programme has a timedPrice)
1. Applies only to programmes with a timedPrice. The hold starts when a visitor opens that
   programme and lasts 48 minutes. The Worker issues a signed, HttpOnly hold token and records
   it in D1, so it survives refreshes and revisits.
2. While active: countdown, timed price, regular price crossed out. When it ends: the regular
   price and a calm "Offer ended" message. The visitor cannot restart it for 7 days (enforced
   server-side). The regular price is what checkout charges after the hold ends.
3. Exit prompt: desktop cursor leaving the top; mobile back button or tab hide. One in-page
   modal per visit with the time left and two buttons: "Secure my seat" and "Not now". Never
   trap the visitor.
4. Accessibility: do not announce the timer every second; respect prefers-reduced-motion; the
   modal traps focus and closes with Escape. No fake scarcity ("only X seats left").

PHASE 6: Checkout, payments, groups
1. The server computes the price from the programme config and the hold token. Never trust a
   price sent from the browser.
2. Paystack: initialise the transaction in the Worker (secret key server-side), verify the
   webhook signature, make processing idempotent, and store orders and payments in D1.
3. Instalments: "Pay in full" or "Pay in 3 parts (50/30/20)", amounts in the active currency,
   adding up exactly. Part 1 is paid at registration; parts 2 and 3 are emailed as Paystack
   payment links on their due dates with a reminder 3 days before. Mark overdue parts in D1.
   State plainly: live-session access is paused if a payment is more than 2 weeks late.
4. Group classes (feature flag GROUP_ENABLED, default off): 2 to 3 people combine and pay for
   one class. The lead registrant adds the others (name and email). Each learner has their own
   record, grades and attendance, and they share one live slot. Pricing comes from each
   programme's groupPrice; the option stays hidden until prices are set.

PHASE 7: Children's package
1. Create /children: children learn only through a parent account with the parent's consent,
   with customised curricula and one-on-one teaching.
2. Parent enquiry form (parent name, email, phone, child's age, programme interest) saved to D1
   and emailed to me. Self-serve checkout stays off until I supply ages, programmes and pricing
   (feature flag CHILDREN_ENABLED, default off).
3. The "Parents and children" card in "Who it's for" links here.

PHASE 8: Trust and content
1. Reviews section fed by data/reviews.json (name, programme, year, quote, optional photo);
   hide it while there are fewer than 3 reviews. Mentors section fed by data/mentors.json,
   hidden until I add entries.
2. Update the FAQ for: AWS and Azure, the internship, group classes, the children's package,
   instalments and certificates. Add Organization and FAQ structured data and descriptive
   image alt text. Add a contact email to the footer.

PHASE 9: Quality
1. Lighthouse (mobile) 90+ for Performance, Accessibility, SEO and Best Practices.
2. Check every route against the free-plan CPU and request limits.
3. Re-run the colour-token diff against the Phase 0 snapshot.

ACCEPTANCE TESTS
1. IELTS and Data Analytics are gone everywhere; old links redirect home.
2. All eight programmes are live with a Register button; no "Coming soon" text exists anywhere.
3. The Cloud track shows three programmes with the right prices, levels, AWS/Azure badges and
   the comparison.
4. Durations read as training + internship, with Digital Marketing at 3 + 3.
5. The hero headline is the largest text on the site and the band appears below it.
6. Currency switching works for NGN, USD, GBP and EUR; checkout states the charged amount.
7. The price at checkout always matches the server's calculation; tampering with a
   browser-sent price changes nothing.
8. Instalment parts add up exactly; Paystack webhooks are idempotent.
9. Curriculum buttons open the right PDF in a new tab.
10. Group and children features are invisible while their flags are off.
11. Forms reject submissions without a valid Turnstile token.
12. THE COLOUR-TOKEN DIFF IS EMPTY: no brand colour, logo or badge has changed.

FINAL DELIVERABLE: a summary of every file changed, the Cybersecurity details found on the
live site, and everything I must do by hand (Paystack and Resend settings, secrets, adding
the curriculum PDFs).
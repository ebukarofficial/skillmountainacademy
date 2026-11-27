# Skill Mountain Academy: Expansion Stage A, Owner Decisions Register

Date: 27 November 2026 (revised the same day for the owner's 2027 catalogue). Every item here needs the owner's decision before the stage that depends on it starts. Nothing has been decided on the owner's behalf. Where the owner's brief already states a rule, it is recorded as **Stated rule**, and only its open details are listed.

**Columns:**
- **Needed for:** the roadmap stage that cannot start without this decision.
- **Facts from the audit:** what the system does today.
- **Options / recommendation:** for information; the owner decides.

## A. Preconditions

| ID | Decision | Needed for | Facts from the audit | Options / recommendation |
|---|---|---|---|---|
| D-00 | When to apply production migration **0010** (owner integrity) | Every migration from 0011 | Production is at 0009; the code expects 0010. Owner powers are locked and the audit log is unprotected. Rehearsed in Stage 3C (security workstream). | Apply through the gated checklist before Stage B. The security workstream stays separate; this is only a sequencing dependency. |

## B. Programme catalogue

Basis: the owner's 2027 catalogue supplied on 27 Nov at 13:03 (21 programmes, six schools, USD tuition).

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-36 | **Which catalogue is current, and is it 21 or 22 programmes?** | B | The Stage A brief says 22; the 2027 catalogue numbers 21. An earlier draft of these documents used a different 22-programme list (with naira prices) that is not among the files available. | Confirm the 21-programme catalogue, or supply the 22nd programme |
| D-01 | **Delivery model.** Confirm that "group assessments", "group-wide publication" and "instructor groups" mean one instructor publishing the same assessment to each of their **own one-on-one students**, not cohort classes | F (and site copy) | The 2027 catalogue says "We do not operate cohort-based classes"; the site and data model are one-on-one | Recommended: yes (caseload publication, results per student, no cohort entity) |
| D-02 | Retire or keep the Google Sheet price list (`FEES` in `docs/google-sheet-script.gs`) | B | Prices are duplicated in the code and the Sheet script | Generate it from the catalogue, or retire the Sheet's price emails |
| D-03 | What happens to **Cloud & DevOps Engineering** (`cloud-devops`), which is absent from the 2027 catalogue | B, C | Currently offered at ₦650,000, 5 + 2 months; Cloud Engineering and DevOps Engineering continue separately | Retire from admissions (history kept), or keep |
| D-04 | Slugs for **Data Analytics & Business Intelligence** and **Data Science & Machine Learning** | B | `data` and `data-analytics` were previously removed (`REMOVED_SLUGS`) | Use new slugs, or reuse after a read-only check of production records |
| D-05 | Cloud and DevOps content: "AWS **and** Azure" (current site) or "AWS **or equivalent**" (2027). DevOps is "Mid-level, needs cloud basics" today; the 2027 curriculum starts from Linux. | B | Copy and audience conflict | Choose the wording and entry level |
| D-06 | Do **existing students** keep their original price and duration when a programme changes (Graphic Design 4 + 2 → 3 + 1; Web Development, Cloud, DevOps, Cybersecurity 4 + 2 → 5 + 2; UI/UX 4 + 2 → 4 + 1; Digital Marketing 3 + 3 → 4 + 1)? | B, C | Orders store the charged amounts; enrolments don't store durations | Recommended: existing students keep their original terms; new terms apply to new registrations only |
| D-07 | Does AI Automation remain **full-payment only** at $500? Instalment rules for the new programmes, including the shorter 0/30/60 schedule that applies to 3-month trainings | B | `fullPaymentOnly` currently on AI Automation; plan 50/30/20 | Per programme |
| D-08 | Confirm the programmes as listed, including possible overlaps (AI Automation / AI Chatbot; Python / AI Engineering; Product Management / UI/UX / Business Analysis; Cloud / DevOps) | B | — | Confirm, merge or differentiate |
| D-09 | Who may **publish** the catalogue and **change prices** | B | No admin catalogue editing today | Recommended: academic or Head of Programmes drafts; owner (or super, if delegated) publishes; every price change audited |
| D-31 | **When** the 2027 catalogue goes live, and what happens to registrations in progress at that moment | B | — | A fixed date; pending unpaid orders honoured or expired |
| D-32 | Confirm the six schools and each programme's school, including Product Management and Digital Marketing under School 05 (Creative Technology & Digital Media) | B | No schools exist today | As in the 2027 catalogue |

## C. Tuition and currency

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| — | **Stated rule (both documents):** location decides the price shown, never nationality | D | Today: NGN only; other currencies are approximate conversions of the naira price; the browser chooses the display currency | — |
| D-37 | **Is the naira price fixed or converted?** The brief describes a fixed Nigerian NGN price plus an explicit USD international price ("not calculated by exchange rate"). The 2027 catalogue gives one **USD benchmark** and says Nigeria sees the **equivalent** in naira. | B, D | The catalogue lists USD only | (a) Fixed ₦ and $ per programme (owner supplies ₦ figures); (b) USD benchmark, ₦ converted (needs D-39) |
| D-38 | Are **£ and €** charged, or only shown as guidance? Same for "other supported currencies" | D, K | The site already shows £ and € by location, as conversions; only NGN can be charged today | Charge NGN and USD only and show £/€ as guidance; or charge each, subject to provider capability (D-25) |
| D-39 | If conversion is chosen: the **exchange-rate source**, how often it refreshes, rounding, and how long a quote is held | D | Rates refresh twice a day today (05:00 and 17:00 UTC) into KV, base NGN | Recommended: one named source, quote locked on the order with the rate and time, a time limit (for example 24 hours) |
| D-10 | A student who **relocates** mid-programme, or whose converted instalment amounts drift with the rate: how are future instalments priced? | D | — | Keep the locked currency and amounts, or re-price future instalments with evidence |
| D-12 | When IP country and declared residence **disagree** (VPN, travel) | D | VPN detection is unreliable | Recommended: the student attests residence; the order is flagged for review; finance or admissions decides |
| D-13 | How non-naira tuition is **collected** | D, K | Paystack is off; its multi-currency capability for this account is unverified | Verify the provider first (D-25); until then, show the price and collect by an approved alternative, or defer |

## D. Faculty and capacity

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-11 | Instructor capacity: **standard 20, maximum 30** (stated proposal), per programme and workload. In the one-on-one model that means 20–30 weekly individual sessions per instructor. | C | The default programme cap per instructor is 30 today. Not enforced at assignment. | Confirm the defaults; who may approve exceeding 20 |
| D-26 | Hiring approval authority, interview format, **probation length** and evaluation | I | No probation today | — |
| D-40 | Make the **teaching demonstration** (and portfolio review) mandatory before approval, as the 2027 instructor recruitment standard requires | C, I | All seven checks exist; only identity, credentials and the technical assessment are required today | Recommended: yes |
| — | **Stated rule:** AI may assist hiring evaluation but never makes the final hiring or dismissal decision | I | — | — |

## E. Administration

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-14 | The department list and **exact permissions** for Head of Programmes, HR, Marketing, Content Writing and Publishing, Recruitment; whether any is programme- or school-scoped | E | Seven groups exist (super, admissions, finance, academic, faculty, support, reporting) | A permission matrix to be approved per group |
| D-16 | **Appeals:** who may appeal (suspension, removal, assessment results?), who decides, time limits | E | No appeals today | — |
| — | **Stated rule:** the owner has ultimate authority; Super Administrators are delegated and cannot remove the owner or override owner-only decisions; other staff have role-specific access | E | Implemented today; to be preserved | — |

## F. Academic policy

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-18 | Assessment policy: categories (weekly assignments, weekly self-quizzes, monthly graded quizzes, examinations), **weights**, pass marks, rubric standards, late-submission rules, re-sits | F | Quizzes and assessments exist per student, without weights or rubrics | — |
| D-33 | Internship and graduation: supervision model, partner projects, evaluation, graduation requirements (competency, internship, final project) | F | Internship is only a duration number | — |
| D-19 | Whiteboard tool | F | None today | An external tool by link first, or build later |

## G. AI learning

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-15 | Exact wording and strictness of the "please enrol in X" reply; whether general study-skills questions are allowed | J | Prompt-based refusal today; no enrolment suggestion | — |

## H. Information Centre

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-23 | Who creates, approves and publishes announcements; whether and when email distribution is allowed; daily limits | H | No announcements; notifications and email exist | Recommended: content creates; owner or super approves; owner may publish directly; email only with explicit approval |

## I. Media security

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-20 | Profile photos stored as small re-encoded images in D1 (no new storage service) | G | Photos are disabled because R2 is off | Recommended: yes, for photos only |
| D-21 | Whether to switch on **Cloudflare R2** (cost, storage use) | G, I | Off; the brief says do not enable without approval | — |
| D-22 | Malware scanning for documents (CVs, certificates, submissions) before accepting them | G, I | Not implemented; signature checks only | A scanning service (paid or self-hosted) or no document uploads |

## J. Recruitment

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-24 | Retention period for candidate data and files; consent wording | I | Retention engine exists | — |

## K. Payments and finance

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-25 | **Verify** Wema Bank / ALAT Pay capabilities from official documentation or contract: hosted checkout or API, virtual accounts, cards, webhooks and signature method, USD, settlement reports, refunds, bulk payouts, fees | D, K | Nothing about this provider is assumed | Obtain the official merchant or API documentation; then design the adapter |
| D-27 | **Instructor remuneration:** the stated proposal of 70% of eligible tuition after approved tax deductions. Exact definition of "eligible tuition" (received payments only? net of refunds and fees?), tax treatment, effect of attendance, substitutions and exceptions, payment schedule. | K | No earnings records | Owner plus accountant decide |
| D-28 | Refund policy, and who approves refunds and payouts (dual control) | K | No refund records; the refund policy page exists on the website | Recommended: finance prepares; owner or super approves |
| D-34 | Scholarships or discounts, if any are planned: criteria and who approves | B, K | None in the system; the 2027 catalogue does not mention them | Only if wanted |

## L. Owner intelligence

| ID | Decision | Needed for | Facts | Options |
|---|---|---|---|---|
| D-17 | Definitions: active student, completion, retention, conversion | L | Raw data exists | — |
| D-29 | Which external sources to connect, and authorising access: Cloudflare Web Analytics, Google Search Console, Meta and Google Ads, review platforms | L | None connected; no analytics script | The owner enables and authorises each |
| D-30 | Budget for paid market-intelligence data (keyword volumes, competitor tools) | L | — | — |

## M. Existing features to confirm

| ID | Decision | Facts |
|---|---|---|
| D-35 | Keep or remove the dormant features under the new catalogue: group classes (friends), children's package, timed price holds, fast track, previous ("was") prices | All switched off today |

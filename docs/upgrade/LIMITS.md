# Cloudflare Workers Free plan: route-by-route check (Phase 9)

Free plan limits used here: 100,000 Worker requests a day, about 10 ms CPU per request, 50 external requests (subrequests)
and 50 D1 queries per invocation, 3 MiB Worker size. D1 free: 5 million rows read and 100,000 rows written a day.
KV free: 100,000 reads and 1,000 writes a day.

**Static pages cost nothing here.** `run_worker_first` is only `/api/*`, so every page, image, PDF and script is served by
Cloudflare's assets server without running the Worker or using requests from the 100,000.

The Worker bundle is about 60 KiB (minified well under 200 KiB; a test enforces this). No route does heavy computation:
the work is JSON parsing, input checks, one SHA-256 hash and at most two HMACs (Web Crypto, native code), and waiting on I/O.
Waiting on D1, KV or fetch does not count as CPU time.

| Route | When it runs | CPU | D1 queries | Subrequests | Notes |
|---|---|---|---|---|---|
| `GET /api/status` | checkout and children pages, once per view | < 1 ms | 1 read | 0 | |
| `GET /api/geo` | once per browser tab (cached in sessionStorage) | < 1 ms | 0 | 0 (1 KV read, edge-cached 1 h) | First call after setup may fetch rates once (at most every 10 min per instance) |
| `GET /api/hold` | programme pages, ONLY for programmes with a timedPrice (none today) | < 2 ms | 2-4 | 0 | 1 write when a hold starts |
| `POST /api/register` | each registration | < 3 ms | 2 rate-limit writes + 1 batch (about 3-7 rows) + up to 1 read | Turnstile 1, Paystack 1, Resend 2, Sheet 1 | Emails and sheet run after the response (`waitUntil`) |
| `POST /api/children-enquiry` | each enquiry | < 2 ms | 2 | Turnstile 1, Resend 2, Sheet 1 | |
| `GET /api/order` | thank-you page polling (max 10 polls) | < 1 ms | 3-4 | 0-1 (Paystack verify) | Rate-limited 30 per 10 min per IP |
| `GET /api/pay` | instalment link clicks | < 2 ms | 3 | Paystack 1 | |
| `POST /api/paystack/webhook` | each Paystack event | < 2 ms | 2 + 1 batch (4 statements) + 4 | Resend 2-5, Sheet 1 | Idempotent |
| Cron `0 5,17 * * *` | twice a day | < 5 ms | up to about 25 | FX 1-2, Resend up to 21 | Capped at 20 learner emails per run (`MAX_NOTICES_PER_RUN`); the rest go the next morning |

Daily budget at, say, 2,000 visitors a day: about 2,000-4,000 Worker requests (geo + status), far below 100,000.
KV writes: 2 a day (rates). D1 writes: a few per registration.

Lighthouse (mobile, simulated slow 4G, local `wrangler dev`, two runs each, 19 Nov 2026):

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| / (home) | 61-80 (original site, same test: 66-70) | 100 | 100 | 100 |
| /programmes/cloud/ | 90-94 | 100 | 100 | 100 |
| /programmes/marketing/ | 93 | 100 | 100 | 100 |
| /checkout/?p=cloud | 95 | 100 | 96* | 100 |
| /children/ | 92-94 | 100 | 100 | 100 |
| /terms/ | 96-99 | 100 | 100 | 100 |

\* Only because this test machine cannot reach js.paystack.co (a console network error). On the live site this passes.

The home page is below 90 because of the existing full-screen logo intro video, which Lighthouse counts as the largest
content and which plays for about 5 seconds on a first visit. It was not changed (owner rule: keep everything not in the spec
as it is). What was improved: the hero now appears without waiting for JavaScript, the first slide image loads with high
priority, and the video has a poster of its own first frame. Largest Contentful Paint went from 13.5 s (original) to 4-10 s.
To reach 90+ on the home page, the owner would need to choose one: show the intro only on desktop, shorten it to about 2 seconds,
or let the page show underneath it instead of a full cover.

## Learning platform (added 20 Nov 2026)

| What | Cost on the free plan |
|---|---|
| Cron every 5 minutes | 288 Worker invocations a day; each run is a few D1 queries; at most 24 emails per run |
| Class records | one `INSERT ... SELECT` per day for ALL students (14 statements when a timetable is set) |
| Dashboards | each dashboard load is about 6-8 API calls; each call is a handful of D1 queries |
| Admin reports | one aggregate query per report (overview, academics, finance, platform, instructors) |
| Uploads | streamed into R2 without buffering (almost no Worker CPU); 25 MB max (3 MB photos) |
| AI assistant | 1 Workers AI call per question; 20 questions per student per day; the account-wide free allowance is 10,000 neurons/day |
| Sign-in | no password hashing (email links), so it fits the 10 ms CPU limit |

At about 50 active students: roughly 2,000-5,000 Worker requests a day (well under 100,000), and D1 writes well under 100,000/day.
Resend's free tier is 3,000 emails/month (100/day): class reminders (up to 6 emails per class across 24 h, 1 h, 15 min) mean
a paid Resend plan is likely needed above about 15 classes a day.

# Skill Mountain Academy — Stage D.1 Report
## Pricing snapshot atomicity and registration integrity

Date: 28 November 2026 · Status: implemented locally and ready for owner review · Stage E has not been started.

**Summary:**
- Every new order now stores its complete pricing snapshot **inside the order row**, in the same D1 transaction as the registration and instalments: all of it is saved, or none of it.
- The snapshot is checked for completeness **before** anything is written.
- Emails, the Google Sheet mirror and the Paystack payment start **only after** that transaction has succeeded.
- A retried registration (double click, dropped connection, payment that failed to start) returns the same order and reuses the same Paystack checkout. It never creates a second order or a second payment attempt.
- A database that cannot hold the pricing record refuses new orders rather than creating them without one.

---

## 1. Root cause of the original weakness

The registration flow already wrote the registration, order and instalments in one `db.batch()`. Stage D then wrote the pricing snapshot **afterwards**, in a separate `UPDATE` (`recordPricingSnapshot`), and deliberately ignored a failure: "best effort" was chosen so that a Worker running against a database without migration 0012 would keep working.

So:
- an order could be committed and returned as a success with no pricing record;
- payment then started on it as normal;
- nothing detected the gap.

## 2. Files

**Inspected**
- Registration and quotes: `src/server/routes/register.ts`, `src/server/routes/geo.ts`.
- Pricing: `src/server/pricing.ts`, `src/server/pricing-rules.ts`.
- Data layer: `src/server/repo.ts`: the batch, `guard`, rate limits and instalments.
- Payments: `src/server/routes/payments.ts`, covering `startPayment`, `recordCharge` and the webhook.
- Other entry points: `src/server/routes/hold.ts` (read-only), `src/server/sheet.ts` (mirror, run after the response), `src/server/lms/routes/admit.ts` (admin admissions also create orders).
- Client: `app/checkout/server-pay.tsx`, `app/checkout/flow.tsx` (the legacy inline Paystack path creates no server order).
- Tooling: the migration scripts.
- D1 platform documentation: `batch()`.

**Created**

| File | Purpose |
|---|---|
| `migrations/0013_order_idempotency.sql` | `orders.idempotency_key` (with a unique index), `request_fingerprint`, `payment_init` |
| `tests/stageD1-integrity.test.ts` | 10 tests |
| `docs/EXPANSION_STAGE_D1_REPORT.md` | This report |

**Modified**

| File | Change |
|---|---|
| `src/server/repo.ts` | `createRegistration` writes the pricing record in the order INSERT. Also new: `orderIntegritySupported`, `getOrderByIdempotencyKey`, `savePaymentInit`, `pricingSummary`. |
| `src/server/pricing-rules.ts` | `buildSnapshot` (snapshot v2, every field listed in the brief) and `snapshotProblems` (completeness check) |
| `src/server/pricing.ts` | The separate best-effort `recordPricingSnapshot` was **removed** |
| `src/server/routes/register.ts` | Integrity gate, completeness check, atomic write, idempotent replay, payment only after persistence |
| `src/server/lms/routes/admit.ts` | Admin admissions carry the same atomic pricing record (`flow: "admin_admission"`) |
| `src/server/lms/routes/pricing.ts` | The diagnostics show integrity counts |
| `app/checkout/server-pay.tsx` | Sends one `idempotencyKey` per checkout attempt |
| `src/server/schema-version.ts` | `EXPECTED_MIGRATION` is now 0013 |
| `db/schema.expected.json` | Regenerated |
| `scripts/db/rollback.mts` | 0013 entry, with a check |
| `scripts/db/anonymise.mts` | Idempotency key and payment initialisation are blanked in anonymised copies |
| `docs/lms/API.md` | Regenerated |

**Tests adjusted.** None was weakened.

| Test file | Change |
|---|---|
| `stageD-pricing` | Its "historical order" was created by registering on a 0011 database, which is now refused by design. It is now inserted as an older Worker wrote it, with the same assertions. |
| `stageD-pricing` | Also now checks `snapshot.flow` |
| `stageB-catalogue`, `db-preflight`, `db-recovery`, `stage3c-staging` | 0013 added to the pending, rehearsal and backup lists; new rollback check listed |
| `db-gate` | The no-publication rollback case provides the new check's value. The future-migration placeholders are renamed from 0013 to 0014. |

## 3. Implementation and transaction strategy

1. **Platform semantics, checked rather than assumed.**
   - Cloudflare's D1 documentation: "Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence."
   - A test confirms this in the local runtime: a second statement fails, and the first insert is rolled back.
2. **Atomic record.** The pricing record (residence country, network country, tier, tuition currency and amount, charge currency, the JSON snapshot, idempotency key and request fingerprint) is **columns of the order row itself**. It is written by the order `INSERT` inside the existing batch that also writes the registration rows and the instalments. One transaction; there is no second statement left to fail.
3. **Completeness before writing.** `snapshotProblems()` must return nothing, or the request fails with `500 pricing_snapshot_incomplete` and nothing is written. The snapshot (v2) contains:
   - residence and network country, and how the country was resolved;
   - tier;
   - tuition currency and amount;
   - display kind, currency and amount;
   - charge provider, currency, total and instalment parts;
   - catalogue prices used (local naira, international cents, applied amount);
   - exchange-rate details: source, time, age, rate, calculation and rounding, which are required whenever an amount was converted.

   No personal data is stored beyond country codes.
4. **Schema gate.** `orderIntegritySupported()` checks once per Worker instance that `orders` has the 0012 and 0013 columns. If it does not, registration and admin admission return `503 registration_unavailable` and nothing is written or charged. **Deploy order: migrations first, then the Worker.** This replaces Stage D's silent fallback.
5. **Order of operations in `POST /api/register`:**
   1. validation (lifecycle, admissions, form);
   2. integrity gate;
   3. idempotent replay check;
   4. Turnstile and rate limits;
   5. price and quote on the server (international tuition still refused);
   6. snapshot completeness check;
   7. **one atomic batch**;
   8. only then: emails and the sheet mirror (in the background) and the Paystack initialisation.

   Before the batch, nothing has outside effects apart from the Turnstile check and the rate-limit counters. The hold check is read-only.
6. **Idempotency.**
   - The website generates one key per checkout attempt.
   - The server stores it on the order with a **unique index**, plus a SHA-256 fingerprint of the request (programme, plan, method, email, group members).
   - A repeat with the same key and fingerprint returns the stored order (`replayed: true`). This is checked before Turnstile, because a Turnstile token cannot be used twice. The key is a random secret held only by that browser.
   - The same key with a different request gets `409 idempotency_conflict`.
   - Two simultaneous identical requests: the unique index lets only one order exist, and the loser answers with the winner's order.
   - Pages that send no key get no de-duplication, exactly as before.
7. **One payment attempt.**
   - The first successful Paystack initialisation is stored on the order (`payment_init`, written only if empty), and replays return it.
   - If the first attempt saved the order but Paystack failed to start, the student sees the existing message ("Your registration is saved; please try again or choose bank transfer"). A retry starts the payment once and stores it.
8. **Unchanged:**
   - the server-computed amount (catalogue plus verified hold);
   - the Paystack NGN charge (`currency: "NGN"`, amount from the instalment);
   - instalment amounts and dates;
   - webhook verification and payment recording (`recordCharge`);
   - the Google Sheet mirror and its columns.

## 4. Failure and recovery behaviour

| Failure | Result |
|---|---|
| Snapshot incomplete | `500 pricing_snapshot_incomplete`, "Nothing was saved or charged". Nothing written, no email, no sheet call, no Paystack call. |
| Writing the order with its snapshot fails (any statement in the batch) | `500 registration_not_saved`, "Nothing was saved or charged". The registration rows and instalments are rolled back with it. No reference or payment link is returned. |
| Database without 0012/0013 | `503 registration_unavailable`; nothing written |
| Paystack initialisation fails after the order is saved | `502 payment_start_failed` (existing message: registration saved). The order is complete and pending, with `payment_init` empty. A retry with the same key starts the payment once; otherwise the student can pay by bank transfer, or Admissions can send a link. |
| Response lost after success | A retry with the same key returns the same order and checkout address |
| Same key, different request | `409 idempotency_conflict` |

**How partial operations are detected:**
- `GET /api/app/admin/pricing/diagnostics` (Finance) now reports `integrity`:
  - `without_snapshot`: orders without a pricing record created since the first order that has one. It should always be 0; anything else means something wrote orders outside this path, such as an older Worker.
  - `with_snapshot`.
  - `paystack_not_started`: pending Paystack orders whose payment never started. These are recoverable by the student retrying, by bank transfer, or by Admissions.
- **Rollback check:** the 0013 entry, `orders_with_pricing_snapshot`, warns that rolling back below Stage D.1 would let orders be created without a pricing record again, so it should be done only with registrations closed.

## 5. Payment starts only after successful persistence

`beginPayment()` is called only after `createRegistration()` returns. A failed write throws before it, which is tested by counting Paystack calls.

The initialisation is tied to the stored order: its metadata `order_id` equals the saved order's id, and it is for the part 1 amount, in NGN (tested).

## 6. Tests (commands run, 28 Nov 2026)

`tests/stageD1-integrity.test.ts`: **10 of 10 pass.**

| # | Test |
|---|---|
| 1 | Platform: a D1 batch rolls back an earlier statement when a later one fails |
| 2 | Success: registration, order with complete snapshot (validated), and 3 instalments; one Paystack initialisation in NGN for part 1 of the stored order; checkout address stored |
| 3 | **Snapshot write failure** (database trigger): 500; no rows in registrations, orders or instalments; no Paystack, email or sheet call |
| 4 | **Order creation failure** (instalments cannot be written): everything rolled back; no payment |
| 5 | Snapshot validation: missing exchange-rate details, inconsistent charge parts, unknown resolution method and missing rounding are all caught |
| 6 | **Retry:** the same key returns the same order and checkout (with a spent Turnstile token); one order; one payment attempt. The same key for a different request is refused. |
| 7 | **Concurrent duplicates:** two simultaneous identical requests create one order |
| 8 | **Retry after Paystack failure:** the order is saved with its snapshot and no payment; the retry starts it once; a further retry reuses it; one order |
| 9 | **Payment and instalments:** the stored order is paid through the existing signed webhook in NGN; part 1 paid, parts 2 and 3 due, order part-paid |
| 10 | **Older database:** registration refused with nothing written and no Paystack call. A historical order is unchanged by 0012 and 0013, field for field, and its new columns stay empty. |

**Full checks**

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx tsc --noEmit -p src/tsconfig.json` | PASS |
| `npx eslint` | PASS |
| `npm run db:check` | PASS (13 files; the standing 0007 and 0011 owner notes) |
| `node --test` (38 files, in two halves) | **353 of 354 pass** (146/146 and 207/208), including all Stage B, C, D and D.1 tests |
| `npm run build` | PASS |
| Before/after build text comparison | 31 pages, none with different text |
| `npm run security:csp` | PASS (30 pages, report mode) |
| `npm run security:secrets` | PASS |
| `npm audit` | 0 vulnerabilities |
| `npm run sheet:fees -- --check` | PASS |

**The one failure is the pre-existing `3B.1: staging configuration … account_id is not pinned`**, from the security workstream. It was left unchanged and is not a Stage D.1 failure.

## 7. Historical orders

- 0012 and 0013 only add nullable columns and one unique index. Several NULL keys are allowed, so the index fits every existing order.
- There is no backfill and no UPDATE.
- A test shows an order made before Stage D is identical, field for field, after both migrations, and its new columns stay empty.
- Historical orders keep being read, paid and reported through the unchanged code. An empty `pricing_snapshot` simply means "made before Stage D".

## 8. Payment and instalment regressions

- All existing payment, instalment, webhook, bank-transfer, reminder and Paystack tests pass (in `phase3` to `phase6`, `lms1`, `lms4` and others; 23 payment-related tests in total). The Stage D.1 webhook test passes too.
- Charge currency and amounts are unchanged.
- The Google Sheet structure is unchanged: no new fields are posted, and `FEES` is unchanged.

## 9. Remaining limitations

1. **Older pages without a key:** a browser running a cached old page sends no idempotency key and gets no de-duplication, as before. Once deployed, every new checkout page sends one.
2. **Simultaneous replays of a saved-but-unpaid order** could, in a very narrow race, start two Paystack initialisations. Only the first is stored and reused afterwards, and at most one of them can be paid, because the webhook records an instalment once.
3. **Admin admissions** charge the local naira tuition (existing behaviour). For an international resident on a programme with a dollar price, the snapshot records that the rule would have given international tuition. Whether admins may admit at the local price is part of the open international-charging decision.
4. **Deploy order:** a Worker deployed before migrations 0012 and 0013 refuses registrations (503) until they are applied. That is the safe failure, but the production runbook must apply migrations first.
5. **The legacy inline Paystack path** (used only when the Worker backend is unavailable) creates no server order and is outside this change, as before.

## 10. Residence verification: options for a future owner decision (nothing implemented)

Today:
- the declared country of residence decides;
- the network country is recorded on the order;
- a mismatch is stored in the snapshot (`country.mismatch`);
- no passport, document, identity check or blocking exists, and none was added.

| Option | What it means | Implications |
|---|---|---|
| A. Rely on the declaration (current) | Students state their residence | Simple and fair to travellers and VPN users. An international student could choose Nigeria to get the local price; this matters only once international prices are published. |
| B. Declaration plus a terms clause | The registration terms state that tuition follows the actual residence and that the Academy may correct it | No added friction; a legal basis to correct a wrong tier afterwards. Needs updated terms text. |
| C. Mismatch flag for Admissions review | Orders where the declared country and the network country differ are listed for review; nothing is blocked | Low friction; uses data already stored. False positives from VPNs and travel; staff time. |
| D. Light confirmation on mismatch | Only on a mismatch, the student ticks "I confirm I live in X" | Small friction, creates a record. Not proof. |
| E. Evidence on request | Only for flagged cases, Admissions may ask for proof of address | Strongest, but intrusive and costly; personal-data handling and retention would need a policy. |

**Smallest viable step:** B plus C. Both use data already captured, and neither blocks anyone.

International pricing is **not** published or activated by this correction.

## 11. Confirmation

- No production deployment, migration, DNS or settings change; no production data change.
- No country rule, tuition, FX policy or charge currency changed. No draft published.
- No real payment or email: everything was mocked.
- Migrations 0012 and 0013 were applied only to local test databases.

**Stage E has not been started.** Stage D.1 stops here for owner review.

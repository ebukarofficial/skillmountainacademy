# Skill Mountain Academy — Stage D.1.1 Report
## Payment initialisation concurrency, legacy checkout protection and admin pricing integrity

Date: 28 November 2026 · Status: implemented locally and ready for owner review · Stage E has not been started.

**Summary.** Three gaps are closed:

| Gap | What changed |
|---|---|
| Opening a Paystack checkout | Now goes through a **durable claim in D1**. Only one request per instalment can ever call Paystack. Any outcome that is not clear-cut is held for Finance to reconcile; a second attempt is never made automatically. |
| Browser-only Paystack popup | **Removed.** Without the server, checkout stops with a clear message. Every Paystack checkout is opened by one server function. |
| Admin admissions | They record the tuition decision **actually** approved and the amount **actually** payable. An admission that would need international tuition is refused, because no pricing exception or international charging exists to record it honestly. |

---

## 1. Root causes

1. **Two retries at the same moment.** Stage D.1 stored the Paystack checkout on the order (`orders.payment_init`) only *after* calling Paystack, so nothing stopped two simultaneous retries from both calling it. Each call also used a **random** reference suffix (`randomCode(4)`). Any failure — including a timeout after Paystack had in fact created a checkout — was reported as "could not start", inviting a fresh attempt. Signed payment links for parts 2 and 3 (`/api/pay`) called Paystack directly, with no claim at all.
2. **Legacy inline path.** When `/api/status` did not report the backend as ready, `app/checkout/flow.tsx` fell back to the original browser flow:
   - it posted the application to the Google Form and Sheet;
   - it opened `PaystackPop` with an amount the browser computed (`prog.price * 100`), verified afterwards only by the Sheet.

   This created no server order and no pricing snapshot. The inline script was loaded on the checkout page and the programme pages.
3. **Admin admission.** `admit.ts` built the snapshot from the country-rule quote and **forced `charge.available = true`**. For an international resident on a programme with a dollar price, the record could therefore say "international tuition (USD)" while the order charged the local naira tuition.

## 2. Files

**Inspected**
- Payments: `src/server/routes/payments.ts`, covering initialisation, webhook, `recordCharge`, verification, the order-status route and `/api/pay` links.
- Registration and data: `src/server/routes/register.ts`, `src/server/repo.ts`.
- Pricing: `src/server/pricing-rules.ts`, `src/server/pricing.ts`.
- Admin admissions: `src/server/lms/routes/admit.ts`.
- Client: `app/checkout/flow.tsx`, `app/checkout/server-pay.tsx`, `app/checkout/page.tsx`, `app/programmes/[slug]/enrol.tsx`, `lib/config.ts` (`CFG.paystackKey`).
- Google Sheet integration: `docs/google-sheet-script.gs`.
- Tooling: the migration scripts.
- Paystack's official API reference (Transaction: initialize and verify).

**Created**

| File | Purpose |
|---|---|
| `migrations/0014_payment_attempts.sql` | Attempt table and the one-active-attempt unique index (section 3) |
| `src/server/lms/routes/payment-attempts.ts` | Finance reconciliation: list, check, release |
| `tests/stageD11-payments.test.ts` | 14 tests |
| `docs/EXPANSION_STAGE_D11_REPORT.md` | This report |

**Modified**

| File | Change |
|---|---|
| `src/server/routes/payments.ts` | `startPayment` replaced by `initiatePayment()`: claim, deterministic reference, outcome classification, timeout. Also new: `verifyReference()`. `/api/pay` now uses the claim. `verifyWithPaystack` is exported. |
| `src/server/repo.ts` | Attempt methods: `activeAttempt`, `nextAttemptNo`, `claimAttempt`, `moveAttempt` (compare-and-set), `listAttempts`, `getAttempt`, `paymentIntegrity`. `orderIntegritySupported` also requires 0014. `savePaymentInit` removed. |
| `src/server/routes/register.ts` | Part 1 and replays use `initiatePayment()` |
| `src/server/pricing-rules.ts` | The snapshot gains `decision` (basis, approver, exception = null, payable amount); the validator gains decision and admission-consistency rules; new presentation `admin_recorded_naira` |
| `src/server/lms/routes/admit.ts` | Accurate decision, or refusal; prices from the published catalogue |
| `src/server/lms/routes/pricing.ts` | Diagnostics count uncertain attempts and orders whose payment never started |
| `src/server/lms/permissions.ts`, `src/server/lms/index.ts` | 3 Finance routes |
| `app/checkout/flow.tsx` | Browser Paystack, Google Form and Sheet submission removed; "temporarily unavailable" panel with Try again and Admissions contacts |
| `app/checkout/server-pay.tsx` | `useBackend()` can re-check |
| `app/checkout/page.tsx`, `app/programmes/[slug]/enrol.tsx` | Paystack inline script no longer loaded |
| `src/server/schema-version.ts` | `EXPECTED_MIGRATION` is now 0014 |
| `db/schema.expected.json` | Regenerated |
| `scripts/db/rollback.mts`, `scripts/db/classification.mts`, `scripts/db/anonymise.mts` | 0014 entries |
| `docs/lms/API.md` | Regenerated |

**Tests changed, each because the owner's directive changed the behaviour they asserted:**

| Test file | Change |
|---|---|
| `phase6` | It asserted the popup fallback was kept. It now asserts the fallback is absent and the unavailable panel exists. |
| `phase4` | It asserted the currency note in the removed legacy step. It now asserts the unavailable panel. |
| `stageD1-integrity` | The checkout is now read from `payment_attempts`. Its "payment could not start" mock now returns a **definite** refusal (400): a 5xx is now treated as uncertain and correctly does *not* allow an automatic retry. The snapshot fixture gains `decision`. |
| `phase9` | Worker bundle budget raised from 300 to 320 KiB (now 306 KiB, against Cloudflare's 3 MiB Free-plan limit) to fit Stages B to D.1.1 |
| Migration tooling: `stageB-catalogue`, `stageD-pricing`, `db-preflight`, `db-recovery`, `db-gate`, `stage3c-staging`, `stage3b-gates` | 0014 added to the lists; future-migration placeholders renamed to 0015 |

## 3. Payment-initialisation state model and concurrency strategy

**Why a new table.** `orders.payment_init` holds one JSON value per order. It has no state, cannot cover instalments 2 and 3, and cannot be claimed atomically. `payment_attempts` keeps one row per attempt per instalment. A **partial unique index** allows only one active attempt per instalment: `UNIQUE (instalment_id) WHERE state IN ('claimed','initialized','uncertain')`.

**States**

| State | Meaning | What a retry does |
|---|---|---|
| `claimed` | A request owns the attempt and is calling Paystack | Waits (`409 payment_in_progress`). After 120 s with no result, the attempt becomes `uncertain`. |
| `initialized` | Paystack returned a checkout (reference, address and access code stored) | Reuses the stored checkout |
| `failed` | Paystack **definitely** refused (HTTP 4xx, `status:false`, not a duplicate): no transaction exists | Opens a new attempt with the next reference |
| `uncertain` | Timeout, network error, 5xx, unreadable answer, "Duplicate Transaction Reference", an expired claim, or a failed write after success | **Never** retried automatically (`409 payment_needs_check`); Finance reconciles |
| `released` | Finance checked an uncertain attempt and released it, with a reason | Opens a new attempt |

**Algorithm (`initiatePayment()`)**
1. Checks before anything else: Paystack is configured; the instalment is not paid; the schema supports attempts; the order has its pricing record (section 6).
2. If an active attempt exists: reuse it (`initialized`), wait (recent `claimed`), or refuse (`uncertain` or stale `claimed`).
3. Otherwise **claim**: a single `INSERT` of a `claimed` row with the deterministic reference `<instalment reference>-A001`, `-A002` and so on. The unique index makes this atomic; a request that loses gets the winner's state and never calls Paystack. The new references keep the webhook's existing reference format, so payments are matched exactly as before.
4. Call Paystack (`/transaction/initialize`, NGN, the instalment's amount, 20 s timeout), then classify the outcome.
5. Store the result with a compare-and-set (`UPDATE … WHERE state = 'claimed'`).
   - **If storing fails after Paystack succeeded**, the valid checkout is still returned. The attempt stays `claimed`, turns `uncertain` after 120 s, and is reconciled. A failed write is never read as a Paystack failure.

**Paystack idempotency.** Paystack's official API reference documents **no idempotency header**. It says only that the reference must be a "Unique transaction reference", and it does not document the answer for a reused reference or for verifying an unknown one. So:
- correctness rests on the durable D1 claim;
- the deterministic reference is only an extra safeguard;
- a "duplicate reference" answer is treated as uncertain;
- a Verify answer other than a clear success is treated as **"not confirmed"**, never as "absent".

**Guarantee, stated precisely.** For a given instalment, at most one request calls Paystack while an attempt is claimed, initialised or uncertain. A new Paystack call happens only after a definite refusal, or after Finance releases an uncertain attempt. This is tested for simultaneous requests, replays during initialisation, an expired claim, and a failed write after success. It does not stop Finance from deliberately releasing an attempt that Paystack had actually created; the release procedure (section 4) guards against that.

## 4. Recovering uncertain Paystack outcomes without duplicates

**Student side**
- The order stays saved, with its pricing record.
- The student is told: "We could not confirm whether your Paystack payment page was opened. To make sure you are never charged twice, our team is checking it. Please try again in a few minutes, pay by bank transfer, or contact Admissions."
- Retries do not call Paystack.

**Finance side** (permission area `finance`):
- `GET /api/app/admin/payments/attempts` lists uncertain, stale and failed attempts with their order, instalment and amount.
- `POST …/:id/check` is a read-only Verify. If Paystack reports **success**, the payment is recorded through the existing idempotent `recordCharge` path. Audited.
- `POST …/:id/release {reason, confirmedWithPaystack}` needs the **authenticator code**. It is refused if:
  - the attempt is still in progress;
  - the instalment is paid;
  - Paystack reports success (the payment is recorded instead).

  When Paystack cannot confirm the reference, Finance must confirm they checked it in the Paystack dashboard. The release, with its reason, is audited. The student's next retry then opens a new attempt.
- Finance's diagnostics show `attempts_uncertain` and `paystack_not_started`.
- **Rollback check** `payment_attempts_open`: resolve open attempts before rolling back, because an older Worker would ignore the claims.

## 5. Every Paystack initialisation is server-controlled

A code search finds `transaction/initialize` in exactly **one** file, `src/server/routes/payments.ts`, inside `initiatePayment()`. It is reached only from:

| Route | Payment |
|---|---|
| `POST /api/register` | Part 1, and replays |
| `GET /api/pay` | Signed links for parts 2 and 3 |

Both go through the claim. Admin admissions start no Paystack payment (bank transfer only, recorded by Finance).

There is no `PaystackPop`, inline script or client-side `initialize` anywhere in `app/` or `lib/` (tested), and the built pages no longer load `js.paystack.co`. The public key setting in `CFG` is now unused by the client.

## 6. Legacy fallback behaviour

**When the backend is unavailable** — `/api/status` unreachable, no database, Turnstile not configured, or no site key — the payment step shows **"Checkout is temporarily unavailable"**:
- nothing was charged and no registration was created;
- the details are kept in the browser tab;
- **Try again** re-checks the server;
- Admissions can be reached by email or WhatsApp.

Nothing is posted to Paystack, the Google Form or the Sheet.

**Unchanged:**
- **Bank transfer** through the server, which creates an order with its pricing record.
- **Admissions-assisted admission**: an offline payment is recorded by Admissions through `/api/app/admin/admit`.
- **Retries** keep reusing the same order (idempotency key) and the same checkout.

**No pricing record, no payment.** `initiatePayment()` refuses (`409 payment_blocked`) an order that has no pricing snapshot and was created **after** the first order that has one, because such an order was made outside the integrity path. Historical orders, made before Stage D, keep their instalment links (tested).

**Deploy prerequisite.** `/api/status` must report the database and Turnstile as ready, and the site key must be set. Otherwise production checkout shows this panel instead of falling back. Previously it would have silently used the inline popup.

## 7. Admin admission: actual tuition decision

The rules:
- An admission records the amount actually payable, the local naira tuition.
- The record must say exactly that:
  - `decision.basis` is `local_tuition` (Nigerian resident) or `naira_tuition_no_international_price` (the programme has no dollar price, so naira tuition applies to everyone, as online);
  - `decision.approvedBy` is the admin;
  - `decision.exception` is `null`, because there is no exception policy;
  - `decision.payableNaira` is the charge.
- If the approved country rules would apply **international tuition** — a programme with a dollar price, with a residence outside Nigeria or no residence given — the admission is **refused** (`409 admission_pricing_not_permitted`) and nothing is saved.
- The validator also rejects any admission record claiming non-naira tuition, or a tier that differs from what is charged.

**Example A: Nigerian resident, Cloud Engineering**

```json
{ "flow": "admin_admission", "tier": "local", "country": { "source": "residence", "residence": "NG" },
  "tuition": { "currency": "NGN", "minor": 45000000, "status": "set" },
  "display": { "kind": "admin_recorded_naira", "currency": "NGN", "totalMinor": 45000000 },
  "charge": { "provider": "Paystack", "currency": "NGN", "totalNaira": 450000, "partsNaira": [450000] },
  "catalogue": { "localNaira": 450000, "internationalUsdCents": null, "appliedNaira": 450000 },
  "decision": { "basis": "local_tuition", "approvedBy": "<admin id>", "exception": null, "payableNaira": 450000 } }
```

**Example B: US resident, Cloud Engineering (no international price set)**

```json
{ "flow": "admin_admission", "tier": "international_legacy_ngn", "country": { "residence": "US" },
  "tuition": { "currency": "NGN", "minor": 45000000 }, "display": { "kind": "admin_recorded_naira", "currency": "NGN" },
  "decision": { "basis": "naira_tuition_no_international_price", "approvedBy": "<admin id>", "exception": null, "payableNaira": 450000 } }
```

**Example C: Python, test-only programme with US$1,050**

| Residence | Result |
|---|---|
| US | `409 admission_pricing_not_permitted`; nothing saved |
| None given | Refused, because it cannot be told which tuition applies |
| Nigeria | Admitted at the local ₦850,000, `basis: local_tuition`, with `internationalUsdCents: 105000` recorded for reference only |

## 8. Tests (commands run, 28 Nov 2026)

`tests/stageD11-payments.test.ts`: **14 of 14 pass.**

| # (brief) | Test |
|---|---|
| 5 | Confirmed success: one Paystack call; three retries reuse the same checkout; attempt `A001 initialized` |
| 1, 2 | Two simultaneous initialisations for a saved order: the claim owner (held inside a gated Paystack mock) is the only caller; concurrent requests and a replay get `409 payment_in_progress`; afterwards everyone reuses the checkout; one Paystack call |
| 3 | Paystack success but the result cannot be stored (database trigger): the checkout is still returned; a retry waits; after the claim expires the attempt becomes `uncertain`; still one Paystack call |
| 4 | Network error, 5xx and "Duplicate Transaction Reference": the order is saved with its snapshot; the attempt is `uncertain`; retries make no new call |
| 6 | Definite refusal leads to a new attempt (`A001 failed`, `A002 initialized`). Uncertain leads to Finance: release refused without a reason or without Paystack confirmation, then released and the new attempt opened; audited |
| 6 | A Paystack-reported success found during a check is recorded (instalment paid) and can never be released |
| — | Permissions: an email-only session cannot release; anonymous requests get 401 |
| 7 | No browser-only payment: no `PaystackPop`, inline script or `initialize` in `app/` or `lib/`; the unavailable panel exists and submits nothing; `initialize` exists only in `src/server/routes/payments.ts` |
| 8, 11 | An order created after Stage D without a snapshot: the pay link is refused with no Paystack call. A historical instalment link still opens a checkout through the claim |
| 9 | Admin admission, Nigerian and US residents on a programme without a dollar price: decision, approver, tuition in NGN, payable amount, tier and residence recorded exactly |
| 10 | Admin admission on a programme with international tuition: US resident and no residence refused with nothing saved; Nigerian resident admitted at the local price |
| — | The validator rejects an admission record claiming international tuition while charging naira |
| 11 | The webhook pays part 1 using the new `-A001` reference (parts 2 and 3 due); bank transfer makes no Paystack call |
| 12 | Concurrent registration replay creates one order |

**Full checks**

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx tsc --noEmit -p src/tsconfig.json` | PASS |
| `npx eslint` | PASS |
| `npm run db:check` | PASS (14 files; the standing 0007 and 0011 owner notes) |
| `node --test` (39 files, in two halves) | **367 of 368 pass** (146/146 and 221/222) |
| `npm run build` | PASS |
| Before/after build text comparison | 31 pages, none with different visible text |
| Built pages | No `js.paystack.co` script |
| `npm run security:csp` | PASS (30 pages, report mode) |
| `npm run security:secrets` | PASS |
| `npm audit` | 0 vulnerabilities |
| `npm run sheet:fees -- --check` | PASS |
| Browser check | With the local backend not ready (no Turnstile key), the payment step shows "Checkout is temporarily unavailable", makes **no Paystack request**, and has no script errors |

**The one failure is the pre-existing `3B.1: staging configuration … account_id is not pinned`**, from the security workstream. It was left unchanged.

## 9. Historical compatibility and payment regressions

- 0014 only adds a table and indexes; no existing row changes.
- Historical orders keep their links, payments and reports. Their instalments go through the claim from now on (tested).
- The webhook and `recordCharge` are unchanged, and old random-suffix references still match.
- Instalments, bank transfers, reminders and links all pass their existing tests, and the charge is still NGN.
- `orders.payment_init` (0013) is no longer written. It stays empty and harmless.

## 10. Remaining limitations and owner decisions

**Limitations**
1. **Releasing an attempt is a human decision.** Paystack does not document how Verify answers for a reference it never created, so the system cannot prove an uncertain attempt is absent; Finance confirms in the Paystack dashboard. An orphaned checkout the student never received can still exist at Paystack, but it cannot be paid by anyone.
2. **The claim window (120 s)** is a fixed technical value, longer than the 20 s Paystack timeout. If a Worker dies mid-call, the student waits up to 2 minutes before the attempt is marked uncertain.
3. **Checkout now depends on the backend being ready** (database plus Turnstile). This is a deploy prerequisite: there is no fallback any more.
4. **Bundle budget.** The test budget was raised from 300 to 320 KiB, against Cloudflare's 3 MiB Free-plan limit.
5. **Admin admissions for international tuition** are refused until the owner decides international charging and pricing exceptions.

**Owner decisions**
1. Whether admins may ever admit an international resident at the local price. That would need an explicit exception policy: who approves, and the reason required.
2. The international charging policy (open since Stage D).
3. Who in Finance may release uncertain payment attempts. Today any Finance-capable administrator can, with the authenticator code.

## 11. Confirmation

- No production deployment, migration, DNS or settings change; no production data change.
- No real payment: Paystack was mocked in every test.
- No country rule, tuition, FX policy or charge currency changed. No draft published; the Python programme exists only inside one isolated test database.
- Migrations 0012 to 0014 were applied only to local test databases and a local `/tmp` database used for the browser check.

**Stage E has not been started.** Stage D.1.1 stops here for owner review.

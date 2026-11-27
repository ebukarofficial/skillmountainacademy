# Skill Mountain Academy — Expansion Stage D Report
## Country-based tuition, currency display and pricing integrity

Date: 28 November 2026 · Status: implemented locally and ready for owner review · Stage E has not been started.

---

## 1. Executive summary

The server now decides every tuition currency and amount from the student's validated country of residence. A currency sent by the browser is ignored everywhere, and visitors can no longer pick a display currency themselves.

The approved country rules are applied in one server module. The local naira tuition and the international dollar tuition stay strictly separate. Every new order stores a snapshot of the pricing used, in additive migration **0012**; older orders are untouched.

What visitors and students see today has not changed:
- The nine live programmes have **no international price**. They keep today's behaviour: naira tuition, charged in naira, with any dollar, pound or euro figure shown as a labelled guide converted from the naira amount.
- Pound and euro **tuition** is shown only under an owner-approved exchange-rate policy. That policy is now configurable, and inactive.
- **Paying international tuition online is not available.** Paystack charges naira and no conversion for charging is approved, so a registration that would need it is refused, with a clear message, before anything is saved or charged.

None of this changes any current customer's price.

## 2. What the inspection found (pricing and checkout before Stage D)

**Country and currency**

| Step | Before Stage D |
|---|---|
| Country | `GET /api/geo` returned Cloudflare's `request.cf.country` without validation. The browser fell back to a time-zone or locale guess. The student's **Country of residence** select (application form and programme page) was stored in `localStorage` and sent as a country *name*. |
| Currency | `lib/pricing.ts` `currencyForCountry()` already matched the approved table: NG gives NGN, US gives USD, GB gives GBP, eurozone gives EUR, everything else (Canada and the rest of Africa included) gives USD. **However**, the browser kept a separate `sma-currency` choice that could override the country (`setCurrency`, `CurrencySwitcher`; the switcher was not on any page, but the override was still honoured). |
| Quote | `GET /api/quote` took the browser's `?country=` with only a two-letter format check, and fell back to `cf.country`. |
| Registration | `POST /api/register` **stored a browser-sent `currency`** in `orders.display_currency`, together with an FX rate (R-03). |

**Display and charging**

- **Every non-naira figure was a conversion of the naira price**, shown as an "≈" guide. Nothing used `price_usd_cents`; the Stage B international tuition was not wired into pricing.
- Programme listing cards show no price. The detail page shows the server quote. Checkout shows the naira total, with a guide line underneath.
- **Paystack always charges NGN.** The server computes the amount from the catalogue and the hold cookie and never uses a browser amount. Both payment paths charge naira:
  - the server path, `startPayment` with `currency: "NGN"`;
  - the legacy inline path, `PaystackPop` with `currency: "NGN"`, verified by the Google Sheet against `FEES`.

**Exchange rates**

| Aspect | Finding |
|---|---|
| Sources | ExchangeRate-API's open endpoint (`open.er-api.com`, no key, attribution shown). Fallback: the CC0 `currency-api` feed on jsDelivr. |
| Refresh | Daily at **05:00 and 17:00 UTC** (`src/server/cron.ts`, still in use), plus one attempt on first visit when no rates are cached. |
| Storage | KV key `fx:NGN`. Rates are stored as units per 1 NGN, with `fetchedAt` and `source`. |
| Validation | Every rate must be a number between 0 and 1. |
| Failure handling | When every source fails, the last rates are kept indefinitely. No maximum age is enforced. |
| Stage B cross rate | `internationalAmount()` computes GBP as USD × (GBP per NGN ÷ USD per NGN). The maths is **correct**. Its whole-unit rounding and use of rates of any age were **not approved policy**. It fed only the Stage B admin preview, and it has been replaced (section 6). |
| Credentials | None (open endpoints). Nothing to expose. |

**Stage B and C checks:** the lifecycle and admissions checks run before any pricing, as reported. No issue was found.

## 3. Files

**New**

| File | Purpose |
|---|---|
| `src/server/pricing-rules.ts` | Pure rules: ISO country validation, country resolution order, FX policy type and freshness check, `quoteTuition()`, order snapshot |
| `src/server/pricing.ts` | Storage and request helpers: FX policy in `app_settings`, network country, matching a country name on the server, writing the order snapshot |
| `src/server/lms/routes/pricing.ts` | `GET /api/app/admin/pricing/diagnostics` (finance) and `PUT /api/app/owner/fx-policy` (owner) |
| `migrations/0012_pricing_snapshot.sql` | Pricing-snapshot columns on `orders` (section 10) |
| `tests/stageD-pricing.test.ts` | 12 Stage D tests |
| `docs/EXPANSION_STAGE_D_REPORT.md` | This report |

**Modified**

| File | Change |
|---|---|
| `lib/pricing.ts` | `tierForCountry`; rounding policies; `crossConvertMinor` (exact integer cross rate); `splitMinor`; `moneyMinor` |
| `lib/config.ts`, `src/server/catalogue.ts` | Programmes carry `priceUsdCents` from the published catalogue |
| `src/server/routes/geo.ts` | `/api/geo` validates `cf.country`. `/api/quote` is rebuilt on `quoteTuition()`: invalid countries are refused, and the presentation is returned separately from the charge. Existing response fields are kept. |
| `src/server/routes/register.ts` | Browser currency ignored; residence country validated (ISO code, or the name as a fallback); the quote is computed on the server; international tuition is refused while it cannot be charged; snapshot written |
| `app/currency.tsx` | Currency comes only from the country: the override, `setCurrency` and `CurrencySwitcher` are removed, and an old `sma-currency` value is cleared. The country select sends the ISO code in a hidden field. The quote figure and labels follow the presentation type. |
| `app/checkout/server-pay.tsx` | No currency sent; quote figures and labels; international tuition shows its amount, says it cannot be paid online, and does not submit |
| `app/checkout/flow.tsx` | The new `countryCode` field is kept out of the Google Sheet post, so the sheet's columns are unchanged |
| `src/server/lms/permissions.ts`, `src/server/lms/index.ts` | 2 routes registered |
| `src/server/schema-version.ts` | `EXPECTED_MIGRATION` is now `0012_pricing_snapshot.sql` |
| `db/schema.expected.json` | Regenerated |
| `scripts/db/rollback.mts`, `scripts/db/anonymise.mts` | 0012 entries |
| `docs/lms/API.md` | Regenerated |

**Tests adjusted.** None was weakened.

| Test file | Change |
|---|---|
| `phase4` acceptance 6 | It relied on the browser currency being trusted, which is the behaviour the owner ruled out. It now sends a contradicting browser currency (GBP) with a US residence and expects USD. This is stronger than before. |
| `stageB-catalogue` | The list of pending migrations now includes 0012 |
| `db-gate`, `db-preflight`, `stage3b-gates` | The hypothetical future migration is renamed from 0012 to 0013 |
| `db-preflight`, `db-recovery`, `stage3c-staging` | 0012 is added to the pending, rehearsal and backup expectations. `orders` is allowed to gain columns with the same row count. |

## 4. Country-to-currency mapping implemented

`currencyForCountry()` (unchanged) together with `tierForCountry()`:

| Residence | Tuition currency | Tier |
|---|---|---|
| NG | NGN | local |
| US | USD | international |
| GB | GBP | international |
| Eurozone¹ | EUR | international |
| CA | USD | international |
| Rest of Africa (GH, ZA, KE, EG, …) | USD | international |
| Every other country | USD | international |
| No valid country | USD | international |

¹ The euro list is AT, BE, BG, HR, CY, EE, FI, FR, DE, GR, IE, IT, LV, LT, LU, MT, NL, PT, SK, SI and ES, plus AD, MC, SM, VA, ME and XK. That is the 21 euro-area members, the four microstates with monetary agreements, and Montenegro and Kosovo, which use the euro without an agreement. **Including the last two is an owner decision** (section 15).

There is no CAD and no other currency. Nationality is never collected or used.

## 5. Local tuition kept separate from international tuition

| Tier | Price used | Rule |
|---|---|---|
| Local (NG) | `price_kobo` (shown as whole naira) | Never touched by `price_usd_cents`. A test shows that changing the dollar price changes nothing for a Nigerian resident. |
| International, programme has `price_usd_cents` | The dollar benchmark, exactly, in cents | Instalments are split in cents and add up exactly. |
| International, no `price_usd_cents` (all nine live programmes) | The naira tuition, charged in naira | Recorded as tier `international_legacy_ngn`. Shown as "Guide only: the naira tuition converted …", never as international tuition. |

- No field is ever overwritten with another currency's value.
- The nine live prices are unchanged (tested).
- The 21 drafts remain unpublished. One draft (Python) is published **only inside the isolated test database**, to exercise the international path. Nothing was published locally or anywhere else.
- No NGN price was invented.

## 6. Pounds and euros

**The policy mechanism is built and inactive.**

- `PUT /api/app/owner/fx-policy` is owner-only, needs the authenticator code, and is audited as `owner.fx_policy`. It stores:
  - `status`: not_approved or approved;
  - `sources`: chosen from the existing feed (`open.er-api.com`, `currency-api (jsDelivr)`);
  - `maxAgeHours`: 1 to 720;
  - `rounding`: `nearest_whole`, `up_whole` or `nearest_cent`.
- An "approved" policy is accepted only when it is complete. Until it is approved, everything is treated as not approved.

**Calculation.** `crossConvertMinor(usdCents, GBP|EUR, rates, rounding)` = usdCents × (rate[GBP or EUR per NGN] ÷ rate[USD per NGN]), in integer minor units, with the chosen rounding. In other words, GBP per USD comes from the same feed.

**When a pound or euro figure is used.** Only when all of these hold:
- the policy is approved;
- the rate's source is on the approved list;
- the rate is no older than `maxAgeHours`;
- the rates are valid.

Otherwise the **dollar benchmark** is shown, with the reason (`policy_not_approved`, `no_rates`, `source_not_approved` or `stale`). No arbitrary rate is used.

**Diagnostics.** `GET /api/app/admin/pricing/diagnostics` (Finance) shows the policy, the rate source, time and age, the cross rates, and the per-programme GBP and EUR figures when the policy allows them. The quote and the order snapshot also record the source, timestamp, rate, calculation and rounding.

**The existing naira guide** for the nine live programmes is unchanged: naira × rate, nearest whole unit, dated, labelled as a guide. It is still shown when rates exist, whatever their age, as today, and the rate's date is always shown beside it. Whether a maximum age should also apply to this guide is part of the open FX decision.

## 7. Country of residence and network location

1. **The declared country of residence decides.** The application form already collects it. It is now sent as an ISO code (hidden field) and checked against the ISO 3166-1 list in `lib/countries.ts`. Older pages that send only the name are matched on the server. An invalid code is refused with 400.
2. **Cloudflare's `cf.country`** (validated, so placeholder codes such as `T1` and `XX` are rejected) is used **only when there is no valid residence country**, for example on a programme page before the student has chosen one.
3. With neither, the currency is USD (the "every other country" rule).
4. A residence/network mismatch is **recorded** on the order (`country.mismatch` in the snapshot, and both `residence_country` and `ip_country`). It is **not** used to override the student's choice.

This is the precedence the site already used for quotes, so no customer's pricing changes. Whether a mismatch should trigger anything (review, evidence of residence) is an owner decision. A student cannot choose a currency separately from their country.

## 8. Protection against browser manipulation

- A `currency` field in a registration is ignored (tested with a contradicting value), and so is any `currency=` parameter on a quote.
- The amount comes from the published catalogue on the server, plus the hold cookie that the server verifies. Browser amounts were already ignored.
- Countries are validated against the ISO list on the server.
- The removed display override means the page always reflects the country rule.
- International tuition that cannot be charged is refused on the server, not just hidden in the browser.

## 9. Quotes, orders and the charge

| Concept | Where it is held |
|---|---|
| Country of residence | `orders.residence_country`; also the existing `registrations.country` (name) |
| Network country | `orders.ip_country` |
| Tuition tier | `orders.pricing_tier`: `local`, `international` or `international_legacy_ngn` |
| Tuition that applied | `orders.tuition_currency` + `orders.tuition_minor`. Legacy international orders have NGN here, the naira tuition. |
| Displayed amount | Quote `display` (kind, currency, minor units, note); `orders.display_currency`. For a guide, `orders.fx_rate` / `fx_at`, as before. |
| Charged amount and currency | `orders.total_kobo` and instalments (unchanged), plus `orders.charge_currency` = `NGN` |
| Full record | `orders.pricing_snapshot` (JSON): country resolution, tier, tuition, presentation, charge, catalogue prices (local and international), and FX details |

- The checkout keeps stating plainly that **Paystack charges in naira**. Guide amounts carry "≈" and the words "guide" and "charged in naira".
- International tuition (never shown for current programmes) states that it cannot be paid online yet.
- No surcharge, markup or fee was added. Instalments are unchanged.

**Mismatch to resolve before international charging.** The approved table says GBP, EUR and USD are the international tuition currencies, but the only provider charges NGN. Before any international-priced programme can take international students online, the owner must decide:
- the charging currency and provider;
- whether to convert, and with what rate;
- who bears the bank's FX differences;
- the refund currency.

Until then, the Admissions "admit" route (offline) is the only route for such students.

## 10. Database

**Migration 0012 is needed.** The existing `orders` columns (`display_currency`, `fx_rate`, `fx_at`) cannot record the country, tier, tuition currency and amount, or the charge currency.

- **Changes:** 7 nullable columns added to `orders`. Purely additive: no backfill, no UPDATE, no index.
- **Historical orders:** untouched. A test applies 0012 over existing orders and shows every amount and currency field identical, with the new columns NULL.
- **Writing:** a best-effort UPDATE after the order is created, so on an older database the order is exactly as before.
- **Tooling:** schema expectations, COMPAT (`olderWorker: "safe"`), the anonymiser and `EXPECTED_MIGRATION` are updated. `db:check` passes. No owner review entry is required, because the migration has no data statements.
- **Rollback:** safe. An older Worker ignores the new columns and still charges NGN from `total_kobo`; to undo, restore the backup taken before 0012.
- **Not applied anywhere remote.** 0010 was not modified, and 0001 to 0011 are unchanged.

## 11. Google Sheets

- The Apps Script `FEES` is **naira-only**, keyed by programme name. It is used for application checks, its own bank-transfer emails, and checking legacy inline Paystack payments, all in kobo.
- Nothing in Stage D changes what is charged, so its checks remain correct. The new `countryCode` field is kept out of its post so its columns are unchanged.
- `npm run sheet:fees -- --check` passes.
- **Manual step still required:** when a programme's naira price or name changes, paste the generated block into the deployed Apps Script.
- The sheet has no notion of international tuition. If online international charging is ever approved, it will need a decision too.

## 12. Security and permissions

| Route | Access |
|---|---|
| `GET /api/app/admin/pricing/diagnostics` | `finance` area (Finance, Super Administrators) |
| `PUT /api/app/owner/fx-policy` | `owner` area, plus the authenticator code |

- Both are registered under default-deny (tested).
- No existing grant was widened.
- The existing same-origin (CSRF) check applies.
- No secrets exist for the rate feeds.
- Catalogue prices are still changed only through the Stage B owner publication.
- Policy changes are audited.

## 13. Tests (commands run, 28 Nov 2026)

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx tsc --noEmit -p src/tsconfig.json` | PASS |
| `npx eslint` | PASS |
| `npm run db:check` | PASS (12 files; the standing 0007 and 0011 owner notes) |
| `node --test` (37 files, in two halves) | **343 of 344 pass** (134/134 and 209/210), including the 12 new Stage D tests and all Stage B and C tests |
| `npm run build` | PASS: the catalogue export fell back to the seed list, as expected offline |
| Before/after build text comparison | 31 pages, none with different text |
| `npm run security:csp` | PASS (30 pages, report mode) |
| `npm run security:secrets` | PASS |
| `npm audit` | 0 vulnerabilities |
| `npm run sheet:fees -- --check` | PASS |

The Stage D tests cover:
- **Mapping:** NG, US, GB, DE, FR, IE, NL, ES, HR, CA, GH, ZA, KE, EG, JP, IN, AU, BR, CH and AE.
- **Country handling:** ISO validation and resolution order.
- **Pricing integrity:** local price independent of USD, exact USD, cross rate and the three rounding modes, and stale, missing, invalid and unapproved-source rates.
- **Legacy behaviour:** the existing naira guide for programmes without an international price.
- **Through the Worker:**
  - quotes by country, invalid countries, and an ignored `currency` parameter;
  - registration snapshot, browser currency ignored, invalid country refused, name-only fallback;
  - historical orders untouched by 0012;
  - an international-priced programme: Nigeria pays the local price, while a US resident sees the exact USD tuition and is refused online payment with nothing saved;
  - FX policy rights, and policy-approved GBP turning into a USD fallback once the rate is stale;
  - permissions.

**The one failure is the pre-existing `3B.1: staging configuration … account_id is not pinned`**, from the security workstream. It was left unchanged and is not a Stage D failure.

## 14. Browser and visual verification

Run in a local `wrangler dev` session with a local D1 (0012 applied) and test rates in local KV. Cloud Engineering is shown at 1280 px; Ghana also at 390 px.

| Residence | Detail page main figure | Checkout charge line |
|---|---|---|
| Nigeria | ₦450,000 | "Paystack will charge ₦450,000 in naira (NGN)." |
| United States | ≈ US$311, labelled "Guide amount … converted from the naira tuition … charged in naira by Paystack" | ₦450,000 in naira, "≈ US$311 at today's rate" |
| United Kingdom | ≈ £234 (same label) | ₦450,000, ≈ £234 |
| Germany | ≈ €270 | ₦450,000, ≈ €270 |
| Canada | ≈ US$311 | ₦450,000, ≈ US$311 |
| Ghana (mobile) | ≈ US$311 | ₦450,000, ≈ US$311; layout unchanged |

- No script errors.
- A saved "EUR" override from an older visit was ignored and cleared.
- Listing cards show no price, as before, so there is no conflict between listing, detail page and checkout.
- **Not shown visually:** the international-tuition display, because it needs a published programme with a dollar price, and publishing a draft for testing is prohibited. It is covered by the automated tests instead.

## 15. Owner decisions needed

1. **Exchange-rate policy:** the approved source or sources, the maximum rate age, the rounding rule, and behaviour when rates are missing or stale. Also whether a maximum age should apply to the existing naira guide.
2. **International charging:** the provider and currency, whether conversion is used for charging, FX differences, refunds, and whether the Google Sheet must handle it. Until this is decided, international tuition cannot be paid online.
3. **International tuition for the nine live programmes:** today international residents pay the naira tuition (`international_legacy_ngn`). Set a dollar price per programme, or confirm that this continues.
4. **Euro coverage:** confirm whether Montenegro and Kosovo, and the four microstates, count as eurozone.
5. **Residence evidence:** whether a mismatch between the declared country and the network country should trigger a review.
6. Still open from Stage B: NGN tuition for the 21 drafts, and the publication date.

## 16. Risks, limitations and next actions

**Risks and limitations**
- Network location is a weak signal (VPNs, travel). It is used only before a residence country is chosen.
- A student could declare a different country. Today it changes only the guide, not the charge, because every current programme charges the naira tuition. It would matter once international prices are published. Decision 5 covers this.
- The order snapshot is written in a second statement just after the order. If it ever fails, the order is still valid but has no snapshot; the next action is noted.
- The pound and euro tuition path is fully tested but has never been seen by users.

**Recommended next actions**
1. Decide items 1 to 3 of section 15.
2. Rehearse 0010, 0011 and 0012 on staging (Stage 3D items are still outstanding).
3. When ready, publish international prices through the Stage B owner flow.

## 17. Confirmation

No production deployment, migration, DNS or settings change, and no production data change. No draft was published outside the isolated test database. No real payment and no email was triggered (all mocked). **Stage E has not been started.** Stage D stops here for owner review.

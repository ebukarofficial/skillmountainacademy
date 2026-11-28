// Country-based tuition, decided on the server (Expansion Stage D).
//
//   1 COUNTRY. The student's declared country of residence (the application form's country, sent as an ISO code and
//     validated against the ISO 3166-1 list) decides. Cloudflare's request.cf.country is a supporting signal: it is used
//     only when no valid residence country was given (for example when browsing before applying), and a mismatch is
//     recorded on the order. This is the precedence the site already used for quotes; it changes no one's price.
//   2 CURRENCY. currencyForCountry(): NG -> NGN; US -> USD; GB -> GBP; eurozone -> EUR; everything else -> USD.
//     A currency sent by the browser is never used.
//   3 TUITION.
//     local (NG): the programme's local NGN tuition (price_kobo). Never derived from the dollar price.
//     international, programme HAS an international price (price_usd_cents): the US dollar benchmark. Pounds and euros
//       are shown ONLY under an owner-approved exchange-rate policy with a fresh rate; otherwise the dollar benchmark is
//       shown and the reason is given. Paying international tuition online is NOT available yet (Paystack charges NGN and
//       no conversion for charging is approved), so such a registration is refused with a clear message.
//     international, programme has NO international price (all nine current programmes): today's behaviour is kept.
//       The programme's NGN tuition applies and is charged in naira; any dollar/pound/euro figure is a guide conversion
//       of that naira amount, labelled as such, never presented as international tuition.
//   4 CHARGE. The provider charges NGN, from the server's own figure. Display and charge are reported separately.
// Pure rules only (no database), so they can be unit-tested directly; src/server/pricing.ts adds storage.
import { COUNTRY_CODES } from "../../lib/countries.ts";
import { convertParts, crossConvertMinor, currencyForCountry, planParts, splitMinor, tierForCountry, type Currency, type Plan, type Rates, type Rounding } from "../../lib/pricing.ts";
import type { Programme } from "../../lib/config.ts";
const nowIso = () => new Date().toISOString();

const ISO = new Set(COUNTRY_CODES);
export const validCountry = (v: unknown): string | null => { const c = String(v ?? "").trim().toUpperCase(); return ISO.has(c) ? c : null; };
export const ipCountry = (req: Request) => validCountry((req as Request & { cf?: { country?: string } }).cf?.country);

export type CountryResolution = { country: string | null; source: "residence" | "network" | "none"; residence: string | null; network: string | null; mismatch: boolean };
export function resolveCountry(declared: unknown, network: string | null): CountryResolution {
  const residence = validCountry(declared);
  const country = residence ?? network;
  return { country, source: residence ? "residence" : network ? "network" : "none", residence, network, mismatch: !!residence && !!network && residence !== network };
}

// ---------- exchange-rate policy (owner decision; inactive until approved) ----------
export const FX_SOURCES = ["open.er-api.com", "currency-api (jsDelivr)"] as const;
export type FxPolicy = {
  status: "not_approved" | "approved";
  sources: string[];          // accepted rate sources (from the existing feed)
  maxAgeHours: number | null; // a rate older than this is not used for pound / euro tuition
  rounding: Rounding | null;
  updatedAt: string | null; updatedBy: string | null;
};
export const DEFAULT_FX: FxPolicy = { status: "not_approved", sources: [], maxAgeHours: null, rounding: null, updatedAt: null, updatedBy: null };
export type FxCheck = { usable: boolean; reason: "ok" | "policy_not_approved" | "no_rates" | "source_not_approved" | "stale"; ageHours: number | null };
export function fxUsable(policy: FxPolicy, rates: Rates | null, now = Date.now()): FxCheck {
  const ageHours = rates ? Math.max(0, (now - Date.parse(rates.fetchedAt)) / 3600_000) : null;
  if (policy.status !== "approved") return { usable: false, reason: "policy_not_approved", ageHours };
  if (!rates || ageHours === null || Number.isNaN(ageHours)) return { usable: false, reason: "no_rates", ageHours };
  if (!policy.sources.includes(rates.source)) return { usable: false, reason: "source_not_approved", ageHours };
  if (ageHours > (policy.maxAgeHours as number)) return { usable: false, reason: "stale", ageHours };
  return { usable: true, reason: "ok", ageHours };
}

// ---------- the quote ----------
export type Presentation = "local" | "international_tuition" | "international_benchmark_fallback" | "guide_from_naira" | "naira_only";
export type TuitionQuote = {
  country: CountryResolution; tier: "local" | "international" | "international_legacy_ngn"; tuitionCurrency: Currency;
  // The tuition that applies, in its own currency (minor units), when there is one.
  tuition: { currency: Currency; minor: number | null; status: "set" | "local_price_missing" | "international_price_not_set" };
  // What is shown as the main figure (may be a guide). parts add up exactly to total.
  presentation: { kind: Presentation; currency: Currency; totalMinor: number; partsMinor: number[]; note: string };
  charge: { provider: "Paystack"; currency: "NGN"; totalNaira: number; partsNaira: number[]; available: boolean; reason: string | null };
  fx: { policy: FxPolicy["status"]; usable: boolean; reason: FxCheck["reason"]; source: string | null; fetchedAt: string | null; ageHours: number | null;
    rate: number | null; rounding: Rounding | null; calculation: string | null };
};

export function quoteTuition(a: { prog: Programme & { priceUsdCents?: number | null }; totalNaira: number; plan: Plan; country: CountryResolution; rates: Rates | null; fx: FxPolicy; now?: number }): TuitionQuote {
  const { prog, totalNaira, plan, country, rates, fx } = a;
  const cur = currencyForCountry(country.country);
  const partsNaira = planParts(totalNaira, plan);
  const fxc = fxUsable(fx, rates, a.now);
  const fxBase = { policy: fx.status, usable: fxc.usable, reason: fxc.reason, source: rates?.source ?? null, fetchedAt: rates?.fetchedAt ?? null, ageHours: fxc.ageHours === null ? null : Math.round(fxc.ageHours * 10) / 10,
    rate: null as number | null, rounding: fx.rounding, calculation: null as string | null };
  const charge = { provider: "Paystack" as const, currency: "NGN" as const, totalNaira, partsNaira, available: true, reason: null as string | null };
  const naira = (kind: Presentation, note: string) => ({ kind, currency: "NGN" as Currency, totalMinor: totalNaira * 100, partsMinor: partsNaira.map((n) => n * 100), note });

  if (tierForCountry(country.country) === "local") {
    return { country, tier: "local", tuitionCurrency: "NGN", tuition: { currency: "NGN", minor: totalNaira * 100, status: "set" },
      presentation: naira("local", "Local tuition in naira."), charge, fx: fxBase };
  }

  const usd = prog.priceUsdCents;
  if (Number.isInteger(usd) && (usd as number) > 0) {
    // International tuition exists. Online charging of it is not approved yet (provider charges NGN; no FX policy for charging).
    const blocked = { ...charge, available: false, reason: "International tuition cannot be paid online yet: payment in pounds, euros or dollars has not been approved. Please contact Admissions." };
    const usdParts = splitMinor(usd as number, plan);
    if (cur === "USD") return { country, tier: "international", tuitionCurrency: "USD", tuition: { currency: "USD", minor: usd as number, status: "set" },
      presentation: { kind: "international_tuition", currency: "USD", totalMinor: usd as number, partsMinor: usdParts, note: "International tuition in US dollars." }, charge: blocked, fx: fxBase };
    const conv = fxc.usable && rates ? crossConvertMinor(usd as number, cur as "GBP" | "EUR", rates, fx.rounding as Rounding) : null;
    if (conv !== null && rates) {
      const rate = rates.rates[cur] / rates.rates.USD;
      return { country, tier: "international", tuitionCurrency: cur, tuition: { currency: cur, minor: conv, status: "set" },
        presentation: { kind: "international_tuition", currency: cur, totalMinor: conv, partsMinor: splitMinor(conv, plan), note: `International tuition in ${cur}, from the US dollar benchmark at the approved rate.` },
        charge: blocked, fx: { ...fxBase, rate, calculation: `${usd} USD cents x (${rates.rates[cur]} ${cur}/NGN / ${rates.rates.USD} USD/NGN), ${fx.rounding}` } };
    }
    return { country, tier: "international", tuitionCurrency: cur, tuition: { currency: "USD", minor: usd as number, status: "set" },
      presentation: { kind: "international_benchmark_fallback", currency: "USD", totalMinor: usd as number, partsMinor: usdParts,
        note: `International tuition is set in US dollars. A ${cur} amount is not available (${fxc.reason.replace(/_/g, " ")}).` }, charge: blocked, fx: fxBase };
  }

  // No international price (the nine current programmes): unchanged behaviour. NGN tuition, charged in naira; a guide only.
  const guide = cur !== "NGN" && rates ? convertParts(partsNaira, cur, rates) : null;
  if (guide) return { country, tier: "international_legacy_ngn", tuitionCurrency: cur, tuition: { currency: "NGN", minor: totalNaira * 100, status: "international_price_not_set" },
    presentation: { kind: "guide_from_naira", currency: cur, totalMinor: guide.reduce((x, y) => x + y, 0) * 100, partsMinor: guide.map((n) => n * 100),
      note: `Guide only: the naira tuition converted to ${cur} at the rate of ${rates!.fetchedAt.slice(0, 10)}. International tuition has not been set for this programme; it is charged in naira.` },
    charge, fx: { ...fxBase, rate: rates!.rates[cur], calculation: `${totalNaira} NGN x ${rates!.rates[cur]} ${cur}/NGN, nearest whole unit (existing guide)` } };
  return { country, tier: "international_legacy_ngn", tuitionCurrency: cur, tuition: { currency: "NGN", minor: totalNaira * 100, status: "international_price_not_set" },
    presentation: naira("naira_only", "International tuition has not been set for this programme; it is charged in naira. No exchange rate is available for a guide amount."), charge, fx: fxBase };
}

// The JSON stored on an order (no personal data beyond country codes).
export const snapshotOf = (q: TuitionQuote, prog: Programme & { priceUsdCents?: number | null }) => JSON.stringify({
  v: 1, at: nowIso(), programme: prog.slug, country: q.country, tier: q.tier, tuitionCurrency: q.tuitionCurrency, tuition: q.tuition,
  presentation: { kind: q.presentation.kind, currency: q.presentation.currency, totalMinor: q.presentation.totalMinor }, charge: { provider: q.charge.provider, currency: q.charge.currency, totalNaira: q.charge.totalNaira },
  catalogue: { localNaira: prog.price, internationalUsdCents: prog.priceUsdCents ?? null }, fx: q.fx,
});


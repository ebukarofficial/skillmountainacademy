// Price, instalment and currency maths. Shared by the website (display) and the Worker (what is charged),
// so both always agree. Paystack charges in NGN; other currencies are shown as "≈" guidance only.
import { FLAGS, PAY_PLAN, finalPrice, type Programme } from "./config.ts";

export type Plan = "full" | "parts";
export const CURRENCIES = ["NGN", "USD", "GBP", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export type Rates = { base: "NGN"; rates: Record<Currency, number>; fetchedAt: string; source: string };

// ---------- price (server truth) ----------
// Naira the learner owes. groupSize > 1 only when group classes are on and the programme has a group price.
export function priceNaira(p: Programme, opts: { holdActive?: boolean; groupSize?: number } = {}): number {
  const g = opts.groupSize ?? 1;
  if (g > 1) {
    if (!FLAGS.GROUP_ENABLED || p.groupPrice == null) throw new Error("group classes are not available for this programme");
    return p.groupPrice;
  }
  return finalPrice(p, !!opts.holdActive);
}

// Splits a whole-naira total into parts (default 50/30/20). Each part is whole naira; the last part takes the
// remainder, so the parts always add up exactly to the total.
export function splitNaira(total: number, split: number[] = PAY_PLAN.split): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error("total must be whole naira");
  const parts = split.slice(0, -1).map((pct) => Math.floor((total * pct) / 100));
  parts.push(total - parts.reduce((a, b) => a + b, 0));
  return parts;
}

export const planParts = (total: number, plan: Plan) => (plan === "full" ? [total] : splitNaira(total));

// Due days after registration: 0/45/90, or 0/30/60 for 3-month training.
export const dueDays = (p: Programme) => (p.trainingMonths <= 3 ? PAY_PLAN.dueDaysShort : PAY_PLAN.dueDays);

// YYYY-MM-DD in Africa/Lagos (UTC+1, no daylight saving) for `days` after `from`.
export function lagosDate(from: Date, days = 0): string {
  const t = new Date(from.getTime() + 3600_000 + days * 86400_000);
  return t.toISOString().slice(0, 10);
}

// ---------- currency ----------
const EUROZONE = ["AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES", "AD", "MC", "SM", "VA", "ME", "XK"];

export function currencyForCountry(cc: string | null | undefined): Currency {
  const c = String(cc || "").toUpperCase();
  if (c === "NG") return "NGN";
  if (c === "US") return "USD";
  if (c === "GB") return "GBP";
  if (EUROZONE.includes(c)) return "EUR";
  return "USD";
}

// Browser fallback when the Worker cannot tell (for example on a local preview): the time zone, then the locale.
const TZ: Record<string, string> = { "Africa/Lagos": "NG", "Europe/London": "GB", "Europe/Belfast": "GB" };
const EURO_TZ = ["Amsterdam", "Athens", "Berlin", "Bratislava", "Brussels", "Dublin", "Helsinki", "Lisbon", "Ljubljana", "Luxembourg", "Madrid", "Malta", "Paris", "Riga", "Rome", "Tallinn", "Vienna", "Vilnius", "Zagreb", "Nicosia", "Sofia", "Andorra", "Monaco", "San_Marino", "Vatican", "Podgorica"];
export function guessCountry(timeZone: string | undefined, locale: string | undefined): string | null {
  if (timeZone) {
    if (TZ[timeZone]) return TZ[timeZone];
    if (timeZone.startsWith("Europe/") && EURO_TZ.includes(timeZone.slice(7))) return "FR"; // any eurozone country gives EUR
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit)/.test(timeZone) || timeZone === "Pacific/Honolulu") return "US";
  }
  const region = locale?.split("-")[1]?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : null;
}

// Converts naira to another currency and rounds sensibly to whole units (310 dollars, not 309.86).
export function convert(naira: number, cur: Currency, rates: Rates | null): number | null {
  if (cur === "NGN") return naira;
  const r = rates?.rates[cur];
  if (!r || !Number.isFinite(r) || r <= 0) return null;
  return Math.round(naira * r);
}

// Converted parts that still add up exactly to the converted total (the rounding difference goes on the last part).
export function convertParts(parts: number[], cur: Currency, rates: Rates | null): number[] | null {
  const total = convert(parts.reduce((a, b) => a + b, 0), cur, rates);
  if (total == null) return null;
  const out = parts.slice(0, -1).map((n) => convert(n, cur, rates) as number);
  out.push(total - out.reduce((a, b) => a + b, 0));
  return out;
}

const LOCALE: Record<Currency, string> = { NGN: "en-NG", USD: "en-US", GBP: "en-GB", EUR: "en-IE" };
export function money(amount: number, cur: Currency): string {
  return new Intl.NumberFormat(LOCALE[cur], { style: "currency", currency: cur, maximumFractionDigits: 0, minimumFractionDigits: 0, currencyDisplay: "narrowSymbol" }).format(amount);
}
// "₦450,000", or for other currencies "≈" plus the amount. Non-naira amounts are approximate.
export const approx = (amount: number, cur: Currency) => `≈ ${cur === "USD" ? "US" : ""}${money(amount, cur)}`;
export function display(naira: number, cur: Currency, rates: Rates | null): string {
  const v = convert(naira, cur, rates);
  if (v == null || cur === "NGN") return money(naira, "NGN");
  return approx(v, cur);
}

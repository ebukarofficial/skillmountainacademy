// Currency: country detection (GET /api/geo) and exchange rates cached in KV.
// Rates come from ExchangeRate-API's free open endpoint (no key; attribution link shown on the site; data updates
// daily, and we fetch only every 12 hours). If it fails, the CC0 currency-api feed on jsDelivr is tried. If both fail,
// the last known rates stay in KV, so prices keep showing.
import { CURRENCIES, convertParts, currencyForCountry, planParts, priceNaira, type Currency, type Rates } from "../../../lib/pricing.ts";
import { findProgramme } from "../../../lib/config.ts";
import type { AppEnv } from "../env";
import { json } from "../http";

const KEY = "fx:NGN";
let lastTry = 0;

export async function readRates(env: AppEnv): Promise<Rates | null> {
  if (!env.KV) return null;
  try {
    return await env.KV.get<Rates>(KEY, { type: "json", cacheTtl: 3600 });
  } catch {
    return null;
  }
}

const valid = (r: Partial<Record<string, number>>) => CURRENCIES.every((c) => c === "NGN" || (typeof r[c] === "number" && r[c]! > 0 && r[c]! < 1));

async function fromOpenEr(): Promise<Rates | null> {
  const r = await fetch("https://open.er-api.com/v6/latest/NGN", { cf: { cacheTtl: 3600 } } as RequestInit);
  if (!r.ok) return null;
  const j = (await r.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
  if (j.result !== "success" || !j.rates || !valid(j.rates)) return null;
  return { base: "NGN", rates: { NGN: 1, USD: j.rates.USD, GBP: j.rates.GBP, EUR: j.rates.EUR }, fetchedAt: new Date().toISOString(), source: "open.er-api.com" };
}

async function fromJsDelivr(): Promise<Rates | null> {
  const r = await fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/ngn.json");
  if (!r.ok) return null;
  const j = (await r.json()) as { ngn?: Record<string, number> };
  const n = j.ngn;
  if (!n) return null;
  const rates = { USD: n.usd, GBP: n.gbp, EUR: n.eur };
  if (!valid(rates)) return null;
  return { base: "NGN", rates: { NGN: 1, ...rates }, fetchedAt: new Date().toISOString(), source: "currency-api (jsDelivr)" };
}

// Cron: fetch fresh rates. Keeps the previous rates when every source fails.
export async function refreshRates(env: AppEnv): Promise<Rates | null> {
  if (!env.KV) return null;
  for (const src of [fromOpenEr, fromJsDelivr]) {
    try {
      const r = await src();
      if (r) {
        await env.KV.put(KEY, JSON.stringify(r));
        return r;
      }
    } catch (e) {
      console.error("fx source failed", e);
    }
  }
  console.warn("fx: all sources failed, keeping the last known rates");
  return readRates(env);
}

// GET /api/geo: the visitor's country (from Cloudflare) and the currency to show, plus the cached rates.
export async function handleGeo(req: Request, env: AppEnv): Promise<Response> {
  const country = (req as Request & { cf?: { country?: string } }).cf?.country ?? null;
  let rates = await readRates(env);
  // First visit after setup, before the cron has run. At most one attempt per 10 minutes per Worker instance.
  if (!rates && env.KV && Date.now() - lastTry > 600_000) {
    lastTry = Date.now();
    rates = await refreshRates(env);
  }
  const currency: Currency = currencyForCountry(country);
  return json({ ok: true, country, currency, rates }, 200, { "cache-control": "private, max-age=600" });
}

// GET /api/quote?programme=<slug>&country=<ISO2>[&plan=full|parts]
// The one place where a programme's amount is converted for display. The country of residence decides the
// currency (NGN, GBP, EUR, USD: see currencyForCountry). Paystack always charges in naira, so the charge amount
// and currency are returned separately and shown before payment.
export async function handleQuote(req: Request, env: AppEnv): Promise<Response> {
  const u = new URL(req.url);
  const prog = findProgramme(u.searchParams.get("programme"));
  if (!prog) return json({ ok: false, error: "invalid", message: "Unknown programme." }, 400);
  const cc = (u.searchParams.get("country") || (req as Request & { cf?: { country?: string } }).cf?.country || "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(cc) ? cc : null;
  const wantParts = u.searchParams.get("plan") === "parts" && !prog.fullPaymentOnly;
  const totalNaira = priceNaira(prog);
  const partsNaira = planParts(totalNaira, wantParts ? "parts" : "full");
  let currency: Currency = currencyForCountry(country);
  const rates = currency === "NGN" ? null : await readRates(env);
  let shown = convertParts(partsNaira, currency, rates);
  if (!shown) { currency = "NGN"; shown = partsNaira; } // no rates yet: show naira rather than a guess
  return json({
    ok: true, programme: prog.slug, country, currency,
    display: { total: shown.reduce((a, b) => a + b, 0), parts: shown, approximate: currency !== "NGN" },
    charge: { currency: "NGN", total: totalNaira, parts: partsNaira, provider: "Paystack" },
    plan: wantParts ? "parts" : "full", fullPaymentOnly: !!prog.fullPaymentOnly,
    rate: currency === "NGN" ? 1 : rates!.rates[currency], ratesUpdatedAt: currency === "NGN" ? null : rates!.fetchedAt, source: currency === "NGN" ? null : rates!.source,
  }, 200, { "cache-control": "private, max-age=300" });
}

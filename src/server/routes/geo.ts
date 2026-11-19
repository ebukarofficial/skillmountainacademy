// Currency: country detection (GET /api/geo) and exchange rates cached in KV.
// Rates come from ExchangeRate-API's free open endpoint (no key; attribution link shown on the site; data updates
// daily, and we fetch only every 12 hours). If it fails, the CC0 currency-api feed on jsDelivr is tried. If both fail,
// the last known rates stay in KV, so prices keep showing.
import { CURRENCIES, currencyForCountry, type Currency, type Rates } from "../../../lib/pricing.ts";
import type { AppEnv } from "../env";
import { json } from "../http";

const KEY = "fx:NGN";

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
  if (!rates) rates = await refreshRates(env); // first visit after setup, before the cron has run
  const currency: Currency = currencyForCountry(country);
  return json({ ok: true, country, currency, rates }, 200, { "cache-control": "private, max-age=600" });
}

// Currency: country detection (GET /api/geo) and exchange rates cached in KV.
// Rates come from ExchangeRate-API's free open endpoint (no key; attribution link shown on the site; data updates
// daily, and we fetch only every 12 hours). If it fails, the CC0 currency-api feed on jsDelivr is tried. If both fail,
// the last known rates stay in KV, so prices keep showing.
import { CURRENCIES, currencyForCountry, priceNaira, type Currency, type Rates } from "../../../lib/pricing.ts";
import { getFxPolicy, ipCountry, quoteTuition, resolveCountry, validCountry } from "../pricing";
import { LIFECYCLE_MESSAGE, lifecycleOf, resolveProgramme } from "../catalogue";
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
  const country = ipCountry(req); // validated ISO code from Cloudflare, or null
  let rates = await readRates(env);
  // First visit after setup, before the cron has run. At most one attempt per 10 minutes per Worker instance.
  if (!rates && env.KV && Date.now() - lastTry > 600_000) {
    lastTry = Date.now();
    rates = await refreshRates(env);
  }
  const currency: Currency = currencyForCountry(country);
  return json({ ok: true, country, currency, rates }, 200, { "cache-control": "private, max-age=600" });
}

// GET /api/quote?programme=<slug>[&country=<ISO2 country of residence>][&plan=full|parts]
// Stage D: the server's country-based tuition quote (src/server/pricing.ts). The country is the validated country of
// residence when given, otherwise Cloudflare's network country. No currency is accepted from the browser. The tuition
// presentation and what Paystack actually charges (always naira, today) are returned separately.
export async function handleQuote(req: Request, env: AppEnv): Promise<Response> {
  const u = new URL(req.url);
  const life = await lifecycleOf(env.DB, u.searchParams.get("programme"));
  if (life && life !== "published" && life !== "unknown") return json({ ok: false, error: "programme_unavailable", message: LIFECYCLE_MESSAGE[life] }, 409);
  const prog = await resolveProgramme(env.DB, u.searchParams.get("programme"));
  if (!prog) return json({ ok: false, error: "invalid", message: "Unknown programme." }, 400);
  const requested = u.searchParams.get("country");
  if (requested && !validCountry(requested)) return json({ ok: false, error: "invalid_country", message: "Please choose a valid country of residence." }, 400);
  const country = resolveCountry(requested, ipCountry(req));
  const plan = u.searchParams.get("plan") === "parts" && !prog.fullPaymentOnly ? "parts" : "full";
  const [rates, fx] = await Promise.all([readRates(env), getFxPolicy(env.DB)]);
  const q = quoteTuition({ prog, totalNaira: priceNaira(prog), plan, country, rates, fx });
  const p = q.presentation;
  return json({
    ok: true, programme: prog.slug, country: country.country, countrySource: country.source, tier: q.tier, tuitionCurrency: q.tuitionCurrency, tuition: q.tuition,
    // Backward-compatible display fields (whole units), now carrying the presentation kind and note.
    currency: p.currency, display: { total: p.totalMinor / 100, parts: p.partsMinor.map((n) => n / 100), approximate: p.kind === "guide_from_naira", kind: p.kind, note: p.note,
      totalMinor: p.totalMinor, partsMinor: p.partsMinor },
    charge: { currency: "NGN", total: q.charge.totalNaira, parts: q.charge.partsNaira, provider: q.charge.provider, available: q.charge.available, reason: q.charge.reason },
    plan, fullPaymentOnly: !!prog.fullPaymentOnly,
    rate: q.fx.rate ?? 1, ratesUpdatedAt: q.fx.fetchedAt, source: q.fx.source, fx: { policy: q.fx.policy, usable: q.fx.usable, reason: q.fx.reason },
  }, 200, { "cache-control": "private, max-age=300" });
}

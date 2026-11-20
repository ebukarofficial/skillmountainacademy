// Phase 4: currency detection, conversion, the FX cron and what checkout charges.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PROGRAMMES } from "../lib/config.ts";
import { convert, convertParts, currencyForCountry, display, guessCountry, money, splitNaira, type Rates } from "../lib/pricing.ts";
import { read } from "./helpers.ts";
import { registration, startWorker } from "./worker-harness.ts";

const RATES: Rates = { base: "NGN", rates: { NGN: 1, USD: 0.00069, GBP: 0.00052, EUR: 0.0006 }, fetchedAt: "2026-11-19T05:00:00Z", source: "open.er-api.com" };

test("country -> currency: NG NGN, US USD, GB GBP, eurozone EUR, everywhere else USD", () => {
  assert.equal(currencyForCountry("NG"), "NGN");
  assert.equal(currencyForCountry("US"), "USD");
  assert.equal(currencyForCountry("GB"), "GBP");
  for (const c of ["DE", "FR", "IE", "NL", "BG", "HR"]) assert.equal(currencyForCountry(c), "EUR", c);
  for (const c of ["KE", "GH", "CA", "IN", "", null]) assert.equal(currencyForCountry(c), "USD", String(c));
});

test("browser fallback: time zone first, then locale", () => {
  assert.equal(currencyForCountry(guessCountry("Africa/Lagos", "en-US")), "NGN");
  assert.equal(currencyForCountry(guessCountry("Europe/London", "en-NG")), "GBP");
  assert.equal(currencyForCountry(guessCountry("Europe/Berlin", undefined)), "EUR");
  assert.equal(currencyForCountry(guessCountry("America/Chicago", undefined)), "USD");
  assert.equal(currencyForCountry(guessCountry("Asia/Dubai", "en-NG")), "NGN");
  assert.equal(currencyForCountry(guessCountry(undefined, "en")), "USD");
});

test("conversion rounds to whole units, shows ≈ for non-naira, and uses Intl formatting", () => {
  assert.equal(convert(450000, "USD", RATES), 311);
  assert.equal(convert(450000, "NGN", RATES), 450000);
  assert.equal(convert(450000, "EUR", null), null);
  assert.equal(money(450000, "NGN"), "₦450,000");
  assert.equal(display(450000, "NGN", RATES), "₦450,000");
  assert.equal(display(450000, "USD", RATES), "≈ US$311");
  assert.equal(display(450000, "GBP", RATES), "≈ £234");
  assert.equal(display(450000, "EUR", RATES), "≈ €270");
  assert.equal(display(450000, "EUR", null), "₦450,000", "no rates: naira only");
});

test("acceptance 6/8: converted instalments add up exactly to the converted total, in every currency", () => {
  for (const p of PROGRAMMES) for (const cur of ["NGN", "USD", "GBP", "EUR"] as const) {
    const parts = splitNaira(p.price);
    const conv = convertParts(parts, cur, RATES)!;
    assert.equal(conv.reduce((a, b) => a + b, 0), convert(p.price, cur, RATES), `${p.slug} ${cur}`);
  }
});

test("currency follows the chosen country at enrolment; naira everywhere else; rate credit and charge statement exist", () => {
  const cur = read("app/currency.tsx");
  assert.match(cur, /fetch\("\/api\/geo"/);
  assert.match(cur, /guessCountry\(Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone, navigator\.language\)/);
  assert.match(cur, /Rates By Exchange Rate API/);
  assert.match(cur, /Paystack will charge <b>/);
  for (const f of ["app/page.tsx", "app/site-parts.tsx", "app/programmes/[slug]/page.tsx"]) assert.doesNotMatch(read(f), /CurrencySwitcher|FxNote/, `${f}: no currency selector`);
  assert.match(cur, /export function Money\(\{ naira \}: \{ naira: number \}\) \{\n  return <>\{display\(naira, "NGN", null\)\}<\/>;/, "Money shows naira");
  assert.match(read("app/checkout/server-pay.tsx"), /<PayCurrency \/>/);
  assert.match(read("app/checkout/flow.tsx"), /<PayCurrency \/>/);
  assert.match(read("app/checkout/flow.tsx"), /<CountrySelect d=\{d\} \/>/, "the country field sets the currency");
  for (const f of ["app/checkout/page.tsx", "app/checkout/flow.tsx", "app/checkout/server-pay.tsx"]) assert.doesNotMatch(read(f), /<CurrencySwitcher/, `${f}: students never pick a currency`);
  assert.doesNotMatch(cur.slice(cur.indexOf("export function PayCurrency")), /<select/, "PayCurrency only shows the currency the country gave");
  assert.match(read("app/checkout/flow.tsx"), /<ChargeNote naira=/);
});

let w: Awaited<ReturnType<typeof startWorker>>;
before(async () => { w = await startWorker(); });
after(async () => { await w.dispose(); });

test("acceptance 6: GET /api/geo detects the currency from Cloudflare's country", async () => {
  for (const [cc, cur] of [["NG", "NGN"], ["US", "USD"], ["GB", "GBP"], ["DE", "EUR"], ["KE", "USD"]]) {
    const j = await (await w.fetchApi("/api/geo", { cf: { country: cc } })).json() as { currency: string; country: string; rates: Rates | null };
    assert.equal(j.currency, cur, cc);
    assert.equal(j.country, cc);
    assert.equal(j.rates?.rates.USD, 0.00069, "rates fetched on first visit and cached");
  }
  assert.equal(w.calls.filter((c) => c.url.includes("open.er-api.com")).length, 1, "only one FX fetch; the rest came from KV");
});

test("cron refreshes rates into KV and keeps the last known rates if every source fails", async () => {
  let fail = false;
  const x = await startWorker({ mock: (req) => {
    const h = new URL(req.url).host;
    if (fail && (h === "open.er-api.com" || h === "cdn.jsdelivr.net")) return new Response("down", { status: 503 });
    if (h === "open.er-api.com") return Response.json({ result: "success", rates: { USD: 0.0007, GBP: 0.00055, EUR: 0.00062 } });
    return undefined;
  } });
  try {
    const worker = await x.mf.getWorker();
    await worker.scheduled({ cron: "0 5,17 * * *", scheduledTime: new Date("2026-11-19T17:00:00Z") });
    const kv = await x.mf.getKVNamespace("KV");
    const first = await kv.get("fx:NGN", "json") as Rates;
    assert.equal(first.rates.USD, 0.0007);
    fail = true;
    await worker.scheduled({ cron: "0 5,17 * * *", scheduledTime: new Date("2026-11-20T05:00:00Z") });
    const kept = await kv.get("fx:NGN", "json") as Rates;
    assert.deepEqual(kept, first, "last known rates kept");
    assert.ok(x.calls.some((c) => c.url.includes("cdn.jsdelivr.net")), "fallback source tried");
  } finally { await x.dispose(); }
});

test("FX fallback source is used when the first one fails", async () => {
  const x = await startWorker({ mock: (req) => {
    const h = new URL(req.url).host;
    if (h === "open.er-api.com") return new Response("rate limited", { status: 429 });
    if (h === "cdn.jsdelivr.net") return Response.json({ ngn: { usd: 0.00068, gbp: 0.00051, eur: 0.00059 } });
    return undefined;
  } });
  try {
    const j = await (await x.fetchApi("/api/geo", { cf: { country: "GB" } })).json() as { rates: Rates };
    assert.equal(j.rates.rates.GBP, 0.00051);
    assert.match(j.rates.source, /jsDelivr/);
  } finally { await x.dispose(); }
});

test("acceptance 6: the order saves the currency shown and the FX rate used; the charge is in NGN", async () => {
  await w.fetchApi("/api/geo", { cf: { country: "US" } });
  const r = await w.post("/api/register", registration({ currency: "USD", learner: { ...registration().learner, email: "fx@example.com" } }));
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json() as { reference: string; chargeCurrency: string; payNowNaira: number; fxRate: number };
  assert.equal(j.chargeCurrency, "NGN");
  assert.equal(j.payNowNaira, 450000);
  assert.equal(j.fxRate, 0.00069);
  const o = await (await w.db()).prepare("SELECT display_currency, fx_rate, fx_at FROM orders WHERE reference = ?").bind(j.reference).first<Record<string, unknown>>();
  assert.deepEqual([o?.display_currency, o?.fx_rate], ["USD", 0.00069]);
  assert.ok(o?.fx_at);
  const init = w.calls.find((c) => c.url.endsWith("/transaction/initialize") && c.body.includes(j.reference));
  assert.equal(JSON.parse(init!.body).currency, "NGN");
});

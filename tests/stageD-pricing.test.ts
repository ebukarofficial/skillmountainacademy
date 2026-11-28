// Expansion Stage D: country-based tuition, currency display and pricing integrity.
// Pure rules (lib/pricing.ts, src/server/pricing.ts) and real requests to the real Worker (Miniflare).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { startWorker, SECRETS, registration } from "./worker-harness.ts";
import { signIn as helperSignIn, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { crossConvertMinor, currencyForCountry, splitMinor, tierForCountry, type Rates } from "../lib/pricing.ts";
import { DEFAULT_FX, fxUsable, quoteTuition, resolveCountry, validCountry, type FxPolicy } from "../src/server/pricing-rules.ts";
import { SEED_PROGRAMMES, findProgramme, type Programme } from "../lib/config.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
const NOW = Date.parse("2026-11-27T12:00:00Z");
const RATES: Rates = { base: "NGN", rates: { NGN: 1, USD: 0.0006, GBP: 0.00048, EUR: 0.00055 }, fetchedAt: "2026-11-27T05:00:00Z", source: "open.er-api.com" };
const APPROVED: FxPolicy = { status: "approved", sources: ["open.er-api.com"], maxAgeHours: 24, rounding: "nearest_whole", updatedAt: null, updatedBy: null };
const cloud = findProgramme("cloud")!;
const intl: Programme = { ...findProgramme("devops")!, slug: "intl-test", price: 850000, priceUsdCents: 105000 };
const q = (prog: Programme, cc: string | null, opts: { rates?: Rates | null; fx?: FxPolicy; plan?: "full" | "parts" } = {}) =>
  quoteTuition({ prog, totalNaira: prog.price, plan: opts.plan ?? "full", country: resolveCountry(cc, null), rates: opts.rates === undefined ? RATES : opts.rates, fx: opts.fx ?? DEFAULT_FX, now: NOW });

// ---------------------------------------------------------------- 1. mapping ----
test("mapping: residence country -> tuition currency, exactly as approved; no CAD or other currencies", () => {
  const cases: [string, string, string][] = [
    ["NG", "NGN", "local"], ["US", "USD", "international"], ["GB", "GBP", "international"], ["DE", "EUR", "international"], ["FR", "EUR", "international"],
    ["IE", "EUR", "international"], ["NL", "EUR", "international"], ["ES", "EUR", "international"], ["HR", "EUR", "international"], ["CA", "USD", "international"],
    ["GH", "USD", "international"], ["ZA", "USD", "international"], ["KE", "USD", "international"], ["EG", "USD", "international"], ["JP", "USD", "international"],
    ["IN", "USD", "international"], ["AU", "USD", "international"], ["BR", "USD", "international"], ["CH", "USD", "international"], ["AE", "USD", "international"],
  ];
  for (const [cc, cur, tier] of cases) assert.deepEqual([currencyForCountry(cc), tierForCountry(cc)], [cur, tier], cc);
  assert.equal(currencyForCountry("ca"), "USD", "case does not matter");
  for (const cc of ["CA", "GH", "ZA", "AU", "JP", "CN", "MX"]) assert.ok(["USD"].includes(currencyForCountry(cc)), `${cc} never gets a local currency`);
});

test("country: ISO 3166-1 validation; residence takes precedence over the network country; mismatches are recorded", () => {
  assert.equal(validCountry("ng"), "NG");
  for (const bad of ["ZZ", "T1", "XX", "", "NGA", "N1", "<script>", null, 42]) assert.equal(validCountry(bad), null, String(bad));
  assert.deepEqual(resolveCountry("GB", "NG"), { country: "GB", source: "residence", residence: "GB", network: "NG", mismatch: true });
  assert.deepEqual(resolveCountry("bogus", "US"), { country: "US", source: "network", residence: null, network: "US", mismatch: false });
  assert.deepEqual(resolveCountry(null, null), { country: null, source: "none", residence: null, network: null, mismatch: false });
});

// ---------------------------------------------------------------- 2. integrity ----
test("integrity: local tuition never comes from the dollar benchmark; international USD is exact", () => {
  const ng = q(intl, "NG");
  assert.deepEqual([ng.tier, ng.tuition, ng.presentation.totalMinor, ng.charge.totalNaira], ["local", { currency: "NGN", minor: 85_000_000, status: "set" }, 85_000_000, 850000]);
  assert.deepEqual(q({ ...intl, priceUsdCents: 999999 }, "NG").tuition, ng.tuition, "changing the dollar price changes nothing for Nigeria");
  const us = q(intl, "US", { plan: "parts" });
  assert.deepEqual([us.tier, us.presentation.kind, us.presentation.currency, us.presentation.totalMinor, us.presentation.partsMinor], ["international", "international_tuition", "USD", 105000, [52500, 31500, 21000]]);
  assert.equal(us.presentation.partsMinor.reduce((a, b) => a + b, 0), 105000);
  for (const cc of ["CA", "GH", "ZA", "JP"]) assert.equal(q(intl, cc).presentation.totalMinor, 105000, cc);
});

test("integrity: pounds and euros only under an approved policy with a fresh rate from an approved source; correct cross rate and rounding", () => {
  const gb0 = q(intl, "GB");
  assert.deepEqual([gb0.presentation.kind, gb0.presentation.currency, gb0.presentation.totalMinor, gb0.fx.reason], ["international_benchmark_fallback", "USD", 105000, "policy_not_approved"]);
  const gb = q(intl, "GB", { fx: APPROVED });
  // 1050 USD x (0.00048 / 0.0006) = 840 GBP exactly.
  assert.deepEqual([gb.presentation.kind, gb.presentation.currency, gb.presentation.totalMinor, gb.tuition.currency], ["international_tuition", "GBP", 84000, "GBP"]);
  assert.match(gb.fx.calculation!, /105000 USD cents/);
  const de = q(intl, "DE", { fx: APPROVED });
  assert.equal(de.presentation.totalMinor, Math.round(1050 * (0.00055 / 0.0006)) * 100, "962.5 -> 963 (nearest whole)");
  assert.equal(crossConvertMinor(105000, "EUR", RATES, "up_whole"), 96300);
  assert.equal(crossConvertMinor(105000, "EUR", RATES, "nearest_cent"), 96250);
  assert.equal(crossConvertMinor(105001, "EUR", RATES, "nearest_cent"), Math.round(105001 * (0.00055 / 0.0006)));
  // Stale, missing, invalid or unapproved-source rates never produce a pound or euro figure.
  assert.equal(q(intl, "GB", { fx: APPROVED, rates: { ...RATES, fetchedAt: "2026-11-24T05:00:00Z" } }).fx.reason, "stale");
  assert.equal(q(intl, "GB", { fx: APPROVED, rates: null }).presentation.kind, "international_benchmark_fallback");
  assert.equal(q(intl, "GB", { fx: APPROVED, rates: { ...RATES, source: "somewhere-else" } }).fx.reason, "source_not_approved");
  assert.equal(crossConvertMinor(105000, "GBP", { ...RATES, rates: { ...RATES.rates, USD: 0 } }, "nearest_whole"), null);
  assert.equal(fxUsable({ ...APPROVED, rounding: null, status: "approved" } as FxPolicy, RATES, NOW).usable, true, "fxUsable trusts getFxPolicy to have rejected incomplete policies");
  assert.deepEqual(splitMinor(84000, "parts"), [42000, 25200, 16800]);
});

test("integrity: programmes without an international price keep today's behaviour, labelled as a naira guide; charging stays NGN", () => {
  const us = q(cloud, "US");
  assert.deepEqual([us.tier, us.presentation.kind, us.tuition.status, us.charge.currency, us.charge.totalNaira, us.charge.available], ["international_legacy_ngn", "guide_from_naira", "international_price_not_set", "NGN", 450000, true]);
  assert.equal(us.presentation.totalMinor, Math.round(450000 * 0.0006) * 100, "the existing guide conversion of the naira tuition");
  assert.match(us.presentation.note, /Guide only/);
  assert.equal(q(cloud, "US", { rates: null }).presentation.kind, "naira_only");
  assert.equal(q(cloud, "NG").presentation.totalMinor, 45_000_000);
  // International tuition (dollar price set) cannot be charged online yet.
  assert.equal(q(intl, "US").charge.available, false);
});

// ---------------------------------------------------------------- 3. the Worker ----
let w: W;
let owner: Session, finance: Session, academic: Session;
const sql = async <T = Record<string, unknown>>(s: string, ...a: unknown[]) => (await (await w.db()).prepare(s).bind(...a).all<T>()).results;
const reset = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (e: string) => { await reset(); return helperSignIn(w, e); };
let n = 0;
const register = async (programme: string, learner: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  await reset();
  return w.post("/api/register", { ...registration({ programme, method: "bank", learner: { ...registration().learner, email: `d${++n}@example.com`, ...learner } }), ...extra });
};
const quoteApi = async (slug: string, country?: string) => w.fetchApi(`/api/quote?programme=${slug}${country ? `&country=${country}` : ""}`);
const putRates = async (r: Rates) => (await w.mf.getKVNamespace("KV")).put("fx:NGN", JSON.stringify(r));

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: "boss@example.com", MFA_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64") } });
  owner = await signIn("boss@example.com");
  const secret = (await owner.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await owner.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
  await owner.json("POST", "/api/app/owner/bootstrap");
  for (const [e, r] of [["fin@example.com", "finance"], ["acad@example.com", "academic"]]) await owner.json("POST", "/api/app/admin/users", { email: e, role: "admin", adminRole: r, fullName: r, sendInvite: false });
  finance = await signIn("fin@example.com");
  academic = await signIn("acad@example.com");
  await putRates({ ...RATES, fetchedAt: new Date().toISOString() });
});
after(async () => { await w.dispose(); });

test("worker: the nine programmes keep their prices; all 21 drafts are unpublished", async () => {
  const c = (await (await w.fetchApi("/api/catalogue")).json()) as { programmes: { slug: string; price: number }[] };
  assert.deepEqual(c.programmes.map((p) => [p.slug, p.price]), SEED_PROGRAMMES.map((p) => [p.slug, p.price]));
  assert.equal((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM programme_drafts"))[0].n, 21);
});

test("worker: the quote follows the country rule; invalid countries are refused; no currency parameter is honoured", async () => {
  const ng = (await (await quoteApi("cloud", "NG")).json()) as { currency: string; tier: string; display: { total: number; kind: string }; charge: { total: number; currency: string } };
  assert.deepEqual([ng.currency, ng.tier, ng.display.total, ng.display.kind, ng.charge.currency, ng.charge.total], ["NGN", "local", 450000, "local", "NGN", 450000]);
  for (const [cc, cur] of [["US", "USD"], ["GB", "GBP"], ["DE", "EUR"], ["CA", "USD"], ["GH", "USD"], ["ZA", "USD"]]) {
    const j = (await (await quoteApi("cloud", cc)).json()) as { currency: string; tuitionCurrency: string; display: { kind: string; approximate: boolean }; charge: { currency: string; total: number } };
    assert.deepEqual([j.tuitionCurrency, j.currency, j.display.kind, j.display.approximate, j.charge.currency, j.charge.total], [cur, cur, "guide_from_naira", true, "NGN", 450000], cc);
  }
  assert.equal((await quoteApi("cloud", "ZZ")).status, 400);
  const sneaky = (await (await w.fetchApi("/api/quote?programme=cloud&country=NG&currency=GBP")).json()) as { currency: string };
  assert.equal(sneaky.currency, "NGN");
});

test("worker: registration ignores a browser currency, validates the country, snapshots the pricing and charges NGN as before", async () => {
  const r = await register("cloud", { country: "United Kingdom", countryCode: "GB" }, { currency: "EUR" });
  assert.equal(r.status, 200, await r.clone().text());
  const j = (await r.json()) as { reference: string; displayCurrency: string; chargeCurrency: string; totalNaira: number; tier: string };
  assert.deepEqual([j.displayCurrency, j.chargeCurrency, j.totalNaira, j.tier], ["GBP", "NGN", 450000, "international_legacy_ngn"]);
  const [o] = await sql<Record<string, unknown>>("SELECT * FROM orders WHERE reference = ?1", j.reference);
  assert.deepEqual([o.total_kobo, o.display_currency, o.residence_country, o.pricing_tier, o.tuition_currency, o.tuition_minor, o.charge_currency], [45_000_000, "GBP", "GB", "international_legacy_ngn", "NGN", 45_000_000, "NGN"]);
  const snap = JSON.parse(String(o.pricing_snapshot));
  assert.deepEqual([snap.catalogue.localNaira, snap.catalogue.internationalUsdCents, snap.charge.currency, snap.fx.source, snap.flow], [450000, null, "NGN", "open.er-api.com", "registration"]);
  const ngR = await register("cloud", { country: "Nigeria", countryCode: "NG" });
  const ng = (await sql<Record<string, unknown>>("SELECT pricing_tier, tuition_currency, tuition_minor, display_currency FROM orders WHERE reference = ?1", ((await ngR.json()) as { reference: string }).reference))[0];
  assert.deepEqual({ ...ng }, { pricing_tier: "local", tuition_currency: "NGN", tuition_minor: 45_000_000, display_currency: "NGN" });
  assert.equal((await register("cloud", { country: "Nowhere", countryCode: "ZZ" })).status, 400, "an invalid country is refused");
  // An older page sending only the country name still works (matched on the server).
  const named = await register("cloud", { country: "Ghana" });
  const gh = (await sql<Record<string, unknown>>("SELECT residence_country, display_currency FROM orders WHERE reference = ?1", ((await named.json()) as { reference: string }).reference))[0];
  assert.deepEqual({ ...gh }, { residence_country: "GH", display_currency: "USD" });
});

test("worker: orders made before 0012 are untouched and stay readable", async () => {
  // Stage D.1: a database without the pricing columns refuses new registrations (no order without its pricing record),
  // so the historical order is written as an older Worker wrote it.
  const old = await startWorker({ migrationsUpTo: "0011_catalogue.sql" });
  try {
    const db = await old.db();
    await db.prepare("INSERT INTO registrations (id, role, created_at, programme_slug, terms, first_name, email, country) VALUES ('r-old','learner','2026-11-01T10:00:00Z','cloud','t','Old','old@example.com','United States')").run();
    await db.prepare("INSERT INTO orders (id, reference, created_at, registration_id, programme_slug, plan, method, total_kobo, regular_kobo, group_size, display_currency, fx_rate, fx_at, status) VALUES ('o-old','SMA-OLD000000001','2026-11-01T10:00:00Z','r-old','cloud','full','bank',45000000,45000000,1,'USD',0.00069,'2026-11-01T05:00:00Z','pending')").run();
    const before = await db.prepare("SELECT id, reference, total_kobo, regular_kobo, display_currency, fx_rate, status FROM orders").all();
    assert.deepEqual(await old.applyPending(), ["0012_pricing_snapshot.sql", "0013_order_idempotency.sql", "0014_payment_attempts.sql"]);
    assert.deepEqual((await db.prepare("SELECT id, reference, total_kobo, regular_kobo, display_currency, fx_rate, status FROM orders").all()).results, before.results);
    assert.deepEqual({ ...(await db.prepare("SELECT pricing_snapshot, charge_currency, residence_country FROM orders").first()) }, { pricing_snapshot: null, charge_currency: null, residence_country: null }, "no backfill");
  } finally { await old.dispose(); }
});

test("worker: a programme with international tuition: Nigeria pays the local price; abroad sees USD and cannot be charged online yet", async () => {
  await academic.json("PATCH", "/api/app/admin/catalogue/programmes/python", { blurb: "Python", level: "Beginner", learn: ["a", "b", "c"], priceNgnKobo: 85_000_000 });
  await owner.json("POST", "/api/app/admin/catalogue/programmes/python/publish");
  const us = (await (await quoteApi("python", "US")).json()) as { currency: string; display: { kind: string; totalMinor: number }; charge: { available: boolean } };
  assert.deepEqual([us.currency, us.display.kind, us.display.totalMinor, us.charge.available], ["USD", "international_tuition", 105000, false]);
  const gb = (await (await quoteApi("python", "GB")).json()) as { currency: string; display: { kind: string }; fx: { reason: string } };
  assert.deepEqual([gb.currency, gb.display.kind, gb.fx.reason], ["USD", "international_benchmark_fallback", "policy_not_approved"]);
  const ordersBefore = (await sql<{ n: number }>("SELECT COUNT(*) AS n FROM orders"))[0].n;
  const abroad = await register("python", { country: "United States", countryCode: "US" });
  assert.equal(((await abroad.json()) as { error: string }).error, "international_payment_unavailable");
  assert.equal((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM orders"))[0].n, ordersBefore, "nothing saved, nothing charged");
  const home = await register("python", { country: "Nigeria", countryCode: "NG" });
  assert.equal(((await home.json()) as { totalNaira: number }).totalNaira, 850000, "the owner's local price, not a conversion of US$1,050");
});

test("worker: only the owner sets the exchange-rate policy; once approved, pounds come from the dollar benchmark; stale rates are refused", async () => {
  const body = { status: "approved", sources: ["open.er-api.com"], maxAgeHours: 24, rounding: "nearest_whole" };
  for (const s of [finance, academic]) assert.equal((await s.send("PUT", "/api/app/owner/fx-policy", body)).status, 403);
  assert.equal((await owner.send("PUT", "/api/app/owner/fx-policy", { ...body, rounding: null })).status, 400, "an approved policy must be complete");
  assert.equal((await owner.send("PUT", "/api/app/owner/fx-policy", { ...body, sources: ["my-own-rates"] })).status, 400);
  await owner.json("PUT", "/api/app/owner/fx-policy", body);
  const gb = (await (await quoteApi("python", "GB")).json()) as { currency: string; display: { kind: string; totalMinor: number } };
  assert.deepEqual([gb.currency, gb.display.kind, gb.display.totalMinor], ["GBP", "international_tuition", 84000]);
  const diag = await finance.json<{ check: { usable: boolean }; rates: { crossFromUsd: { GBP: number } }; programmes: { slug: string; gbpMinor: number | null }[] }>("GET", "/api/app/admin/pricing/diagnostics");
  assert.equal(diag.check.usable, true);
  assert.equal(diag.programmes.find((p) => p.slug === "python")!.gbpMinor, 84000);
  assert.equal((await academic.send("GET", "/api/app/admin/pricing/diagnostics")).status, 403);
  await putRates({ ...RATES, fetchedAt: new Date(Date.now() - 30 * 3600_000).toISOString() });
  const stale = (await (await quoteApi("python", "GB")).json()) as { currency: string; fx: { reason: string } };
  assert.deepEqual([stale.currency, stale.fx.reason], ["USD", "stale"]);
  await owner.json("PUT", "/api/app/owner/fx-policy", { status: "not_approved", sources: [], maxAgeHours: null, rounding: null });
  assert.equal((await sql("SELECT 1 FROM audit_log WHERE action = 'owner.fx_policy'")).length, 2);
});

test("worker: every Stage D route is in the default-deny table", async () => {
  const r = await build({ stdin: { contents: `import "./src/server/lms/index"; export { permissionTable } from "./src/server/lms/permissions";`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], write: false, logLevel: "silent" });
  const m = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  const t = new Set((m.permissionTable() as { method: string; path: string; area: string }[]).map((p) => `${p.method} ${p.path} ${p.area}`));
  assert.ok(t.has("GET /api/app/admin/pricing/diagnostics finance"));
  assert.ok(t.has("PUT /api/app/owner/fx-policy owner"));
});

// Expansion Stage D.1: the order and its pricing snapshot are persisted atomically; payment starts only after that;
// retries never create a second order or a second payment attempt. Real requests to the real Worker (Miniflare).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { startWorker, SECRETS, registration } from "./worker-harness.ts";
import { snapshotProblems, type PricingSnapshot } from "../src/server/pricing-rules.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
let w: W;
let failPaystack = 0; // how many initialize calls to fail next
const sql = async <T = Record<string, unknown>>(s: string, ...a: unknown[]) => (await (await w.db()).prepare(s).bind(...a).all<T>()).results;
const count = async (t: string) => (await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))[0].n;
const counts = async () => ({ registrations: await count("registrations"), orders: await count("orders"), instalments: await count("instalments") });
const inits = () => w.calls.filter((c) => c.url.endsWith("/transaction/initialize"));
const reset = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
let n = 0;
const body = (over: Record<string, unknown> = {}, learner: Record<string, unknown> = {}) =>
  registration({ programme: "cloud", method: "paystack", learner: { ...registration().learner, email: `i${++n}@example.com`, country: "Nigeria", countryCode: "NG", ...learner }, ...over });
const post = async (b: unknown) => { await reset(); return w.post("/api/register", b); };
const sign = (b: string) => createHmac("sha512", SECRETS.PAYSTACK_SECRET_KEY).update(b).digest("hex");
const key = () => crypto.randomUUID();

before(async () => {
  w = await startWorker({ mock: (req, b) => {
    const u = new URL(req.url);
    // Stage D.1.1: a definite refusal (HTTP 4xx, status false) allows a later new attempt; a 5xx would be "uncertain".
    if (u.host === "api.paystack.co" && u.pathname === "/transaction/initialize" && failPaystack > 0) { failPaystack--; return Response.json({ status: false, message: "Invalid key" }, { status: 400 }); }
    void b;
    return undefined;
  } });
});
after(async () => { await w.dispose(); });

test("platform: a D1 batch is one transaction here too: a failing statement rolls back the statements before it", async () => {
  const db = await w.db();
  await db.exec("CREATE TABLE t_atomic (id TEXT PRIMARY KEY)");
  const r = await db.batch([db.prepare("INSERT INTO t_atomic (id) VALUES ('a')"), db.prepare("INSERT INTO t_atomic (id) VALUES ('a')")]).then(() => "ok", (e: Error) => e.message);
  assert.match(r, /UNIQUE/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM t_atomic").first<{ n: number }>())!.n, 0, "the first insert was rolled back");
  await db.exec("DROP TABLE t_atomic");
});

test("success: registration, order WITH its complete pricing snapshot, and instalments are stored together; payment starts after", async () => {
  const before = { ...(await counts()), inits: inits().length };
  const r = await post(body({ plan: "parts", idempotencyKey: key() }));
  assert.equal(r.status, 200, await r.clone().text());
  const j = (await r.json()) as { reference: string; authorizationUrl: string };
  const [o] = await sql<Record<string, unknown>>("SELECT * FROM orders WHERE reference = ?1", j.reference);
  const snap = JSON.parse(String(o.pricing_snapshot)) as PricingSnapshot;
  assert.deepEqual(snapshotProblems(snap), []);
  assert.deepEqual([snap.v, snap.flow, snap.country.source, snap.country.residence, snap.tier, snap.tuition.currency, snap.tuition.minor, snap.display.currency, snap.charge.currency, snap.charge.totalNaira, snap.catalogue.localNaira],
    [2, "registration", "residence", "NG", "local", "NGN", 45_000_000, "NGN", "NGN", 450000, 450000]);
  assert.deepEqual(snap.charge.partsNaira, [225000, 135000, 90000]);
  assert.deepEqual([o.charge_currency, o.pricing_tier, o.residence_country, o.total_kobo], ["NGN", "local", "NG", 45_000_000]);
  assert.deepEqual(await counts(), { registrations: before.registrations + 1, orders: before.orders + 1, instalments: before.instalments + 3 });
  const init = inits().slice(before.inits);
  assert.equal(init.length, 1);
  const ib = JSON.parse(init[0].body);
  assert.deepEqual([ib.currency, ib.amount, ib.metadata.order_id], ["NGN", 22_500_000, o.id], "Paystack: NGN, part 1, for the stored order");
  // Stage D.1.1: the checkout is stored on its payment attempt (migration 0014), no longer on orders.payment_init.
  assert.deepEqual((await sql<{ state: string; authorization_url: string }>("SELECT state, authorization_url FROM payment_attempts WHERE order_id = ?1", o.id)).map((a) => [a.state, a.authorization_url]), [["initialized", j.authorizationUrl]]);
});

test("snapshot write failure: nothing is saved, nothing is charged, no email or sheet call, and the student is told", async () => {
  const db = await w.db();
  await db.exec("CREATE TRIGGER t_fail_snapshot BEFORE INSERT ON orders WHEN NEW.pricing_snapshot IS NOT NULL BEGIN SELECT RAISE(ABORT, 'snapshot write failed'); END");
  try {
    const before = { ...(await counts()), calls: w.calls.length };
    const r = await post(body({ idempotencyKey: key() }));
    assert.equal(r.status, 500);
    const j = (await r.json()) as { error: string; message: string };
    assert.equal(j.error, "registration_not_saved");
    assert.match(j.message, /Nothing was saved or charged/);
    assert.doesNotMatch(JSON.stringify(j), /reference|authorizationUrl/);
    assert.deepEqual(await counts(), { registrations: before.registrations, orders: before.orders, instalments: before.instalments }, "the registration row was rolled back too");
    await new Promise((res) => setTimeout(res, 200));
    const after = w.calls.slice(before.calls).map((c) => new URL(c.url).host);
    assert.ok(!after.includes("api.paystack.co"), "no payment attempt");
    assert.ok(!after.includes("api.resend.com") && !after.includes("script.google.com"), "no email, no sheet mirror");
  } finally { await db.exec("DROP TRIGGER t_fail_snapshot"); }
});

test("order creation failure (instalments cannot be written): everything is rolled back; no payment", async () => {
  const db = await w.db();
  await db.exec("CREATE TRIGGER t_fail_inst BEFORE INSERT ON instalments BEGIN SELECT RAISE(ABORT, 'instalment write failed'); END");
  try {
    const before = { ...(await counts()), inits: inits().length };
    const r = await post(body({ idempotencyKey: key() }));
    assert.deepEqual([r.status, ((await r.json()) as { error: string }).error], [500, "registration_not_saved"]);
    assert.deepEqual(await counts(), { registrations: before.registrations, orders: before.orders, instalments: before.instalments });
    assert.equal(inits().length, before.inits);
  } finally { await db.exec("DROP TRIGGER t_fail_inst"); }
});

test("snapshot validation: an incomplete pricing record is caught before anything is written", () => {
  const good: PricingSnapshot = { v: 2, at: "x", flow: "registration", programme: "cloud", plan: "full", country: { country: "US", source: "residence", residence: "US", network: null, mismatch: false },
    tier: "international_legacy_ngn", tuitionCurrency: "USD", tuition: { currency: "NGN", minor: 45_000_000, status: "international_price_not_set" },
    display: { kind: "guide_from_naira", currency: "USD", totalMinor: 31100 }, charge: { provider: "Paystack", currency: "NGN", totalNaira: 450000, partsNaira: [450000] },
    catalogue: { localNaira: 450000, internationalUsdCents: null, appliedNaira: 450000 },
    fx: { policy: "not_approved", usable: false, reason: "policy_not_approved", source: "open.er-api.com", fetchedAt: "2026-11-27T05:00:00Z", ageHours: 1, rate: 0.00069, rounding: null, calculation: "450000 NGN x 0.00069" },
    decision: { basis: "country_rule", approvedBy: null, exception: null, payableNaira: 450000 } }; // decision: added in Stage D.1.1
  assert.deepEqual(snapshotProblems(good), []);
  assert.deepEqual(snapshotProblems({ ...good, fx: { ...good.fx, source: null } }), ["exchange-rate details"]);
  assert.deepEqual(snapshotProblems({ ...good, charge: { ...good.charge, partsNaira: [1] } }), ["charge"]);
  assert.deepEqual(snapshotProblems({ ...good, country: { ...good.country, source: "guess" as never } }), ["country resolution"]);
  assert.deepEqual(snapshotProblems({ ...good, display: { kind: "international_tuition", currency: "GBP", totalMinor: 84000 }, fx: { ...good.fx, rounding: null } }), ["rounding policy"]);
});

test("retry: the same key returns the same order and the same Paystack checkout; no second order, no second payment", async () => {
  const k = key();
  const b = body({ idempotencyKey: k });
  const before = { orders: await count("orders"), inits: inits().length };
  const first = (await (await post(b)).json()) as { reference: string; authorizationUrl: string };
  // The browser retries the exact same request (its Turnstile token is now spent, which must not matter).
  const again = await post({ ...b, turnstileToken: "spent-token" });
  assert.equal(again.status, 200, await again.clone().text());
  const second = (await again.json()) as { reference: string; authorizationUrl: string; replayed: boolean };
  assert.deepEqual([second.replayed, second.reference, second.authorizationUrl], [true, first.reference, first.authorizationUrl]);
  assert.equal(await count("orders"), before.orders + 1);
  assert.equal(inits().length, before.inits + 1, "one payment attempt only");
  // The same key for a different request is refused, never answered with someone else's order.
  const other = await post({ ...b, plan: "parts" });
  assert.deepEqual([other.status, ((await other.json()) as { error: string }).error], [409, "idempotency_conflict"]);
});

test("retry: two identical requests at the same moment create exactly one order", async () => {
  const b = body({ idempotencyKey: key(), method: "bank" });
  const before = await count("orders");
  await reset();
  const [a, c] = await Promise.all([w.post("/api/register", b), w.post("/api/register", { ...b, turnstileToken: "good-token" })]);
  assert.deepEqual([a.status, c.status], [200, 200]);
  const [ja, jc] = (await Promise.all([a.json(), c.json()])) as { reference: string }[];
  assert.equal(ja.reference, jc.reference);
  assert.equal(await count("orders"), before + 1);
});

test("retry after the payment could not start: the order is kept, the retry starts the payment once, still one order", async () => {
  const k = key();
  const b = body({ idempotencyKey: k });
  const before = await count("orders");
  failPaystack = 1;
  const r1 = await post(b);
  assert.equal(r1.status, 502);
  assert.match(((await r1.json()) as { message: string }).message, /registration is saved/);
  const [o] = await sql<{ id: string; pricing_snapshot: string | null }>("SELECT id, pricing_snapshot FROM orders WHERE idempotency_key = ?1", k);
  assert.ok(o.pricing_snapshot, "saved with its pricing record");
  assert.deepEqual((await sql<{ state: string }>("SELECT state FROM payment_attempts WHERE order_id = ?1", o.id)).map((a) => a.state), ["failed"], "no checkout opened");
  const r2 = await post(b);
  assert.equal(r2.status, 200);
  const j2 = (await r2.json()) as { authorizationUrl: string; replayed: boolean };
  assert.ok(j2.replayed && j2.authorizationUrl);
  const r3 = (await (await post(b)).json()) as { authorizationUrl: string };
  assert.equal(r3.authorizationUrl, j2.authorizationUrl, "a further retry reuses it");
  assert.equal(await count("orders"), before + 1);
});

test("payment and instalments: the stored order is paid through the existing webhook, in NGN, part by part", async () => {
  const r = (await (await post(body({ plan: "parts", idempotencyKey: key() }))).json()) as { reference: string };
  const init = inits().map((c) => JSON.parse(c.body)).find((x) => x.reference.startsWith(`${r.reference}-P1`));
  const payload = JSON.stringify({ event: "charge.success", data: { id: 991, reference: init.reference, amount: init.amount, currency: "NGN", status: "success", paid_at: new Date().toISOString() } });
  const wh = await w.fetchApi("/api/paystack/webhook", { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": sign(payload), origin: "https://api.paystack.co" }, body: payload });
  assert.equal(wh.status, 200);
  const [o] = await sql<{ status: string; total_kobo: number }>("SELECT status, total_kobo FROM orders WHERE reference = ?1", r.reference);
  assert.deepEqual([o.status, o.total_kobo], ["part_paid", 45_000_000]);
  assert.deepEqual((await sql<{ status: string }>("SELECT i.status FROM instalments i JOIN orders o ON o.id = i.order_id WHERE o.reference = ?1 ORDER BY seq", r.reference)).map((x) => x.status), ["paid", "due", "due"]);
});

test("older database: no pricing record can be stored, so no order is created and no payment starts; historical orders untouched", async () => {
  const old = await startWorker({ migrationsUpTo: "0011_catalogue.sql" });
  try {
    const db = await old.db();
    const callsBefore = old.calls.length;
    const r = await old.post("/api/register", registration({ learner: { ...registration().learner, email: "old1@example.com" } }));
    assert.deepEqual([r.status, ((await r.json()) as { error: string }).error], [503, "registration_unavailable"]);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM orders").first<{ n: number }>())!.n, 0);
    assert.ok(!old.calls.slice(callsBefore).some((c) => c.url.includes("api.paystack.co")));
    // A historical order (made before Stage D) is unchanged by 0012 and 0013 and stays readable.
    await db.prepare("INSERT INTO registrations (id, role, created_at, programme_slug, terms, first_name, email) VALUES ('hr1','learner','2026-10-01T10:00:00Z','cloud','t','Hist','hist@example.com')").run();
    await db.prepare("INSERT INTO orders (id, reference, created_at, registration_id, programme_slug, plan, method, total_kobo, regular_kobo, group_size, display_currency, status) VALUES ('ho1','SMA-HIST0000001','2026-10-01T10:00:00Z','hr1','cloud','full','bank',45000000,45000000,1,'USD','pending')").run();
    const before = await db.prepare("SELECT * FROM orders WHERE id = 'ho1'").first();
    assert.deepEqual(await old.applyPending(), ["0012_pricing_snapshot.sql", "0013_order_idempotency.sql", "0014_payment_attempts.sql"]);
    const afterRow = await db.prepare("SELECT * FROM orders WHERE id = 'ho1'").first<Record<string, unknown>>();
    for (const [k, v] of Object.entries(before!)) assert.equal(afterRow![k], v, k);
    assert.deepEqual([afterRow!.pricing_snapshot, afterRow!.idempotency_key, afterRow!.payment_init, afterRow!.charge_currency], [null, null, null, null]);
  } finally { await old.dispose(); }
});

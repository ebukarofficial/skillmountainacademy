// Expansion Stage D.1.1: concurrency-safe Paystack initialisation, no browser-only payment, accurate admin-admission
// pricing records. Real requests to the real Worker (Miniflare); Paystack is mocked; nothing is paid.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { startWorker, SECRETS, registration } from "./worker-harness.ts";
import { signIn as helperSignIn, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { snapshotProblems, type PricingSnapshot } from "../src/server/pricing-rules.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
let w: W;
let admin: Session;
// Paystack behaviour for the next initialize calls (first item used first), and the verify answer.
let plan: ("ok" | "refuse" | "duplicate" | "error5xx" | "network" | "gate")[] = [];
let gate: { open: () => void; wait: Promise<void> } | null = null;
let verifyAnswer: () => Response = () => Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 });
const newGate = () => { let open!: () => void; const wait = new Promise<void>((r) => { open = r; }); gate = { open, wait }; return gate; };

const sql = async <T = Record<string, unknown>>(s: string, ...a: unknown[]) => (await (await w.db()).prepare(s).bind(...a).all<T>()).results;
const count = async (t: string, where = "1") => (await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`))[0].n;
const inits = () => w.calls.filter((c) => c.url.endsWith("/transaction/initialize")).length;
const reset = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
let n = 0;
const body = (over: Record<string, unknown> = {}) => registration({ programme: "cloud", method: "paystack", idempotencyKey: crypto.randomUUID(),
  learner: { ...registration().learner, email: `p${++n}@example.com`, country: "Nigeria", countryCode: "NG" }, ...over });
const post = async (b: unknown) => { await reset(); return w.post("/api/register", b); };
const json = async <T = Record<string, unknown>>(r: Response) => (await r.json()) as T;
const attempts = (orderRef: string) => sql<{ attempt: number; state: string; reference: string; authorization_url: string | null }>(
  "SELECT a.attempt, a.state, a.reference, a.authorization_url FROM payment_attempts a JOIN orders o ON o.id = a.order_id WHERE o.reference = ?1 ORDER BY a.attempt", orderRef);
const sig = (instRef: string) => createHmac("sha256", SECRETS.PAYSTACK_SECRET_KEY).update(`pay|${instRef}`).digest("hex").slice(0, 32);

before(async () => {
  w = await startWorker({ env: { ...SECRETS, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64") }, mock: async (req, b) => {
    const u = new URL(req.url);
    if (u.host === "api.paystack.co" && u.pathname === "/transaction/initialize") {
      const mode = plan.shift() ?? "ok";
      if (mode === "gate") await gate!.wait;
      if (mode === "refuse") return Response.json({ status: false, message: "Invalid email" }, { status: 400 });
      if (mode === "duplicate") return Response.json({ status: false, message: "Duplicate Transaction Reference" }, { status: 400 });
      if (mode === "error5xx") return new Response("bad gateway", { status: 502 });
      if (mode === "network") throw new TypeError("network connection lost");
      const j = JSON.parse(b);
      return Response.json({ status: true, data: { authorization_url: `https://checkout.paystack.com/${j.reference}`, access_code: `AC_${j.reference}`, reference: j.reference } });
    }
    if (u.host === "api.paystack.co" && u.pathname.startsWith("/transaction/verify/")) return verifyAnswer();
    return undefined;
  } });
  // A published programme WITH international tuition, in this isolated test database only (never published elsewhere).
  await sql(`INSERT INTO programmes (slug, name, price_kobo, training_months, internship_months, level, updated_at, tag, tone, blurb, learn_json, price_usd_cents, status, position, school_slug)
    VALUES ('python', 'Python Programming & Applied Software Development', 85000000, 4, 2, 'Beginner', '2026-11-28', 'Software', 'from-indigo via-navy to-brand-orange', 'Python', '["a","b","c"]', 105000, 'published', 10, 'software-engineering')`);
  await reset();
  admin = await helperSignIn(w, "owner@example.com");
  const secret = (await admin.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await admin.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
});
after(async () => { await w.dispose(); });

// ---------------------------------------------------------------- 1, 2, 5: concurrency and reuse ----
test("confirmed success: one Paystack call; every retry reuses the stored checkout (5)", async () => {
  const b = body();
  const c0 = inits();
  const r1 = await json<{ reference: string; authorizationUrl: string }>(await post(b));
  const r2 = await json<{ authorizationUrl: string; replayed: boolean }>(await post(b));
  const r3 = await json<{ authorizationUrl: string }>(await post(b));
  assert.equal(inits() - c0, 1);
  assert.equal(r2.authorizationUrl, r1.authorizationUrl);
  assert.equal(r3.authorizationUrl, r1.authorizationUrl);
  assert.deepEqual((await attempts(r1.reference)).map((a) => [a.attempt, a.state, a.reference]), [[1, "initialized", `${r1.reference}-P1-A001`]]);
});

test("two simultaneous initialisations for the same saved order: only one calls Paystack; a replay meanwhile does not either (1, 2)", async () => {
  // Order saved, first payment definitely refused, so the next retry may open a new attempt.
  plan = ["refuse"];
  const b = body();
  const first = await post(b);
  assert.deepEqual([first.status, (await json<{ error: string }>(first)).error], [502, "payment_start_failed"]);
  const ref = (await sql<{ reference: string }>("SELECT reference FROM orders WHERE idempotency_key = ?1", b.idempotencyKey))[0].reference;
  const c0 = inits();
  const g = newGate();
  plan = ["gate"];
  await reset();
  const pA = w.post("/api/register", b);
  // Wait until A holds the claim and is inside Paystack.
  for (let i = 0; i < 100 && (await count("payment_attempts", "state = 'claimed'")) === 0; i++) await new Promise((r) => setTimeout(r, 10));
  const B = await w.post("/api/register", b);
  const C = await w.post("/api/register", b);
  assert.deepEqual([B.status, (await json<{ error: string }>(B)).error], [409, "payment_in_progress"]);
  assert.deepEqual([C.status, (await json<{ error: string }>(C)).error], [409, "payment_in_progress"]);
  assert.equal(inits() - c0, 1, "only the claim owner reached Paystack");
  g.open();
  const A = await pA;
  assert.equal(A.status, 200);
  const D = await json<{ authorizationUrl: string }>(await post(b));
  assert.equal(D.authorizationUrl, (await json<{ authorizationUrl: string }>(A)).authorizationUrl, "afterwards everyone reuses it");
  assert.equal(inits() - c0, 1);
  assert.deepEqual((await attempts(ref)).map((a) => a.state), ["failed", "initialized"]);
});

// ---------------------------------------------------------------- 3, 4, 6: uncertain outcomes and recovery ----
test("Paystack success but the result cannot be stored: the checkout is returned, and no blind second attempt follows (3)", async () => {
  const db = await w.db();
  await db.exec("CREATE TRIGGER t_no_store BEFORE UPDATE OF state ON payment_attempts WHEN NEW.state = 'initialized' BEGIN SELECT RAISE(ABORT, 'store failed'); END");
  const b = body();
  const c0 = inits();
  let ref = "";
  try {
    const r = await post(b);
    assert.equal(r.status, 200, "the student still gets the valid Paystack checkout");
    ref = (await json<{ reference: string }>(r)).reference;
  } finally { await db.exec("DROP TRIGGER t_no_store"); }
  assert.deepEqual((await attempts(ref)).map((a) => a.state), ["claimed"]);
  const again = await post(b);
  assert.deepEqual([again.status, (await json<{ error: string }>(again)).error], [409, "payment_in_progress"], "recent claim: wait");
  await sql("UPDATE payment_attempts SET claimed_at = '2026-01-01T00:00:00Z' WHERE reference = ?1", `${ref}-P1-A001`);
  const later = await post(b);
  assert.deepEqual([later.status, (await json<{ error: string }>(later)).error], [409, "payment_needs_check"], "expired claim becomes uncertain, not a new attempt");
  assert.deepEqual((await attempts(ref)).map((a) => a.state), ["uncertain"]);
  assert.equal(inits() - c0, 1, "Paystack was called once in total");
});

test("timeouts, network errors, 5xx and duplicate-reference answers leave a safe uncertain state; retries never call Paystack again (4)", async () => {
  for (const mode of ["network", "error5xx", "duplicate"] as const) {
    plan = [mode];
    const b = body();
    const c0 = inits();
    const r = await post(b);
    assert.deepEqual([r.status, (await json<{ error: string }>(r)).error], [502, "payment_needs_check"], mode);
    const ref = (await sql<{ reference: string; pricing_snapshot: string | null }>("SELECT reference, pricing_snapshot FROM orders WHERE idempotency_key = ?1", b.idempotencyKey))[0];
    assert.ok(ref.pricing_snapshot, "the order is saved with its pricing record");
    assert.deepEqual((await attempts(ref.reference)).map((a) => a.state), ["uncertain"], mode);
    const retry = await post(b);
    assert.deepEqual([retry.status, (await json<{ error: string }>(retry)).error], [409, "payment_needs_check"], mode);
    assert.equal(inits() - c0, 1, `${mode}: no automatic second attempt`);
  }
});

test("controlled recovery: a definite refusal allows a new attempt; an uncertain one needs Finance to check and release it (6)", async () => {
  // Definite refusal -> next retry opens attempt 2.
  plan = ["refuse"];
  const b = body();
  await post(b);
  const ref = (await sql<{ reference: string }>("SELECT reference FROM orders WHERE idempotency_key = ?1", b.idempotencyKey))[0].reference;
  assert.equal((await post(b)).status, 200);
  assert.deepEqual((await attempts(ref)).map((a) => [a.attempt, a.state]), [[1, "failed"], [2, "initialized"]]);
  // Uncertain -> Finance.
  plan = ["network"];
  const b2 = body();
  await post(b2);
  const ref2 = (await sql<{ reference: string }>("SELECT reference FROM orders WHERE idempotency_key = ?1", b2.idempotencyKey))[0].reference;
  const [att] = await sql<{ id: string }>("SELECT a.id FROM payment_attempts a JOIN orders o ON o.id = a.order_id WHERE o.reference = ?1", ref2);
  const list = await admin.json<{ attempts: { id: string; state: string }[] }>("GET", "/api/app/admin/payments/attempts");
  assert.ok(list.attempts.some((a) => a.id === att.id && a.state === "uncertain"));
  // Paystack cannot confirm the reference (its answer for unknown references is undocumented): explicit confirmation needed.
  const noConfirm = await admin.send("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { reason: "Checked" });
  assert.deepEqual([noConfirm.status, (await json<{ error: string }>(noConfirm)).error], [409, "confirm_required"]);
  assert.equal((await admin.send("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { confirmedWithPaystack: true })).status, 400, "a reason is required");
  await admin.json("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { reason: "Not in the Paystack dashboard; student never received a link", confirmedWithPaystack: true });
  const c0 = inits();
  assert.equal((await post(b2)).status, 200, "after release the student can open a new checkout");
  assert.deepEqual((await attempts(ref2)).map((a) => [a.attempt, a.state]), [[1, "released"], [2, "initialized"]]);
  assert.equal(inits() - c0, 1);
  assert.ok((await sql("SELECT 1 FROM audit_log WHERE action = 'payment.attempt_release'")).length >= 1);
});

test("recovery: a payment Paystack reports as successful is recorded and never released", async () => {
  plan = ["network"];
  const b = body();
  await post(b);
  const [o] = await sql<{ id: string; reference: string }>("SELECT id, reference FROM orders WHERE idempotency_key = ?1", b.idempotencyKey);
  const [att] = await sql<{ id: string; reference: string }>("SELECT id, reference FROM payment_attempts WHERE order_id = ?1", o.id);
  const [inst] = await sql<{ amount_kobo: number }>("SELECT amount_kobo FROM instalments WHERE order_id = ?1 AND seq = 1", o.id);
  verifyAnswer = () => Response.json({ status: true, message: "Verification successful", data: { id: 77001, status: "success", reference: att.reference, amount: inst.amount_kobo, currency: "NGN", paid_at: new Date().toISOString() } });
  try {
    const check = await admin.json<{ paystack: { status: string }; instalment: { status: string } }>("POST", `/api/app/admin/payments/attempts/${att.id}/check`);
    assert.deepEqual([check.paystack.status, check.instalment.status], ["success", "paid"], "recorded through the existing idempotent path");
    const rel = await admin.send("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { reason: "x", confirmedWithPaystack: true });
    assert.equal(rel.status, 409);
  } finally { verifyAnswer = () => Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 }); }
});

test("permissions: only Finance-capable administrators reconcile; release needs the authenticator code", async () => {
  await reset();
  const emailOnly = await helperSignIn(w, "owner@example.com"); // MFA enrolled: this session still waits for the code
  assert.equal((await emailOnly.send("POST", "/api/app/admin/payments/attempts/x/release", { reason: "x" })).status, 403);
  const stu = await w.fetchApi("/api/app/admin/payments/attempts");
  assert.equal(stu.status, 401);
});

// ---------------------------------------------------------------- 7, 8: no payment without the server and a pricing record ----
test("no browser-only payment exists: the legacy fallback cannot call Paystack and says checkout is unavailable (7)", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mts)$/.test(f) ? [p] : []; });
  for (const f of [...walk("app"), ...walk("lib")]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /PaystackPop|js\.paystack\.co|transaction\/initialize/, `${f}: Paystack is started only by the server`);
  }
  const flow = readFileSync("app/checkout/flow.tsx", "utf8");
  assert.match(flow, /data-checkout-unavailable/);
  assert.doesNotMatch(flow, /postSheet|postForm/, "no application is sent around the server either");
  const serverInits = walk("src").filter((f) => readFileSync(f, "utf8").includes("/transaction/initialize"));
  assert.deepEqual(serverInits, ["src/server/routes/payments.ts"], "one place calls Paystack initialize: initiatePayment()");
});

test("no pricing record, no payment: a post-Stage-D order without its snapshot cannot be paid online; a historical order still can (8, 11)", async () => {
  // A registered order exists with a snapshot, so later orders without one are anomalies.
  await sql("INSERT INTO registrations (id, role, created_at, programme_slug, terms, first_name, email) VALUES ('r-bad','learner','2099-01-01T00:00:00Z','cloud','t','Bad','bad@example.com')");
  await sql("INSERT INTO orders (id, reference, created_at, registration_id, programme_slug, plan, method, total_kobo, regular_kobo, group_size, display_currency, status) VALUES ('o-bad','SMA-BADORDER0001','2099-01-01T00:00:00Z','r-bad','cloud','full','paystack',45000000,45000000,1,'NGN','pending')");
  await sql("INSERT INTO instalments (id, order_id, seq, amount_kobo, due_date, reference, status) VALUES ('i-bad','o-bad',1,45000000,'2099-01-01','SMA-BADORDER0001-P1','due')");
  await sql("INSERT INTO registrations (id, role, created_at, programme_slug, terms, first_name, email) VALUES ('r-hist','learner','2020-01-01T00:00:00Z','cloud','t','Hist','hist@example.com')");
  await sql("INSERT INTO orders (id, reference, created_at, registration_id, programme_slug, plan, method, total_kobo, regular_kobo, group_size, display_currency, status) VALUES ('o-hist','SMA-HISTORDER001','2020-01-01T00:00:00Z','r-hist','cloud','parts','paystack',45000000,45000000,1,'NGN','part_paid')");
  await sql("INSERT INTO instalments (id, order_id, seq, amount_kobo, due_date, reference, status) VALUES ('i-hist','o-hist',2,13500000,'2020-03-01','SMA-HISTORDER001-P2','due')");
  const c0 = inits();
  const bad = await w.fetchApi(`/api/pay?ref=SMA-BADORDER0001-P1&t=${sig("SMA-BADORDER0001-P1")}`, { redirect: "manual" });
  assert.equal(bad.status, 302);
  assert.match(bad.headers.get("location") ?? "", /notice=pay-unavailable/);
  assert.equal(inits() - c0, 0, "no Paystack call without a pricing record");
  const hist = await w.fetchApi(`/api/pay?ref=SMA-HISTORDER001-P2&t=${sig("SMA-HISTORDER001-P2")}`, { redirect: "manual" });
  assert.equal(hist.status, 302);
  assert.match(hist.headers.get("location") ?? "", /checkout\.paystack\.com\/SMA-HISTORDER001-P2-A001/, "historical instalment links keep working, through the claim");
  assert.equal(inits() - c0, 1);
});

// ---------------------------------------------------------------- 9, 10: admin admissions ----
const admit = (over: Record<string, unknown>) => admin.send("POST", "/api/app/admin/admit", { firstName: "Ada", surname: "Okafor", phone: "08030000000", plan: "full", paidParts: 1, paymentReference: "UBA 1", ...over });

test("admin admission at local NGN tuition records the decision actually approved (9)", async () => {
  const ng = await admit({ email: "adm-ng@example.com", country: "Nigeria", programme: "cloud" });
  assert.equal(ng.status, 201, await ng.clone().text());
  const us = await admit({ email: "adm-us@example.com", country: "United States", programme: "cloud" });
  assert.equal(us.status, 201, await us.clone().text());
  const adminId = (await admin.json<{ user: { id: string } }>("GET", "/api/me")).user.id;
  for (const [email, tier, basis, residence] of [["adm-ng@example.com", "local", "local_tuition", "NG"], ["adm-us@example.com", "international_legacy_ngn", "naira_tuition_no_international_price", "US"]]) {
    const [o] = await sql<{ pricing_snapshot: string; tuition_currency: string; tuition_minor: number; total_kobo: number; pricing_tier: string }>(
      "SELECT o.pricing_snapshot, o.tuition_currency, o.tuition_minor, o.total_kobo, o.pricing_tier FROM orders o JOIN registrations r ON r.id = o.registration_id WHERE r.email = ?1", email);
    const s = JSON.parse(o.pricing_snapshot) as PricingSnapshot;
    assert.deepEqual(snapshotProblems(s), []);
    assert.deepEqual([s.flow, s.tier, s.decision.basis, s.decision.approvedBy, s.decision.exception, s.decision.payableNaira, s.tuition.currency, s.tuition.minor, s.display.kind, s.display.currency, s.country.residence],
      ["admin_admission", tier, basis, adminId, null, 450000, "NGN", 45_000_000, "admin_recorded_naira", "NGN", residence], email);
    assert.deepEqual([o.tuition_currency, o.tuition_minor, o.total_kobo, o.pricing_tier], ["NGN", 45_000_000, 45_000_000, tier]);
  }
});

test("admin admission where international tuition applies is refused; nothing saved; a resident of Nigeria is admitted at the local price (10)", async () => {
  const before = await count("orders");
  const us = await admit({ email: "adm-py-us@example.com", country: "United States", programme: "python" });
  assert.deepEqual([us.status, (await json<{ error: string }>(us)).error], [409, "admission_pricing_not_permitted"]);
  const none = await admit({ email: "adm-py-none@example.com", programme: "python" });
  assert.equal(none.status, 409, "no residence: cannot tell which tuition applies");
  assert.equal(await count("orders"), before);
  const ng = await admit({ email: "adm-py-ng@example.com", country: "Nigeria", programme: "python" });
  assert.equal(ng.status, 201, await ng.clone().text());
  const [o] = await sql<{ pricing_snapshot: string; total_kobo: number }>("SELECT o.pricing_snapshot, o.total_kobo FROM orders o JOIN registrations r ON r.id = o.registration_id WHERE r.email = 'adm-py-ng@example.com'");
  const s = JSON.parse(o.pricing_snapshot) as PricingSnapshot;
  assert.deepEqual([s.tier, s.decision.basis, s.tuition.minor, o.total_kobo, s.catalogue.internationalUsdCents], ["local", "local_tuition", 85_000_000, 85_000_000, 105000]);
});

test("snapshot rule: an admission record claiming international tuition while charging naira is rejected by the validator", () => {
  const s = { v: 2, at: "x", flow: "admin_admission", programme: "python", plan: "full", country: { country: "US", source: "residence", residence: "US", network: null, mismatch: false },
    tier: "international", tuitionCurrency: "USD", tuition: { currency: "USD", minor: 105000, status: "set" }, display: { kind: "admin_recorded_naira", currency: "NGN", totalMinor: 85_000_000 },
    charge: { provider: "Paystack", currency: "NGN", totalNaira: 850000, partsNaira: [850000] }, catalogue: { localNaira: 850000, internationalUsdCents: 105000, appliedNaira: 850000 },
    fx: { policy: "not_approved", usable: false, reason: "policy_not_approved", source: null, fetchedAt: null, ageHours: null, rate: null, rounding: null, calculation: null },
    decision: { basis: "local_tuition", approvedBy: "u1", exception: null, payableNaira: 850000 } } as PricingSnapshot;
  assert.deepEqual(snapshotProblems(s), ["admission tuition consistency"]);
});

// ---------------------------------------------------------------- 11, 12: regressions ----
test("webhook, instalments and bank transfer keep working with the new attempt references (11)", async () => {
  const b = body({ plan: "parts" });
  const r = await json<{ reference: string }>(await post(b));
  const [a] = await attempts(r.reference);
  const [inst] = await sql<{ amount_kobo: number }>("SELECT i.amount_kobo FROM instalments i JOIN orders o ON o.id = i.order_id WHERE o.reference = ?1 AND i.seq = 1", r.reference);
  const payload = JSON.stringify({ event: "charge.success", data: { id: 88001, reference: a.reference, amount: inst.amount_kobo, currency: "NGN", status: "success", paid_at: new Date().toISOString() } });
  const wh = await w.fetchApi("/api/paystack/webhook", { method: "POST", headers: { "content-type": "application/json", origin: "https://api.paystack.co",
    "x-paystack-signature": createHmac("sha512", SECRETS.PAYSTACK_SECRET_KEY).update(payload).digest("hex") }, body: payload });
  assert.equal(wh.status, 200);
  assert.deepEqual((await sql<{ status: string }>("SELECT i.status FROM instalments i JOIN orders o ON o.id = i.order_id WHERE o.reference = ?1 ORDER BY seq", r.reference)).map((x) => x.status), ["paid", "due", "due"]);
  // Bank transfer: an order with its pricing record, no Paystack call.
  const c0 = inits();
  const bank = await post(body({ method: "bank" }));
  assert.equal(bank.status, 200);
  assert.equal(inits() - c0, 0);
});

test("concurrent registration replay still creates one order (12)", async () => {
  const b = body({ method: "bank" });
  const before = await count("orders");
  await reset();
  const [x, y] = await Promise.all([w.post("/api/register", b), w.post("/api/register", b)]);
  assert.deepEqual([x.status, y.status], [200, 200]);
  assert.equal((await json<{ reference: string }>(x)).reference, (await json<{ reference: string }>(y)).reference);
  assert.equal(await count("orders"), before + 1);
});

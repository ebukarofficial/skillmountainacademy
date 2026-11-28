// Stage E.4: Paystack payment-release race hardening. Real requests to the real Worker (Miniflare) on an isolated local
// D1; Paystack and email are mocked; nothing is paid. Every test inspects the PERSISTED database state.
// The point throughout: an unknown external outcome is never treated as confirmed non-payment.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { startWorker, SECRETS, registration, paystackAnswer, settled } from "./worker-harness.ts";
import { signIn as helperSignIn, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { probeSql, releaseConditions } from "../src/server/lms/policy-sql.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
let w: W;
let owner: Session, fin: Session, fin2: Session;
const OWNER = "boss@example.com";

// Paystack: initialize follows `plan` (default "network": an uncertain attempt); verify answers with `verify`, and can
// be held (paused) to interleave other operations with a run that is inside its Paystack check.
let plan: ("ok" | "network" | "refuse" | "gate")[] = [];
let initGate: { open: () => void; wait: Promise<void> } | null = null;
const ABANDONED = (url: string) => paystackAnswer(w, url, "abandoned");
let verify: (url: string) => Response | Promise<Response> = ABANDONED;
let hold: { armed: boolean; open?: () => void; wait?: Promise<void>; reached: boolean } = { armed: false, reached: false };
const armHold = () => { let open!: () => void; const wait = new Promise<void>((r) => { open = r; }); hold = { armed: true, open, wait, reached: false }; };
const waitHold = async () => { for (let i = 0; i < 300 && !hold.reached; i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(hold.reached, "paused inside the Paystack check"); };

const sql = async <T = Record<string, unknown>>(s: string, ...a: unknown[]) => (await (await w.db()).prepare(s).bind(...a).all<T>()).results;
const exec = async (s: string) => { await (await w.db()).exec(s); };
const n = async (s: string, ...a: unknown[]) => (await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM ${s}`, ...a))[0].n;
const reset = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
const inits = () => w.calls.filter((c) => c.url.endsWith("/transaction/initialize")).length;
const emails = () => w.calls.filter((c) => c.url.startsWith("https://api.resend.com")).length;
const body = async <T = Record<string, unknown>>(r: Response) => (await r.clone().json()) as T;
const expectErr = async (r: Promise<Response>, status: number, code?: string) => {
  const res = await r;
  assert.equal(res.status, status, await res.clone().text());
  if (code) assert.equal((await body<{ error: string }>(res)).error, code);
};
type Att = { id: string; reference: string; state: string; version: number; verified_status: string | null; verified_at: string | null; verified_version: number | null;
  first_verified_at: string | null; outcome: string | null; instalment_id: string; attempt: number };
const att = async (id: string) => (await sql<Att>("SELECT * FROM payment_attempts WHERE id = ?1", id))[0];
const instOf = async (id: string) => (await sql<{ id: string; status: string; amount_kobo: number; reference: string }>("SELECT i.* FROM instalments i JOIN payment_attempts a ON a.instalment_id = i.id WHERE a.id = ?1", id))[0];
const paymentsFor = (instId: string) => sql<{ provider_ref: string; amount_kobo: number }>("SELECT provider_ref, amount_kobo FROM payments WHERE instalment_id = ?1 ORDER BY created_at", instId);

const DIRECT = { categories: {}, paymentRelease: { enabled: true, approver: "owner", expiresInHours: 24, allowedGroups: ["finance"], requiresApproval: false } };
const APPROVAL = { categories: {}, paymentRelease: { ...DIRECT.paymentRelease, requiresApproval: true } };
const policy = (p: unknown) => owner.json("PUT", "/api/app/owner/approval-policy", p);
const release = (s: Session, id: string, extra: Record<string, unknown> = {}) => s.send("POST", `/api/app/admin/payments/attempts/${id}/release`, { reason: "Abandoned at Paystack for 30+ minutes", ...extra });
const check = (s: Session, id: string, reason = "Reconciliation check") => s.send("POST", `/api/app/admin/payments/attempts/${id}/check`, { reason });
const approve = (s: Session, id: string) => s.send("POST", `/api/app/admin/approvals/${id}/decision`, { decision: "approve" });

let payN = 0;
// A Paystack order whose first checkout attempt ended in `mode` ("network": uncertain). Returns the order's request body
// (for retries) and the attempt.
async function order(mode: "network" | "ok" | "refuse" = "network", over: Record<string, unknown> = {}) {
  plan = [mode];
  const b = registration({ programme: "cloud", method: "paystack", idempotencyKey: crypto.randomUUID(), learner: { ...registration().learner, email: `e4payer${++payN}@example.com`, country: "Nigeria", countryCode: "NG" }, ...over });
  await reset();
  await w.post("/api/register", b);
  const [a] = await sql<{ id: string }>("SELECT a.id FROM payment_attempts a JOIN orders o ON o.id = a.order_id WHERE o.idempotency_key = ?1 ORDER BY a.attempt", b.idempotencyKey);
  return { b, id: a.id, retry: async () => { await reset(); return w.post("/api/register", b); } };
}
async function webhook(event: string, data: Record<string, unknown>) {
  const payload = JSON.stringify({ event, data });
  return w.fetchApi("/api/paystack/webhook", { method: "POST", headers: { "content-type": "application/json", origin: "https://api.paystack.co",
    "x-paystack-signature": createHmac("sha512", SECRETS.PAYSTACK_SECRET_KEY).update(payload).digest("hex") }, body: payload });
}
// Paystack's charge for an attempt (as the webhook or the verify endpoint reports it).
async function charge(id: string, over: Record<string, unknown> = {}) {
  const a = await att(id);
  const i = await instOf(id);
  return { id: Number(String(a.attempt) + Math.floor(Math.random() * 1e6)), reference: a.reference, amount: i.amount_kobo, currency: "NGN", status: "success", paid_at: new Date().toISOString(), ...over };
}
const successFor = async (id: string) => { const c = await charge(id); return () => Response.json({ status: true, message: "Verification successful", data: c }); };
async function strong(email: string) {
  await reset();
  const s = await helperSignIn(w, email);
  const sec = (await s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await s.json("POST", "/api/auth/mfa/enable", { code: await totpAt(sec, stepOf(Date.now())) });
  return s;
}

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") }, mock: async (req, b) => {
    const u = new URL(req.url);
    if (u.host === "api.paystack.co" && u.pathname === "/transaction/initialize") {
      const mode = plan.shift() ?? "ok";
      if (mode === "gate") await initGate!.wait;
      if (mode === "network") throw new TypeError("network connection lost");
      if (mode === "refuse") return Response.json({ status: false, message: "Invalid email" }, { status: 400 });
      const j = JSON.parse(b);
      return Response.json({ status: true, data: { authorization_url: `https://checkout.paystack.com/${j.reference}`, access_code: `AC_${j.reference}`, reference: j.reference } });
    }
    if (u.host === "api.paystack.co" && u.pathname.startsWith("/transaction/verify/")) {
      if (hold.armed) { hold.armed = false; hold.reached = true; await hold.wait; }
      return verify(req.url);
    }
    return undefined;
  } });
  owner = await strong(OWNER);
  await owner.json("POST", "/api/app/owner/bootstrap");
  for (const e of ["fin@example.com", "fin2@example.com"]) await owner.json("POST", "/api/app/admin/users", { email: e, role: "admin", adminRole: "finance", fullName: e.split("@")[0], sendInvite: false });
  fin = await strong("fin@example.com");
  fin2 = await strong("fin2@example.com");
  await policy(DIRECT);
});
after(async () => { await w.dispose(); });

// ================================================================ 1-2: payment succeeds around the release ====
test("E4.1 payment succeeds right after Paystack reported it unpaid, before the release commits", async () => {
  // (a) The settling rule: the first definite "abandoned" answer cannot release; when the release is retried Paystack
  // reports the payment, which is recorded and the attempt is never released.
  const o = await order();
  await expectErr(release(fin, o.id), 409, "payment_settling");
  const first = await att(o.id);
  assert.deepEqual([first.state, first.verified_status, first.outcome], ["uncertain", "abandoned", null]);
  assert.ok(first.first_verified_at);
  await settled(w, o.id); // 30 minutes pass; meanwhile the customer paid (webhook not delivered yet)
  verify = await successFor(o.id);
  try { await expectErr(release(fin, o.id), 409, "paid_at_paystack"); } finally { verify = ABANDONED; }
  let a = await att(o.id);
  assert.deepEqual([a.state, a.outcome, (await instOf(o.id)).status], ["uncertain", "paid", "paid"], "recorded, never released");
  assert.equal((await paymentsFor(a.instalment_id)).length, 1);

  // (b) The webhook lands while an approved release is paused inside its Paystack check (which then says "abandoned"):
  // the stale answer is discarded, nothing is released.
  await policy(APPROVAL);
  try {
    const o2 = await order();
    await settled(w, o2.id);
    const id = (await body<{ request: { id: string } }>(await release(fin, o2.id))).request.id;
    armHold();
    const pending = approve(owner, id);
    await waitHold();
    assert.equal((await webhook("charge.success", await charge(o2.id))).status, 200);
    hold.open!();
    const r = await body<{ executed: boolean; error?: string }>(await pending);
    assert.equal(r.executed, false);
    assert.match(r.error ?? "", /^changed/);
    a = await att(o2.id);
    assert.deepEqual([a.state, a.outcome, (await instOf(o2.id)).status], ["uncertain", "paid", "paid"]);
    assert.equal(await n("execution_fences WHERE approval_id = ?1", id), 0);
    assert.equal(await n("audit_log WHERE action = 'payment.attempt_release' AND target_id = ?1", o2.id), 0);

    // (c) The payment is recorded INSIDE the commit transaction, after the run's checks (simulated at the fence row):
    // the commit-time condition rolls the whole release back.
    const o3 = await order();
    await settled(w, o3.id);
    const id3 = (await body<{ request: { id: string } }>(await release(fin, o3.id))).request.id;
    const i3 = await instOf(o3.id);
    const a3 = await att(o3.id);
    await exec(`CREATE TRIGGER t_pay BEFORE INSERT ON execution_fences BEGIN INSERT INTO payments (id, order_id, instalment_id, provider, provider_ref, amount_kobo, currency, status, paid_at, created_at) SELECT 'pz', order_id, instalment_id, 'paystack', reference, ${i3.amount_kobo}, 'NGN', 'success', '2026-11-28T00:00:00Z', '2026-11-28T00:00:00Z' FROM payment_attempts WHERE id = '${o3.id}'; END`);
    let r3: { executed: boolean; error?: string };
    try { r3 = await body(await approve(owner, id3)); } finally { await exec("DROP TRIGGER IF EXISTS t_pay"); }
    assert.equal(r3.executed, false);
    // The rollback also removes the simulated payment, so the explanation probe (run after the rollback) cannot name the
    // rule; what matters is that nothing committed.
    assert.match(r3.error ?? "", /^target_changed/, r3.error);
    const after3 = await att(o3.id);
    assert.deepEqual([after3.state, after3.outcome, after3.version], ["uncertain", null, a3.version + 1], "rolled back (the run's own evidence write is the only change)");
    assert.equal(await n("payments WHERE provider_ref = ?1", a3.reference), 0, "the simulated payment rolled back with it");
    assert.equal(await n("execution_fences WHERE approval_id = ?1", id3), 0);
  } finally { await policy(DIRECT); }
});

test("E4.2 payment succeeds while the webhook is delayed past the release: it is recorded and flagged; no further checkout", async () => {
  // The irreducible case: Paystack said "abandoned" twice, 30 minutes apart, the release committed, and only THEN does
  // the old checkout's payment arrive. D1 cannot prevent it; it must be recorded, flagged, and block any new checkout.
  const o = await order();
  await settled(w, o.id);
  assert.equal((await release(fin, o.id)).status, 200);
  plan = ["ok"];
  assert.equal((await o.retry()).status, 200, "the student opened attempt 2");
  const [a2] = await sql<{ id: string }>("SELECT id FROM payment_attempts WHERE instalment_id = (SELECT instalment_id FROM payment_attempts WHERE id = ?1) AND attempt = 2", o.id);
  assert.equal((await webhook("charge.success", await charge(o.id))).status, 200, "the delayed webhook for attempt 1");
  const a1 = await att(o.id);
  assert.deepEqual([a1.state, a1.outcome, (await instOf(o.id)).status], ["released", "reconcile", "paid"]);
  // Attempt 2's checkout is never reused for a paid part, and no third attempt can be opened.
  const c0 = inits();
  await expectErr(o.retry(), 200); // the replay answers with the paid order and no checkout
  assert.equal(inits() - c0, 0);
  await assert.rejects(sql("INSERT INTO payment_attempts (id, order_id, instalment_id, attempt, reference, state, claimed_at, updated_at) SELECT 'x3', order_id, instalment_id, 3, reference || '-X', 'claimed', 'now', 'now' FROM payment_attempts WHERE id = ?1", o.id), /checkout_blocked/);
  // If the student still pays attempt 2's open page, the second payment is recorded (money is never dropped) and flagged.
  assert.equal((await webhook("charge.success", await charge(a2.id))).status, 200);
  assert.equal((await att(a2.id)).outcome, "reconcile", "a duplicate payment is flagged for the owner");
  assert.equal((await paymentsFor(a1.instalment_id)).length, 2);
});

// ================================================================ 3-6: unknown evidence never counts ====
for (const [name, answer, expect] of [
  ["E4.3 verification times out", () => { throw new DOMException("The operation timed out", "TimeoutError"); }, "unknown"],
  ["E4.4 Paystack returns HTTP 5xx", () => new Response("bad gateway", { status: 502 }), "unknown"],
] as [string, () => Response, string][]) {
  test(`${name}: the attempt stays on hold, the settled run is broken, nothing is released`, async () => {
    const o = await order();
    await settled(w, o.id); // even after 30 minutes of "abandoned"
    verify = answer;
    try { await expectErr(release(fin, o.id, { confirmedWithPaystack: true }), 409, "payment_unresolved"); } finally { verify = ABANDONED; }
    const a = await att(o.id);
    assert.deepEqual([a.state, a.verified_status, a.first_verified_at, a.outcome], ["uncertain", expect, null, null], "unknown ends the run of definite answers");
    assert.equal(a.verified_version, a.version, "the unknown answer is the current evidence");
    // A definite answer right after does not release either: the 30 minutes start again.
    await expectErr(release(fin, o.id), 409, "payment_settling");
    assert.equal((await att(o.id)).state, "uncertain");
  });
}

test("E4.5 malformed or ambiguous Paystack answers never count as unpaid", async () => {
  const o = await order();
  const ref = (await att(o.id)).reference;
  const amount = (await instOf(o.id)).amount_kobo;
  const cases: [string, () => Response, string][] = [
    ["not JSON", () => new Response("<html>ok</html>", { status: 200 }), "unknown"],
    ["status false", () => Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 }), "unknown"],
    ["another reference", () => Response.json({ status: true, data: { status: "abandoned", reference: `${ref}X`, amount, currency: "NGN" } }), "unknown"],
    ["no status", () => Response.json({ status: true, data: { reference: ref, amount, currency: "NGN" } }), "unknown"],
    ["pending", () => Response.json({ status: true, data: { status: "ongoing", reference: ref, amount, currency: "NGN" } }), "ongoing"],
    ["reversed", () => Response.json({ status: true, data: { status: "reversed", reference: ref, amount, currency: "NGN" } }), "reversed"],
    ["wrong amount", () => Response.json({ status: true, data: { status: "abandoned", reference: ref, amount: amount - 100, currency: "NGN" } }), "mismatch"],
    ["wrong currency", () => Response.json({ status: true, data: { status: "abandoned", reference: ref, amount, currency: "USD" } }), "mismatch"],
  ];
  for (const [label, answer, stored] of cases) {
    await settled(w, o.id);
    verify = answer;
    try { await expectErr(release(fin, o.id), 409, "payment_unresolved"); } finally { verify = ABANDONED; }
    const a = await att(o.id);
    assert.deepEqual([label, a.state, a.verified_status, a.first_verified_at], [label, "uncertain", stored, null]);
  }
  assert.equal(await n("payments WHERE provider_ref = ?1", ref), 0);
});

test("E4.6 stale evidence is refused by the database itself, for every code path (an old Worker included)", async () => {
  const o = await order();
  const rel = (id: string) => sql("UPDATE payment_attempts SET state = 'released', released_by = 'x', released_reason = 'raw', updated_at = 'now' WHERE id = ?1", id);
  const fix = (verifiedMinAgo: number, current = true) => exec(`UPDATE payment_attempts SET verified_status = 'abandoned', verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${verifiedMinAgo} minutes'), first_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 minutes'), version = version + 1, verified_version = ${current ? "version + 1" : "version"} WHERE id = '${o.id}'`);
  await fix(11); // 11 minutes old
  await assert.rejects(rel(o.id), /payment_release_refused/);
  await fix(1, false); // fresh, but not for the current version (something changed since)
  await assert.rejects(rel(o.id), /payment_release_refused/);
  await exec(`UPDATE payment_attempts SET verified_status = 'unknown', verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), version = version + 1, verified_version = version + 1 WHERE id = '${o.id}'`);
  await assert.rejects(rel(o.id), /payment_release_refused/, "unknown never counts");
  assert.equal((await att(o.id)).state, "uncertain");
  await fix(1); // fresh, current, settled, unpaid: the only case the database accepts
  await rel(o.id);
  assert.equal((await att(o.id)).state, "released");
});

// ================================================================ 7-8: webhooks converge ====
test("E4.7 duplicate successful webhooks record one payment and one set of effects", async () => {
  const o = await order("ok");
  const c = await charge(o.id);
  const rs = await Promise.all([webhook("charge.success", c), webhook("charge.success", c), webhook("charge.success", { ...c, id: c.id + 1 })]);
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
  const results = await Promise.all(rs.map((r) => body<{ result: string }>(r)));
  assert.equal(results.filter((r) => r.result === "recorded").length, 1, JSON.stringify(results));
  const a = await att(o.id);
  assert.equal((await paymentsFor(a.instalment_id)).length, 1);
  assert.deepEqual([a.outcome, (await instOf(o.id)).status], ["paid", "paid"]);
  await new Promise((r) => setTimeout(r, 400)); // the first delivery's emails (sent after the response)
  const e1 = emails();
  assert.equal((await webhook("charge.success", c)).status, 200);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await paymentsFor(a.instalment_id)).length, 1);
  assert.equal(emails(), e1, "a duplicate delivery sends nothing");
});

test("E4.8 a failed event after a success never downgrades the payment", async () => {
  const o = await order("ok");
  const c = await charge(o.id);
  await webhook("charge.success", c);
  const before = await att(o.id);
  assert.equal((await webhook("charge.failed", { ...c, status: "failed" })).status, 200);
  assert.equal((await webhook("charge.success", { ...c, id: c.id + 7, status: "failed" })).status, 200);
  // A later verification answering "failed" is not stored over the recorded outcome.
  verify = () => Response.json({ status: true, data: { ...c, status: "failed" } });
  try { assert.equal((await check(fin, o.id)).status, 200); } finally { verify = ABANDONED; }
  const a = await att(o.id);
  assert.deepEqual([a.outcome, a.verified_status, a.version, (await instOf(o.id)).status], ["paid", before.verified_status, before.version, "paid"]);
  assert.equal((await paymentsFor(a.instalment_id)).length, 1);
  await assert.rejects(sql("UPDATE instalments SET status = 'due' WHERE id = ?1", a.instalment_id), /instalment_paid_kept/);
  await assert.rejects(sql("UPDATE payment_attempts SET outcome = NULL WHERE id = ?1", o.id), /payment_outcome_kept/);
});

// ================================================================ 9-10: concurrency ====
test("E4.9 two release requests at the same time: exactly one releases", async () => {
  const o = await order();
  await settled(w, o.id);
  const rs = await Promise.all([release(fin, o.id), release(fin2, o.id)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409], (await Promise.all(rs.map((r) => r.clone().text()))).join(" | "));
  assert.equal((await att(o.id)).state, "released");
  assert.equal(await n("audit_log WHERE action = 'payment.attempt_release' AND target_id = ?1", o.id), 1);
});

test("E4.10 two checkout requests at the same time: one Paystack call, one active attempt", async () => {
  const o = await order();
  await settled(w, o.id);
  assert.equal((await release(fin, o.id)).status, 200);
  let open!: () => void;
  initGate = { open: () => open(), wait: new Promise<void>((r) => { open = r; }) };
  plan = ["gate"];
  const c0 = inits();
  await reset();
  const x = w.post("/api/register", o.b);
  const y = (async () => { await new Promise((r) => setTimeout(r, 150)); return w.post("/api/register", o.b); })();
  const ry = await y;
  initGate.open();
  const rx = await x;
  assert.deepEqual([rx.status, ry.status].sort(), [200, 409], `${await rx.clone().text()} | ${await ry.clone().text()}`);
  assert.equal(inits() - c0, 1);
  const inst = (await att(o.id)).instalment_id;
  assert.deepEqual((await sql<{ attempt: number; state: string }>("SELECT attempt, state FROM payment_attempts WHERE instalment_id = ?1 ORDER BY attempt", inst)).map((r) => [r.attempt, r.state]), [[1, "released"], [2, "initialized"]]);
});

// ================================================================ 11-14: failures and recovery ====
test("E4.11-12 Paystack success while D1 fails (checkout result and payment both unrecorded): recovery records it, never releases", async () => {
  // The checkout was opened (Paystack success) but its result could not be stored: the claim stays 'claimed'.
  await exec("CREATE TRIGGER t_store BEFORE UPDATE OF state ON payment_attempts WHEN NEW.state = 'initialized' BEGIN SELECT RAISE(ABORT, 'store failed'); END");
  let o: Awaited<ReturnType<typeof order>>;
  try { o = await order("ok"); } finally { await exec("DROP TRIGGER IF EXISTS t_store"); }
  assert.equal((await att(o.id)).state, "claimed");
  // The customer pays; the webhook's D1 write fails: the whole batch rolls back, Paystack will retry.
  const c = await charge(o.id);
  await exec("CREATE TRIGGER t_pay BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT, 'd1 down'); END");
  try { assert.ok((await webhook("charge.success", c)).status >= 500, "an error makes Paystack retry"); } finally { await exec("DROP TRIGGER IF EXISTS t_pay"); }
  let a = await att(o.id);
  assert.deepEqual([a.outcome, (await instOf(o.id)).status, await n("webhook_events WHERE id = ?1", `paystack:${c.id}`)], [null, "due", 0], "nothing half-written");
  // The claim goes stale; a student retry never opens a second checkout.
  await sql("UPDATE payment_attempts SET claimed_at = '2026-11-01T00:00:00.000Z' WHERE id = ?1", o.id);
  const c0 = inits();
  await expectErr(o.retry(), 409, "payment_needs_check");
  assert.equal(inits() - c0, 0);
  assert.equal((await att(o.id)).state, "uncertain");
  // Finance tries to release: Paystack reports the success, which is recorded; the attempt is never released.
  await settled(w, o.id);
  verify = () => Response.json({ status: true, message: "Verification successful", data: c });
  try { await expectErr(release(fin, o.id), 409, "paid_at_paystack"); } finally { verify = ABANDONED; }
  a = await att(o.id);
  assert.deepEqual([a.state, a.outcome, (await instOf(o.id)).status], ["uncertain", "paid", "paid"]);
  // Paystack's retried webhook converges: no second payment.
  assert.equal((await webhook("charge.success", c)).status, 200);
  assert.equal((await paymentsFor(a.instalment_id)).length, 1);
});

test("E4.13 recovery while the outcome stays unknown: audited, stored as unknown, still on hold, no new checkout", async () => {
  const o = await order();
  verify = () => new Response("unavailable", { status: 503 });
  try {
    for (let i = 0; i < 2; i++) assert.equal((await check(fin, o.id, `Daily reconciliation ${i}`)).status, 200);
  } finally { verify = ABANDONED; }
  const a = await att(o.id);
  assert.deepEqual([a.state, a.verified_status, a.outcome], ["uncertain", "unknown", null]);
  const audit = await sql<{ actor_id: string; detail: string }>("SELECT actor_id, detail FROM audit_log WHERE action = 'payment.attempt_check' AND target_id = ?1 ORDER BY rowid", o.id);
  assert.equal(audit.length, 2);
  assert.match(audit[1].detail, /"reason":"Daily reconciliation 1"/);
  assert.match(audit[1].detail, /"evidence":"unknown"/);
  assert.equal(audit[1].actor_id, (await sql<{ id: string }>("SELECT id FROM users WHERE email = 'fin@example.com'"))[0].id);
  const c0 = inits();
  await expectErr(o.retry(), 409, "payment_needs_check");
  assert.equal(inits() - c0, 0, "no automatic retry");
  assert.equal(await n("payment_attempts WHERE instalment_id = ?1", a.instalment_id), 1, "no second attempt");
});

test("E4.14 recovery after Paystack confirms the payment: recorded once, attempt closed as paid", async () => {
  const o = await order();
  verify = await successFor(o.id);
  try {
    const r = await body<{ attempt: Att; instalment: { status: string } }>(await check(fin, o.id));
    assert.deepEqual([r.attempt.outcome, r.instalment.status], ["paid", "paid"]);
    assert.equal((await check(fin, o.id)).status, 200, "a second recovery check is harmless");
  } finally { verify = ABANDONED; }
  const a = await att(o.id);
  assert.equal((await paymentsFor(a.instalment_id)).length, 1);
  await expectErr(release(fin, o.id), 409, "not_uncertain");
  await expectErr(o.retry(), 200);
  assert.equal(await n("payment_attempts WHERE instalment_id = ?1", a.instalment_id), 1);
});

// ================================================================ 15-18: stale workers and business rules ====
test("E4.15 a stale worker cannot overwrite a newer payment state", async () => {
  // (a) Run A is paused inside its Paystack check; another officer checks meanwhile (a newer version). A's answer is
  // discarded and A releases nothing.
  const o = await order();
  await settled(w, o.id);
  armHold();
  const pendingA = release(fin, o.id);
  await waitHold();
  assert.equal((await check(fin2, o.id)).status, 200);
  const newer = await att(o.id);
  hold.open!();
  await expectErr(pendingA, 409, "changed");
  const a = await att(o.id);
  assert.deepEqual([a.state, a.version, a.verified_at], ["uncertain", newer.version, newer.verified_at], "the newer evidence stands");
  // (b) A release statement for an old version changes nothing.
  const r = await (await w.db()).prepare("UPDATE payment_attempts SET state = 'released' WHERE id = ?1 AND state IN ('uncertain', 'claimed') AND version = ?2").bind(o.id, a.version - 1).run();
  assert.equal(r.meta.changes, 0);
  assert.equal((await att(o.id)).state, "uncertain");
  // (c) A stale initialisation result cannot overwrite an attempt another request already marked uncertain.
  assert.equal(await n("payment_attempts WHERE id = ?1 AND state = 'initialized'", o.id), 0);
});

test("E4.16 a confirmed payment can never be released, by any path", async () => {
  const o = await order();
  await webhook("charge.success", await charge(o.id));
  const a = await att(o.id);
  assert.deepEqual([a.state, a.outcome], ["uncertain", "paid"]);
  await expectErr(release(fin, o.id), 409, "not_uncertain");
  await exec(`UPDATE payment_attempts SET verified_status = 'abandoned', verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), first_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 minutes'), version = version + 1, verified_version = version + 1 WHERE id = '${o.id}'`).catch(() => undefined);
  await assert.rejects(sql("UPDATE payment_attempts SET state = 'released' WHERE id = ?1", o.id), /payment_release_refused/);
  assert.equal((await att(o.id)).state, "uncertain");
  // An attempt already released cannot be released again.
  const o2 = await order();
  await settled(w, o2.id);
  assert.equal((await release(fin, o2.id)).status, 200);
  await expectErr(release(fin, o2.id), 409, "not_uncertain");
  assert.equal(await n("audit_log WHERE action = 'payment.attempt_release' AND target_id = ?1", o2.id), 1);
});

test("E4.17 an unresolved attempt blocks a second checkout", async () => {
  const o = await order();
  const c0 = inits();
  for (let i = 0; i < 3; i++) await expectErr(o.retry(), 409, "payment_needs_check");
  assert.equal(inits() - c0, 0);
  const inst = (await att(o.id)).instalment_id;
  await assert.rejects(sql("INSERT INTO payment_attempts (id, order_id, instalment_id, attempt, reference, state, claimed_at, updated_at) SELECT 'dup', order_id, instalment_id, 9, reference || '-D', 'claimed', 'now', 'now' FROM payment_attempts WHERE id = ?1", o.id), /UNIQUE/);
  // A money arrival that needs a person (successful charge with the wrong amount) also blocks new checkouts, even
  // after the attempt itself is no longer active.
  const o2 = await order("refuse");
  assert.equal((await att(o2.id)).state, "failed");
  await webhook("charge.success", await charge(o2.id, { amount: 100 }));
  assert.equal((await att(o2.id)).outcome, "reconcile");
  const c1 = inits();
  await expectErr(o2.retry(), 409, "payment_needs_check");
  assert.equal(inits() - c1, 0);
  assert.equal(await n("payment_attempts WHERE instalment_id = ?1", (await att(o2.id)).instalment_id), 1);
  assert.equal(await n("payment_attempts WHERE instalment_id = ?1", inst), 1);
});

test("E4.18 genuinely resolved attempts follow the existing business rules", async () => {
  // A definite initialisation refusal (no Paystack transaction exists): the student's retry opens attempt 2 (D.1.1 rule).
  const o = await order("refuse");
  plan = ["ok"];
  assert.equal((await o.retry()).status, 200);
  assert.deepEqual((await sql<{ attempt: number; state: string }>("SELECT attempt, state FROM payment_attempts WHERE instalment_id = ?1 ORDER BY attempt", (await att(o.id)).instalment_id)).map((r) => [r.attempt, r.state]), [[1, "failed"], [2, "initialized"]]);
  // An uncertain attempt with definite, settled, fresh evidence: released with a reason; the student may open ONE new
  // checkout themselves; the release itself calls nothing at Paystack except the read-only verification.
  const o2 = await order();
  await settled(w, o2.id);
  const c0 = inits();
  const r = await body<{ attempt: Att }>(await release(fin, o2.id));
  assert.equal(r.attempt.state, "released");
  assert.equal(inits() - c0, 0, "a release is never a retry");
  const audit = (await sql<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'payment.attempt_release' AND target_id = ?1", o2.id))[0];
  assert.match(audit.detail, /"evidence":"20/);
  plan = ["ok"];
  assert.equal((await o2.retry()).status, 200);
  assert.equal(inits() - c0, 1);
});

test("E4.parity the commit-time payment_evidence condition is false for an old version or a recorded outcome", async () => {
  const o = await order();
  const probe = async (version: number) => {
    const c = releaseConditions({ attemptId: o.id, requesterId: "x", claimedBefore: new Date().toISOString(), version }).find((x) => x.name === "payment_evidence")!;
    const q = probeSql(c);
    return (await (await w.db()).prepare(q.sql).bind(...q.vals).first<{ ok: number }>())!.ok;
  };
  const v = (await att(o.id)).version;
  assert.deepEqual([await probe(v), await probe(v - 1), await probe(v + 1)], [1, 0, 0]);
  await webhook("charge.success", await charge(o.id));
  assert.equal(await probe((await att(o.id)).version), 0, "an outcome fails it even at the current version");
});

// ================================================================ migration ====
test("E4.migration 0018 preserves every historical payment record and adds fail-closed defaults", async () => {
  const old = await startWorker({ env: { ...SECRETS }, migrationsUpTo: "0017_execution_fencing.sql" });
  try {
    const db = await old.db();
    const q = async (s: string) => (await db.prepare(s).all<Record<string, unknown>>()).results;
    // Historical records written by the 0017 schema: an order with a stored checkout attempt, and a recorded payment.
    const r = await old.post("/api/register", registration({ programme: "cloud", method: "paystack", idempotencyKey: crypto.randomUUID(), plan: "parts", learner: { ...registration().learner, email: "hist@example.com", country: "Nigeria", countryCode: "NG" } }));
    assert.equal(r.status, 200, await r.clone().text());
    const [hist] = await q("SELECT a.reference, i.amount_kobo FROM payment_attempts a JOIN instalments i ON i.id = a.instalment_id");
    const payload = JSON.stringify({ event: "charge.success", data: { id: 5501, reference: hist.reference, amount: hist.amount_kobo, currency: "NGN", status: "success", paid_at: "2026-11-27T10:00:00.000Z" } });
    assert.equal((await old.fetchApi("/api/paystack/webhook", { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", SECRETS.PAYSTACK_SECRET_KEY).update(payload).digest("hex") }, body: payload })).status, 200);
    const snap = async () => JSON.stringify([await q("SELECT id, order_id, instalment_id, attempt, reference, state, authorization_url, access_code, detail, claimed_at, updated_at, released_by, released_reason FROM payment_attempts ORDER BY id"),
      await q("SELECT * FROM payments ORDER BY id"), await q("SELECT * FROM instalments ORDER BY id"), await q("SELECT * FROM orders ORDER BY id"), await q("SELECT * FROM webhook_events ORDER BY id")]);
    const before = await snap();
    assert.deepEqual(await old.applyPending(), ["0018_payment_reconciliation.sql"]);
    assert.equal(await snap(), before, "no historical value changed");
    const cols = (await q("PRAGMA table_info(payment_attempts)")).map((c) => c.name);
    for (const c of ["version", "verified_status", "verified_at", "verified_version", "first_verified_at", "outcome", "resolved_by", "resolved_reason"]) assert.ok(cols.includes(c), c);
    assert.deepEqual(await q("SELECT version, verified_status, outcome FROM payment_attempts"), [{ version: 0, verified_status: null, outcome: null }], "existing attempts start with no evidence (fail closed)");
    const trig = (await q("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'payment%' OR name = 'instalments_paid_kept') ORDER BY name")).map((t) => t.name);
    assert.deepEqual(trig, ["instalments_paid_kept", "payment_attempts_checkout_guard", "payment_attempts_outcome_kept", "payment_attempts_release_guard", "payment_attempts_version", "payments_attempt_outcome", "payments_duplicate_bank"]);
  } finally { await old.dispose(); }
});

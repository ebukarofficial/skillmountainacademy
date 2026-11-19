// Phase 6: server pricing, Paystack, instalments and group classes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { FLAGS, PROGRAMMES } from "../lib/config.ts";
import { dueDays, lagosDate, planParts, splitNaira } from "../lib/pricing.ts";
import { read } from "./helpers.ts";
import { SECRETS, learner, registration, startWorker } from "./worker-harness.ts";

const sign = (body: string) => createHmac("sha512", SECRETS.PAYSTACK_SECRET_KEY).update(body).digest("hex");
type Reg = { reference: string; totalNaira: number; payNowNaira: number; parts: { seq: number; naira: number; due: string }[]; authorizationUrl: string };

test("acceptance 8: instalments always add up exactly (50/30/20, whole naira, last part takes the remainder)", () => {
  for (const total of [300000, 350000, 450000, 650000, 1, 7, 99, 100001, 333333, 999999]) {
    const parts = splitNaira(total);
    assert.equal(parts.length, 3);
    assert.equal(parts.reduce((a, b) => a + b, 0), total, String(total));
    assert.ok(parts.every((n) => Number.isInteger(n) && n >= 0));
  }
  assert.deepEqual(splitNaira(450000), [225000, 135000, 90000]);
  assert.deepEqual(planParts(450000, "full"), [450000]);
  for (const p of PROGRAMMES) assert.deepEqual(dueDays(p), p.trainingMonths <= 3 ? [0, 30, 60] : [0, 45, 90], p.slug);
});

let w: Awaited<ReturnType<typeof startWorker>>;
before(async () => { w = await startWorker({ mock: (req, body) => {
  const u = new URL(req.url);
  if (u.host === "api.paystack.co" && u.pathname.startsWith("/transaction/verify/")) {
    const ref = decodeURIComponent(u.pathname.split("/").pop()!);
    const amount = Number(u.searchParams.get("a") ?? 0) || verifyAmounts.get(ref) || 0;
    return Response.json({ status: true, data: { id: 9000 + verifyAmounts.size, reference: ref, amount, currency: "NGN", status: "success", paid_at: new Date().toISOString() } });
  }
  void body;
  return undefined;
} }); });
after(async () => { await w.dispose(); });
const verifyAmounts = new Map<string, number>();

async function register(over: Record<string, unknown> = {}, ip = "198.18.0.1") {
  const r = await w.post("/api/register", registration({ learner: learner({ email: `p6-${Math.random().toString(36).slice(2)}@example.com` }), ...over }), { "cf-connecting-ip": ip });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json() as Promise<Reg>;
}
const paystackRefOf = (reg: Reg, part = 1) => {
  const init = w.calls.filter((c) => c.url.endsWith("/transaction/initialize")).map((c) => JSON.parse(c.body)).find((b) => b.reference.startsWith(`${reg.reference}-P${part}`));
  assert.ok(init, "Paystack initialize was called");
  return init as { reference: string; amount: number; currency: string; email: string };
};
const webhook = (data: Record<string, unknown>, sig?: string) => {
  const body = JSON.stringify({ event: "charge.success", data });
  return w.fetchApi("/api/paystack/webhook", { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": sig ?? sign(body), origin: "https://api.paystack.co" }, body });
};

test("acceptance 7: the Worker initialises Paystack with the server's amount; browser-sent prices change nothing", async () => {
  const reg = await register({ plan: "parts", price: 100, amount: 100, payNowNaira: 1, parts: [1, 1, 1], totalNaira: 3 });
  assert.equal(reg.totalNaira, 450000);
  assert.deepEqual(reg.parts.map((p) => p.naira), [225000, 135000, 90000]);
  const init = paystackRefOf(reg);
  assert.equal(init.amount, 22_500_000, "part 1 in kobo");
  assert.equal(init.currency, "NGN");
  assert.match(reg.authorizationUrl, /^https:\/\/checkout\.paystack\.com\//);
  const sum = await (await w.db()).prepare("SELECT o.total_kobo, SUM(i.amount_kobo) AS s, GROUP_CONCAT(i.due_date) AS d FROM orders o JOIN instalments i ON i.order_id = o.id WHERE o.reference = ?").bind(reg.reference).first<{ total_kobo: number; s: number; d: string }>();
  assert.equal(sum?.s, sum?.total_kobo, "D1 instalments add up to the order total");
  const now = new Date();
  assert.deepEqual(sum?.d.split(","), [lagosDate(now, 0), lagosDate(now, 45), lagosDate(now, 90)]);
  const m = await register({ programme: "marketing", plan: "parts" });
  assert.deepEqual(m.parts.map((p) => p.due), [lagosDate(now, 0), lagosDate(now, 30), lagosDate(now, 60)], "3-month training: 0/30/60");
  assert.equal(m.parts.reduce((a, b) => a + b.naira, 0), 300000);
});

test("webhook: bad signature refused; valid charge recorded once (idempotent); wrong amount ignored", async () => {
  const reg = await register({ plan: "parts" });
  const init = paystackRefOf(reg);
  const data = { id: 555001, reference: init.reference, amount: init.amount, currency: "NGN", status: "success", paid_at: new Date().toISOString() };
  const bad = await webhook(data, "0".repeat(128));
  assert.equal(bad.status, 401);
  const emailsBefore = w.calls.filter((c) => c.url.includes("api.resend.com")).length;
  const first = await (await webhook(data)).json() as { result: string };
  assert.equal(first.result, "recorded");
  const again = await (await webhook(data)).json() as { result: string };
  assert.equal(again.result, "duplicate", "Paystack retries are harmless");
  const db = await w.db();
  const pays = await db.prepare("SELECT COUNT(*) AS n FROM payments WHERE provider_ref = ?").bind(init.reference).first<{ n: number }>();
  assert.equal(pays?.n, 1, "one payment row");
  const o = await db.prepare("SELECT status FROM orders WHERE reference = ?").bind(reg.reference).first<{ status: string }>();
  assert.equal(o?.status, "part_paid");
  const inst = await db.prepare("SELECT status, paid_at FROM instalments WHERE reference = ?").bind(`${reg.reference}-P1`).first<{ status: string; paid_at: string }>();
  assert.equal(inst?.status, "paid");
  assert.ok(await w.waitFor((c) => c.filter((x) => x.url.includes("api.resend.com")).length >= emailsBefore + 2), "welcome + owner emails");
  await new Promise((r) => setTimeout(r, 300));
  const welcome = w.calls.filter((x) => x.url.includes("api.resend.com") && x.body.includes("Welcome to Skill Mountain Academy"));
  assert.equal(welcome.filter((x) => x.body.includes(init.email)).length, 1, "welcome sent once even though the webhook came twice");
  assert.ok(w.calls.some((x) => x.url.includes("script.google.com") && x.body.includes('"action":"payment"') && x.body.includes(reg.reference)), "payment mirrored to the sheet");

  const reg2 = await register();
  const i2 = paystackRefOf(reg2);
  const short = await (await webhook({ id: 555002, reference: i2.reference, amount: i2.amount - 100, currency: "NGN", status: "success" })).json() as { result: string };
  assert.equal(short.result, "ignored", "underpayment is not marked paid");
  const usd = await (await webhook({ id: 555003, reference: i2.reference, amount: i2.amount, currency: "USD", status: "success" })).json() as { result: string };
  assert.equal(usd.result, "ignored");
  const unknown = await webhook({ id: 555004, reference: "SMA-AAAAAAAAAAAA-P1-ZZZZ", amount: 1, currency: "NGN", status: "success" });
  assert.equal(unknown.status, 200, "unknown references are acknowledged so Paystack stops retrying");
});

test("return from Paystack: /api/order asks Paystack if the webhook has not arrived, and records the payment once", async () => {
  const reg = await register();
  const init = paystackRefOf(reg);
  verifyAmounts.set(init.reference, init.amount);
  const r = await w.fetchApi(`/api/order?ref=${reg.reference}&trxref=${init.reference}`);
  const j = await r.json() as { status: string; parts: { status: string }[] };
  assert.equal(j.status, "paid");
  assert.equal(j.parts[0].status, "paid");
  assert.ok(!JSON.stringify(j).includes("@"), "no personal data in the status response");
  const r2 = await (await w.fetchApi(`/api/order?ref=${reg.reference}&trxref=${init.reference}`)).json() as { status: string };
  assert.equal(r2.status, "paid");
  const n = await (await w.db()).prepare("SELECT COUNT(*) AS n FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.reference = ?").bind(reg.reference).first<{ n: number }>();
  assert.equal(n?.n, 1);
  assert.equal((await w.fetchApi("/api/order?ref=nonsense")).status, 400);
});

test("instalments: reminder 3 days before, signed Paystack link on the due date, overdue marked, owner told after 2 weeks", async () => {
  const reg = await register({ plan: "parts" }, "198.18.0.2");
  const init = paystackRefOf(reg);
  await webhook({ id: 556001, reference: init.reference, amount: init.amount, currency: "NGN", status: "success" });
  const worker = await w.mf.getWorker();
  const base = new Date();
  const at = (days: number) => new Date(`${lagosDate(base, days)}T05:00:00Z`);
  const mailsTo = (s: string) => w.calls.filter((c) => c.url.includes("api.resend.com") && c.body.includes(s));

  await worker.scheduled({ cron: "0 5,17 * * *", scheduledTime: at(42) });
  assert.ok(await w.waitFor(() => mailsTo("is due in 3 days").some((c) => c.body.includes(init.email))), "reminder 3 days before part 2");
  await worker.scheduled({ cron: "0 5,17 * * *", scheduledTime: at(42) });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(mailsTo("is due in 3 days").filter((c) => c.body.includes(init.email) && c.body.includes("part 2")).length, 1, "reminder sent once");

  await worker.scheduled({ cron: "0 5,17 * * *", scheduledTime: at(45) });
  assert.ok(await w.waitFor(() => mailsTo("Payment link").some((c) => c.body.includes(init.email))), "payment link on the due date");
  const linkMail = mailsTo("Payment link").find((c) => c.body.includes(init.email))!;
  const link = JSON.parse(linkMail.body).html.match(/href="([^"]*\/api\/pay\?[^"]*)"/)[1].replace(/&amp;/g, "&");
  assert.match(link, new RegExp(`/api/pay\\?ref=${reg.reference}-P2&t=[0-9a-f]{32}`));
  assert.match(JSON.parse(linkMail.body).html, /paused if a payment is more than 2 weeks late/);

  const go = await w.fetchApi(link.replace("https://skillmountainacademy.com", ""), { redirect: "manual" });
  assert.equal(go.status, 302);
  assert.match(go.headers.get("location")!, new RegExp(`checkout\\.paystack\\.com/${reg.reference}-P2-`));
  assert.equal(paystackRefOf(reg, 2).amount, 13_500_000, "part 2 = 30%");
  const forged = await w.fetchApi(`/api/pay?ref=${reg.reference}-P2&t=${"0".repeat(32)}`, { redirect: "manual" });
  assert.equal(forged.status, 400, "links cannot be forged");

  await worker.scheduled({ cron: "0 5,17 * * *", scheduledTime: at(46) });
  const st = await (await w.db()).prepare("SELECT status FROM instalments WHERE reference = ?").bind(`${reg.reference}-P2`).first<{ status: string }>();
  assert.equal(st?.status, "overdue");
  await worker.scheduled({ cron: "0 5,17 * * *", scheduledTime: at(60) });
  assert.ok(await w.waitFor(() => mailsTo("more than 2 weeks late").some((c) => c.body.includes(reg.reference))), "owner digest");
  const evening = w.calls.length;
  await worker.scheduled({ cron: "0 5,17 * * *", scheduledTime: new Date(`${lagosDate(base, 61)}T17:00:00Z`) });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(w.calls.slice(evening).every((c) => !c.url.includes("api.resend.com")), "the 18:00 run only refreshes rates");
});

test("group classes: hidden and refused while GROUP_ENABLED is off", async () => {
  assert.equal(FLAGS.GROUP_ENABLED, false);
  assert.ok(PROGRAMMES.every((p) => p.groupPrice === null));
  const r = await w.post("/api/register", registration({ members: [{ name: "Tolu", email: "tolu@example.com" }], learner: learner({ email: "g0@example.com" }) }), { "cf-connecting-ip": "198.18.0.3" });
  assert.equal(r.status, 400);
  assert.match((await r.json() as { message: string }).message, /Group classes are not available/);
  assert.match(read("app/checkout/server-pay.tsx"), /const groupOn = FLAGS\.GROUP_ENABLED && p\.groupPrice != null;/);
  assert.match(read("app/checkout/server-pay.tsx"), /\{groupOn && \(/);
});

test("group classes when switched on: 2-3 people, one group price, each learner gets their own record", async () => {
  const g = await startWorker({ patch: `FLAGS.GROUP_ENABLED = true; PROGRAMMES.find((p) => p.slug === "cloud").groupPrice = 600000;` });
  try {
    const r = await g.post("/api/register", registration({ members: [{ name: "Tolu", email: "tolu@example.com" }, { name: "Emeka", email: "emeka@example.com" }], learner: learner({ email: "lead@example.com" }) }));
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json() as { reference: string; totalNaira: number };
    assert.equal(j.totalNaira, 600000);
    const db = await g.db();
    const o = await db.prepare("SELECT group_size, registration_id FROM orders WHERE reference = ?").bind(j.reference).first<{ group_size: number; registration_id: string }>();
    assert.equal(o?.group_size, 3);
    const members = await db.prepare("SELECT email FROM registrations WHERE lead_id = ? AND role = 'group_member' ORDER BY email").bind(o?.registration_id).all<{ email: string }>();
    assert.deepEqual(members.results.map((m) => m.email), ["emeka@example.com", "tolu@example.com"]);
    const tooMany = await g.post("/api/register", registration({ members: [1, 2, 3].map((i) => ({ name: `F${i}`, email: `f${i}@example.com` })), learner: learner({ email: "lead2@example.com" }) }));
    assert.equal(tooMany.status, 400);
    const other = await g.post("/api/register", registration({ programme: "devops", members: [{ name: "A", email: "a@example.com" }], learner: learner({ email: "lead3@example.com" }) }));
    assert.equal(other.status, 400, "no group price set for DevOps: option unavailable");
  } finally { await g.dispose(); }
});

test("payments not set up: card payment gives a clear 503, bank transfer still works", async () => {
  const x = await startWorker({ env: { ...SECRETS, PAYSTACK_SECRET_KEY: "" } });
  try {
    const card = await x.post("/api/register", registration());
    assert.equal(card.status, 503);
    assert.match((await card.json() as { message: string }).message, /bank transfer/);
    const bank = await x.post("/api/register", registration({ method: "bank", learner: learner({ email: "bank@example.com" }) }));
    assert.equal(bank.status, 200);
    const wh = await x.fetchApi("/api/paystack/webhook", { method: "POST", body: "{}" });
    assert.equal(wh.status, 503);
  } finally { await x.dispose(); }
});

test("checkout: server flow only when the backend is ready; otherwise the original checkout keeps working", () => {
  const sp = read("app/checkout/server-pay.tsx");
  assert.match(sp, /const server = !!ready\.database && !!ready\.turnstile && !!CFG\.turnstileSiteKey;/);
  assert.match(sp, /\.catch\(\(\) => \{ if \(!off\) setB\(\{ mode: "legacy"/);
  assert.match(sp, /Live-session access is paused if a payment is more than 2 weeks late\./);
  const page = read("app/checkout/page.tsx");
  assert.match(page, /backend\.mode === "server"/);
  assert.match(page, /backend\.mode === "legacy"/);
  assert.match(page, /window\.PaystackPop\.setup/, "original Paystack popup flow kept as the fallback");
});

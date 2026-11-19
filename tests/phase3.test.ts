// Phase 3: Worker + D1 forms. Runs the real Worker in Miniflare with a local D1 database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seedSql } from "../scripts/seed.mts";
import { read } from "./helpers.ts";
import { SECRETS, registration, startWorker } from "./worker-harness.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
before(async () => { w = await startWorker(); });
after(async () => { await w.dispose(); });

test("GET /api/status reports what is set up", async () => {
  const j = await (await w.fetchApi("/api/status")).json() as { ready: Record<string, boolean>; flags: Record<string, boolean> };
  assert.deepEqual(j.ready, { database: true, turnstile: true, payments: true, email: true, holds: true, sheetMirror: true });
  assert.deepEqual(j.flags, { GROUP_ENABLED: false, CHILDREN_ENABLED: false });
});

test("non-API paths fall through to the static site; unknown API paths are 404", async () => {
  assert.equal(await (await w.fetchApi("/api/nope")).status, 404);
  assert.equal(await (await w.fetchApi("/api/register")).status, 405);
});

test("acceptance 11: registration is rejected without a valid Turnstile token", async () => {
  const none = await w.post("/api/register", registration({ turnstileToken: undefined, learner: { ...registration().learner, email: "t1@example.com" } }));
  assert.equal(none.status, 400);
  assert.equal((await none.json() as { error: string }).error, "turnstile");
  const bad = await w.post("/api/register", registration({ turnstileToken: "forged", learner: { ...registration().learner, email: "t2@example.com" } }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json() as { error: string }).error, "turnstile");
  const verify = w.calls.filter((c) => c.url.includes("siteverify"));
  assert.ok(verify.some((c) => c.body.includes("ts-secret") && c.body.includes("forged")), "token sent to Cloudflare with the secret");
  const n = await (await w.db()).prepare("SELECT COUNT(*) AS n FROM registrations WHERE email IN ('t1@example.com','t2@example.com')").first<{ n: number }>();
  assert.equal(n?.n, 0, "nothing saved");
});

test("registration is saved to D1 atomically (learner, order, instalment), emailed and mirrored to the sheet", async () => {
  const r = await w.post("/api/register", registration({ method: "bank", learner: { ...registration().learner, email: "save@example.com" } }));
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json() as { reference: string; totalNaira: number; bank: unknown };
  assert.match(j.reference, /^SMA-BT-[A-Z0-9]{12}$/);
  assert.equal(j.totalNaira, 450000);
  assert.ok(j.bank);
  const db = await w.db();
  const order = await db.prepare("SELECT * FROM orders WHERE reference = ?").bind(j.reference).first<Record<string, unknown>>();
  assert.equal(order?.total_kobo, 45_000_000);
  assert.equal(order?.method, "bank");
  const reg = await db.prepare("SELECT * FROM registrations WHERE id = ?").bind(order?.registration_id).first<Record<string, unknown>>();
  assert.equal(reg?.email, "save@example.com");
  assert.equal(reg?.role, "learner");
  assert.ok(String(reg?.ip_hash).length === 64, "IP stored only as a hash");
  const inst = await db.prepare("SELECT * FROM instalments WHERE order_id = ?").bind(order?.id).all();
  assert.equal(inst.results.length, 1);
  assert.ok(await w.waitFor((c) => c.filter((x) => x.url.includes("api.resend.com") && x.body.includes("save@example.com")).length >= 1), "learner email sent");
  assert.ok(await w.waitFor((c) => c.some((x) => x.url.includes("script.google.com") && x.body.includes(j.reference))), "mirrored to sheet");
  const mirror = JSON.parse(w.calls.find((x) => x.url.includes("script.google.com") && x.body.includes(j.reference))!.body);
  assert.equal(mirror.action, "apply");
  assert.equal(mirror.source, "worker");
  assert.equal(mirror.programme, "Cloud Engineering");
  assert.equal(mirror.notify, false, "Resend sent the email, so the Apps Script should not");
});

test("validation: missing fields and under-18 without a guardian are rejected", async () => {
  const r = await w.post("/api/register", registration({ learner: { firstName: "", email: "bad" } }));
  assert.equal(r.status, 400);
  const j = await r.json() as { error: string; message: string };
  assert.equal(j.error, "invalid");
  assert.match(j.message, /First name is required/);
  assert.match(j.message, /Email address is not valid/);
  const minor = await w.post("/api/register", registration({ learner: { ...registration().learner, adult: "No", email: "minor@example.com" } }));
  assert.match((await minor.json() as { message: string }).message, /parent or guardian/);
  const unknown = await w.post("/api/register", registration({ programme: "ielts" }));
  assert.equal(unknown.status, 400);
});

test("posts from other websites are refused (CSRF)", async () => {
  const r = await w.post("/api/register", registration(), { origin: "https://evil.example" });
  assert.equal(r.status, 403);
});

test("the hidden honeypot field saves nothing", async () => {
  const r = await w.post("/api/register", registration({ website: "spam", learner: { ...registration().learner, email: "bot@example.com" } }));
  assert.equal(r.status, 200);
  const n = await (await w.db()).prepare("SELECT COUNT(*) AS n FROM registrations WHERE email = 'bot@example.com'").first<{ n: number }>();
  assert.equal(n?.n, 0);
});

test("rate limit: the 6th registration from one address in 10 minutes is refused", async () => {
  const ip = { "cf-connecting-ip": "198.51.100.9" };
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) codes.push((await w.post("/api/register", registration({ method: "bank", learner: { ...registration().learner, email: `rl${i}@example.com` } }), ip)).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
});

test("children's enquiry: Turnstile required, saved to D1, emailed to the owner", async () => {
  const body = { parentName: "Ngozi Obi", email: "ngozi@example.com", phone: "08030000000", childAge: 11, programme: "Graphics Design", consent: true, turnstileToken: "good-token" };
  const noToken = await w.post("/api/children-enquiry", { ...body, turnstileToken: "" });
  assert.equal(noToken.status, 400);
  const ok = await w.post("/api/children-enquiry", body);
  assert.equal(ok.status, 200, await ok.clone().text());
  const row = await (await w.db()).prepare("SELECT * FROM children_enquiries WHERE email = 'ngozi@example.com'").first<Record<string, unknown>>();
  assert.equal(row?.child_age, 11);
  assert.ok(await w.waitFor((c) => c.some((x) => x.url.includes("api.resend.com") && x.body.includes("admin@example.com") && x.body.includes("Ngozi"))));
  const badAge = await w.post("/api/children-enquiry", { ...body, childAge: 30 });
  assert.equal(badAge.status, 400);
});

test("fails safely: no database or no Turnstile secret gives a clear 503, never a crash", async () => {
  const noDb = await startWorker({ db: false });
  try {
    const r = await noDb.post("/api/register", registration());
    assert.equal(r.status, 503);
    const j = await r.json() as { error: string; message: string };
    assert.equal(j.error, "not_configured");
    assert.match(j.message, /not set up yet/);
    const s = await (await noDb.fetchApi("/api/status")).json() as { ready: { database: boolean } };
    assert.equal(s.ready.database, false);
  } finally { await noDb.dispose(); }
  const noTs = await startWorker({ env: { ...SECRETS, TURNSTILE_SECRET: "" } });
  try {
    const r = await noTs.post("/api/children-enquiry", { parentName: "A", email: "a@example.com", phone: "08030000000", childAge: 9, programme: "Not sure yet", consent: true, turnstileToken: "good-token" });
    assert.equal(r.status, 503);
  } finally { await noTs.dispose(); }
});

test("fails safely: tables not created yet (migrations not applied) gives 503", async () => {
  const fresh = await startWorker();
  try {
    await (await fresh.db()).prepare("DROP TABLE rate_limits").run();
    const r = await fresh.post("/api/register", registration());
    assert.equal(r.status, 503);
  } finally { await fresh.dispose(); }
});

test("programme seed SQL matches lib/config.ts and all SQL uses bound values", () => {
  assert.equal(readFileSync(new URL("../db/seed-programmes.sql", import.meta.url), "utf8"), seedSql(), "run: npm run db:seed-sql");
  const repo = read("src/server/repo.ts");
  assert.doesNotMatch(repo, /prepare\(`[^`]*\$\{(?!cols|table|insert)/, "no values interpolated into SQL");
  for (const f of ["src/server/routes/register.ts", "src/server/routes/children.ts", "src/server/routes/payments.ts", "src/server/routes/hold.ts", "src/server/cron.ts"]) {
    assert.doesNotMatch(read(f), /\.prepare\(/, `${f} must use the repository layer`);
  }
});

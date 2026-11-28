// Expansion Stage B: database-backed programme catalogue, six schools, separate international (USD) and local (NGN)
// tuition, publication controlled by the owner. Real requests to the real Worker (Miniflare) plus data-level checks.
// boss@example.com is the configured owner; owner@example.com (harness ADMIN_EMAILS) is an unassigned legacy administrator.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { startWorker, SECRETS, registration } from "./worker-harness.ts";
import { signIn as helperSignIn, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { PROGRAMMES_2027, SCHOOLS_2027, RESERVED_SLUGS as RESERVED_2027 } from "../lib/catalogue-2027.ts";
import { CATALOGUE_SOURCE, PROGRAMMES, SEED_PROGRAMMES, programmeName, REMOVED_SLUGS, ALLOWED_TONES } from "../lib/config.ts";
import { internationalAmount, type Rates } from "../lib/pricing.ts";
import { render, validateSnapshot } from "../scripts/catalogue-export.mts";

type W = Awaited<ReturnType<typeof startWorker>>;
const OWNER = "boss@example.com";
const MFA_KEY = Buffer.alloc(32, 9).toString("base64");
let w: W;
let owner: Session, legacy: Session, academic: Session, finance: Session;

const resetLimits = async (x: W) => { await (await x.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (x: W, email: string) => { await resetLimits(x); return helperSignIn(x, email); };
async function strong(x: W, email: string) {
  const s = await signIn(x, email);
  const secret = (await s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await s.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
  return s;
}
const errOf = async (r: Response) => ((await r.json()) as { error: string }).error;
const audits = async (action: string, target?: string) => (await (await w.db()).prepare("SELECT detail FROM audit_log WHERE action = ?1 AND (?2 IS NULL OR target_id = ?2) ORDER BY at")
  .bind(action, target ?? null).all<{ detail: string }>()).results.map((r) => JSON.parse(r.detail ?? "null"));
const publicCatalogue = async () => (await (await w.fetchApi("/api/catalogue")).json()) as { source: string; programmes: { slug: string; name: string; price: number; trainingMonths: number; internshipMonths: number; priceUsdCents: number | null; school: string | null }[]; retired: { slug: string; name: string }[]; schools: unknown[] };
const quote = (slug: string) => w.fetchApi(`/api/quote?programme=${slug}&country=NG`);
const COMPLETE = { blurb: "A complete short description.", level: "Beginner to advanced", learn: ["Outcome one", "Outcome two", "Outcome three"] };

// The owner's 27 Nov 2026 table, typed independently of lib/catalogue-2027.ts so a change to either is caught.
const OWNER_TABLE: [string, number, number, number][] = [
  ["AI Automation & Agentic Systems", 500, 1, 1], ["AI Engineering & LLM Application Development", 1500, 5, 2], ["AI Chatbot & Conversational AI Development", 950, 3, 2],
  ["AI Data Annotation & Model Evaluation", 450, 2, 1], ["Web Development & Full-Stack Engineering", 1350, 5, 2], ["Python Programming & Applied Software Development", 1050, 4, 2],
  ["Software Testing & Quality Assurance Engineering", 1050, 4, 2], ["Cloud Engineering", 1500, 5, 2], ["DevOps Engineering", 1500, 5, 2], ["Cybersecurity", 1650, 5, 2],
  ["Data Analytics & Business Intelligence", 1050, 4, 2], ["Data Science & Machine Learning", 1850, 6, 2], ["Graphic Design & Brand Identity", 650, 3, 1], ["UI/UX Design", 850, 4, 1],
  ["Product Management", 850, 4, 1], ["AI Video Production & Professional Video Editing", 700, 3, 1], ["Digital Marketing & Growth Strategy", 850, 4, 1],
  ["Virtual Assistance & Remote Business Operations", 550, 3, 1], ["Project Management", 850, 4, 1], ["Business Analysis", 850, 4, 1], ["Technical Writing & Documentation", 650, 3, 1],
];

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: MFA_KEY } });
  legacy = await signIn(w, "owner@example.com");
  owner = await strong(w, OWNER);
  await owner.json("POST", "/api/app/owner/bootstrap");
  const mk = async (email: string, adminRole: string) => (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role: "admin", adminRole, fullName: email.split("@")[0], sendInvite: false })).user.id;
  await mk("academic@example.com", "academic");
  await mk("finance@example.com", "finance");
  academic = await signIn(w, "academic@example.com");
  finance = await signIn(w, "finance@example.com");
});
after(async () => { await w.dispose(); });

// ------------------------------------------------------------------ 1. catalogue integrity ----
test("integrity: 21 programmes in 6 schools, owner-approved USD tuition and durations, no local price invented", async () => {
  assert.equal(PROGRAMMES_2027.length, 21);
  assert.equal(SCHOOLS_2027.length, 6);
  assert.deepEqual(PROGRAMMES_2027.map((p) => [p.name, p.usd, p.training, p.internship]), OWNER_TABLE);
  assert.deepEqual(SCHOOLS_2027.map((s) => PROGRAMMES_2027.filter((p) => p.school === s.slug).length), [4, 3, 3, 2, 5, 4]);
  assert.equal(new Set(PROGRAMMES_2027.map((p) => p.slug)).size, 21, "unique slugs");
  for (const p of PROGRAMMES_2027) assert.ok(!RESERVED_2027.includes(p.slug) && !REMOVED_SLUGS.includes(p.slug), `${p.slug} reuses a removed or reserved address`);
  assert.ok(SCHOOLS_2027.every((s) => ALLOWED_TONES.includes(s.tone)), "school colours exist in the build");
  const db = await w.db();
  const drafts = (await db.prepare("SELECT slug, name, school_slug, price_usd_cents, price_kobo, training_months, internship_months FROM programme_drafts ORDER BY position").all<Record<string, unknown>>()).results;
  assert.deepEqual(drafts.map((d) => [d.name, Number(d.price_usd_cents) / 100, d.training_months, d.internship_months]), OWNER_TABLE, "drafts carry exactly the owner's figures");
  assert.ok(drafts.every((d) => d.price_kobo === null), "local NGN tuition is left unset for the owner (never converted from USD)");
  assert.ok(drafts.every((d) => Number.isInteger(d.price_usd_cents)), "integer minor units");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM schools").first<{ n: number }>())!.n, 6);
});

test("integrity: the nine live programmes are unchanged (prices, durations, text) and cloud-devops is kept", async () => {
  const rows = (await (await w.db()).prepare("SELECT * FROM programmes ORDER BY position").all<Record<string, unknown>>()).results;
  assert.deepEqual(rows.map((r) => r.slug), SEED_PROGRAMMES.map((p) => p.slug));
  for (const p of SEED_PROGRAMMES) {
    const r = rows.find((x) => x.slug === p.slug)!;
    assert.deepEqual([r.name, r.price_kobo, r.training_months, r.internship_months, r.level, r.status, r.tag, r.tone, r.blurb, JSON.parse(String(r.learn_json))],
      [p.name, p.price * 100, p.trainingMonths, p.internshipMonths, p.level, "published", p.tag, p.tone, p.blurb, p.learn], p.slug);
    assert.equal(r.was_kobo, p.was ? p.was * 100 : null, `${p.slug}: crossed-out price matches the live website`);
    assert.equal(r.school_slug, null, "no school until the owner publishes the 2027 version");
    assert.equal(r.price_usd_cents, null);
  }
  assert.equal(CATALOGUE_SOURCE, "seed");
  assert.deepEqual(PROGRAMMES, SEED_PROGRAMMES, "without a snapshot the website uses the seed (controlled fallback)");
});

// ------------------------------------------------------------------ 2. public output ----
test("public: /api/catalogue lists published programmes only, identical to today's website; no draft anywhere", async () => {
  const c = await publicCatalogue();
  assert.equal(c.source, "database");
  assert.deepEqual(c.programmes.map((p) => [p.slug, p.name, p.price, p.trainingMonths, p.internshipMonths]), SEED_PROGRAMMES.map((p) => [p.slug, p.name, p.price, p.trainingMonths, p.internshipMonths]));
  const text = JSON.stringify(c);
  for (const d of PROGRAMMES_2027.filter((p) => !p.reuses)) assert.doesNotMatch(text, new RegExp(`"${d.slug}"`), `draft ${d.slug} is not public`);
  assert.doesNotMatch(text, /Agentic Systems|Full-Stack Engineering|price_kobo|updated_by/, "no draft titles or internal fields");
  // Registration and quotes refuse a draft.
  // Stage C: a draft is refused with an explicit "not available" (409) rather than an unknown programme.
  assert.equal((await quote("python")).status, 409);
  const r = await w.post("/api/register", registration({ programme: "python", method: "bank", learner: { ...registration().learner, email: "draft@example.com" } }));
  assert.deepEqual([r.status, await errOf(r)], [409, "programme_unavailable"]);
});

test("public: the export validates and renders only safe values; the committed snapshot is the empty (seed) state", async () => {
  const c = await publicCatalogue();
  const snap = validateSnapshot({ ok: true, ...c });
  assert.equal(snap.programmes.length, 9);
  assert.throws(() => validateSnapshot({ ok: true, ...c, source: "fallback" }), /envelope/);
  const bad = structuredClone(c) as unknown as { ok: boolean; programmes: Record<string, unknown>[] };
  bad.ok = true;
  bad.programmes[0].price = -1;
  assert.throws(() => validateSnapshot(bad), /price/);
  const toned = structuredClone(c) as unknown as { ok: boolean; programmes: Record<string, unknown>[] };
  toned.ok = true;
  toned.programmes[0].tone = "bg-[url(javascript:alert(1))]";
  assert.ok(ALLOWED_TONES.includes(validateSnapshot(toned).programmes[0].tone), "unknown class strings are replaced");
  assert.equal(readFileSync("lib/catalogue.published.ts", "utf8"), render(null));
});

test("public: a database older than 0011 (production today) falls back to the bundled list; quotes keep working", async () => {
  const old = await startWorker({ migrationsUpTo: "0010_owner_integrity.sql" });
  try {
    const c = (await (await old.fetchApi("/api/catalogue")).json()) as { source: string; programmes: { slug: string }[] };
    assert.deepEqual([c.source, c.programmes.length], ["fallback", 9]);
    const q = (await (await old.fetchApi("/api/quote?programme=cloud&country=NG")).json()) as { charge: { total: number } };
    assert.equal(q.charge.total, 450000);
    // Enrolments created before 0011 receive the duration snapshot when it is applied.
    const db = await old.db();
    await db.prepare("INSERT INTO users (id, email, role, full_name, status, created_at) VALUES ('s1','s1@example.com','student','S One','active','2026-01-01')").run();
    await db.prepare("INSERT INTO enrolments (id, student_id, programme_slug, status, started_at, created_at) VALUES ('e-old','s1','marketing','active','2026-01-01','2026-01-01')").run();
    assert.deepEqual(await old.applyPending(), ["0011_catalogue.sql", "0012_pricing_snapshot.sql"]);
    assert.deepEqual({ ...(await db.prepare("SELECT training_months, internship_months FROM enrolments WHERE id = 'e-old'").first()) }, { training_months: 3, internship_months: 3 });
  } finally { await old.dispose(); }
});

// ------------------------------------------------------------------ 3. permissions ----
test("permissions: every catalogue route is in the default-deny table; groups get only what they should", async () => {
  const r = await build({ stdin: { contents: `import "./src/server/lms/index"; export { routeList } from "./src/server/lms/api"; export { permissionTable, adminMay } from "./src/server/lms/permissions";`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], write: false, logLevel: "silent" });
  const m = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  const routes = (m.routeList() as { method: string; path: string }[]).filter((x) => /catalogue/.test(x.path));
  const table = new Set((m.permissionTable() as { method: string; path: string }[]).map((p) => `${p.method} ${p.path}`));
  assert.equal(routes.length, 10, "8 from Stage B plus resume and history (Stage C)");
  for (const x of routes) assert.ok(table.has(`${x.method} ${x.path}`), `${x.method} ${x.path} missing from the permission table`);
  const may = m.adminMay as (role: string | null, method: string, path: string) => boolean;
  assert.equal(may("finance", "GET", "/api/app/admin/catalogue"), false);
  assert.equal(may("admissions", "PATCH", "/api/app/admin/catalogue/programmes/:slug"), false);
  assert.equal(may("reporting", "GET", "/api/app/admin/catalogue"), true);
  assert.equal(may("reporting", "PATCH", "/api/app/admin/catalogue/programmes/:slug"), false);
  assert.equal(may("academic", "PATCH", "/api/app/admin/catalogue/programmes/:slug"), true);
  assert.equal(may("super", "PUT", "/api/app/owner/catalogue-policy"), false, "the policy is the owner's alone");
  // Real requests.
  assert.equal((await finance.get("/api/app/admin/catalogue")).status, 403);
  const view = await academic.json<{ programmes: { slug: string; status: string; missingNgn: boolean }[]; canPublish: boolean; counts: { total: number; missingNgn: number } }>("GET", "/api/app/admin/catalogue");
  assert.equal(view.canPublish, false);
  assert.equal(view.counts.total, 22, "21 programmes of 2027 plus the retained cloud-devops");
  // Every 2027 draft lacks local tuition, including the eight that replace a live programme: their live 2026 NGN price
  // stays in force until the owner sets and publishes the 2027 one (it is never copied or converted).
  assert.equal(view.counts.missingNgn, 21);
  assert.equal(view.programmes.find((p) => p.slug === "python")!.status, "draft");
});

test("security: CSRF (same-origin) and server-side validation; reserved and removed slugs are never reused", async () => {
  const noOrigin = await w.fetchApi("/api/app/admin/catalogue/programmes", { method: "POST", headers: { cookie: academic.cookie, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ slug: "x-test" }) });
  assert.equal(noOrigin.status, 403);
  for (const slug of ["data", "data-analytics", "cloud-devops", "cyber"]) {
    const r = await academic.send("POST", "/api/app/admin/catalogue/programmes", { slug, name: "X", schoolSlug: "data-science" });
    assert.equal(r.status, 409, slug);
  }
  assert.equal((await academic.send("POST", "/api/app/admin/catalogue/programmes", { slug: "Bad Slug!", name: "X", schoolSlug: "data-science" })).status, 400);
  assert.equal((await academic.send("POST", "/api/app/admin/catalogue/programmes", { slug: "new-one", name: "X", schoolSlug: "no-such-school" })).status, 400);
  assert.equal((await academic.send("PATCH", "/api/app/admin/catalogue/programmes/python", { priceNgnKobo: 12.5 })).status, 400, "integer minor units only");
  assert.equal((await academic.send("PATCH", "/api/app/admin/catalogue/programmes/python", { trainingMonths: 0 })).status, 400);
  assert.equal((await academic.send("PATCH", "/api/app/admin/catalogue/programmes/unknown-slug", { name: "X" })).status, 404);
  // A currency or country sent by the browser is ignored, never stored.
  await academic.json("PATCH", "/api/app/admin/catalogue/programmes/python", { currency: "GBP", country: "GB", priceGbp: 1 });
  const d = await (await w.db()).prepare("SELECT price_usd_cents, price_kobo FROM programme_drafts WHERE slug = 'python'").first();
  assert.deepEqual({ ...d }, { price_usd_cents: 105000, price_kobo: null });
});

// ------------------------------------------------------------------ 4. publication ----
test("publication: a draft without local NGN tuition cannot be published, even by the owner", async () => {
  const r = await owner.send("POST", "/api/app/admin/catalogue/programmes/python/publish");
  assert.equal(r.status, 409);
  assert.match(((await r.json()) as { message: string }).message, /local tuition \(NGN\)/);
});

test("publication: only the owner (with the authenticator code) may publish; editors, legacy and email-only sessions are refused and audited", async () => {
  await academic.json("PATCH", "/api/app/admin/catalogue/programmes/python", { ...COMPLETE, priceNgnKobo: 85_000_000 });
  const price = await audits("catalogue.price_change", "python");
  assert.deepEqual(price.at(-1), { stage: "draft", price: "ngn_local", unit: "kobo", previous: null, next: 85_000_000 });
  for (const s of [academic, legacy]) assert.equal(await errOf(await s.send("POST", "/api/app/admin/catalogue/programmes/python/publish")), "owner_required");
  assert.ok((await audits("catalogue.refused", "python")).length >= 2);
  const pending = await signIn(w, OWNER); // email link only: the owner has MFA, so this session still waits for the code
  assert.equal(await errOf(await pending.send("POST", "/api/app/admin/catalogue/programmes/python/publish")), "mfa_required");
  assert.equal((await publicCatalogue()).programmes.some((p) => p.slug === "python"), false, "still not public");
  const ok = await owner.json<{ status: string }>("POST", "/api/app/admin/catalogue/programmes/python/publish");
  assert.equal(ok.status, "published");
  const pub = (await publicCatalogue()).programmes.find((p) => p.slug === "python")!;
  assert.deepEqual([pub.price, pub.priceUsdCents, pub.school, pub.trainingMonths], [850000, 105000, "software-engineering", 4]);
  const q = (await (await quote("python")).json()) as { charge: { total: number; currency: string } };
  assert.deepEqual([q.charge.total, q.charge.currency], [850000, "NGN"], "charged from the published local price, never from USD");
  assert.equal((await owner.json<{ programmes: { slug: string; hasDraft: boolean }[] }>("GET", "/api/app/admin/catalogue")).programmes.find((p) => p.slug === "python")!.hasDraft, false);
  const [pubAudit] = await audits("catalogue.publish", "python");
  assert.equal(pubAudit.first, true);
  assert.deepEqual((await audits("catalogue.price_change", "python")).filter((a) => a.stage === "published").map((a) => a.price).sort(), ["ngn_local", "usd_international"]);
});

test("publication: the owner may delegate to Super Administrators; the delegate still needs the authenticator code", async () => {
  // The legacy administrator is appointed Super Administrator by the owner (their sessions end on a group change).
  const id = (await legacy.json<{ user: { id: string } }>("GET", "/api/me")).user.id;
  await owner.json("PATCH", `/api/app/admin/users/${id}`, { adminRole: "super" });
  const emailOnly = await signIn(w, "owner@example.com");
  await academic.json("PATCH", "/api/app/admin/catalogue/programmes/ai-chatbot", { ...COMPLETE, priceNgnKobo: 100_000_000 });
  assert.equal(await errOf(await emailOnly.send("POST", "/api/app/admin/catalogue/programmes/ai-chatbot/publish")), "owner_required", "not delegated yet");
  assert.equal((await emailOnly.send("PUT", "/api/app/owner/catalogue-policy", { superMayPublish: true })).status, 403, "a Super Administrator cannot delegate to themselves");
  await owner.json("PUT", "/api/app/owner/catalogue-policy", { superMayPublish: true });
  assert.equal(await errOf(await emailOnly.send("POST", "/api/app/admin/catalogue/programmes/ai-chatbot/publish")), "mfa_step_required", "a delegate still needs the authenticator code");
  const superAdmin = await strong(w, "owner@example.com");
  assert.equal((await superAdmin.json<{ status: string }>("POST", "/api/app/admin/catalogue/programmes/ai-chatbot/publish")).status, "published");
  await owner.json("PUT", "/api/app/owner/catalogue-policy", { superMayPublish: false });
  assert.equal(await errOf(await superAdmin.send("POST", "/api/app/admin/catalogue/programmes/ai-chatbot/pause")), "owner_required", "delegation withdrawn");
  assert.deepEqual((await audits("owner.catalogue_policy")).map((a) => a.to.superMayPublish), [true, false]);
});

test("publication: pause hides and closes registration; resume restores; retire keeps the name for records and old links", async () => {
  await owner.json("POST", "/api/app/admin/catalogue/programmes/python/pause");
  assert.equal((await publicCatalogue()).programmes.some((p) => p.slug === "python"), false);
  assert.equal((await quote("python")).status, 409, "registration closed while paused");
  await owner.json("POST", "/api/app/admin/catalogue/programmes/python/publish"); // resume
  assert.equal((await publicCatalogue()).programmes.some((p) => p.slug === "python"), true);
  assert.deepEqual((await audits("catalogue.unpublish", "python")).length, 1);
  assert.equal((await owner.send("POST", "/api/app/admin/catalogue/programmes/python/retire", {})).status, 400, "a reason is required");
  await owner.json("POST", "/api/app/admin/catalogue/programmes/python/retire", { reason: "Test retirement" });
  const c = await publicCatalogue();
  assert.equal(c.programmes.some((p) => p.slug === "python"), false);
  assert.deepEqual(c.retired, [{ slug: "python", name: "Python Programming & Applied Software Development" }]);
  assert.ok(await (await w.db()).prepare("SELECT 1 FROM programmes WHERE slug = 'python' AND status = 'retired'").first(), "never deleted");
  assert.equal((await academic.send("PATCH", "/api/app/admin/catalogue/programmes/python", { name: "X" })).status, 409, "retired programmes are not edited");
  assert.equal((await academic.send("POST", "/api/app/admin/catalogue/programmes", { slug: "python", name: "X", schoolSlug: "software-engineering" })).status, 409, "the address is not reused");
  assert.equal((await owner.send("POST", "/api/app/admin/catalogue/programmes/ai-engineering/retire", { reason: "x" })).status, 409, "an unpublished draft cannot be retired");
});

// ------------------------------------------------------------------ 5. historical compatibility ----
test("history: publishing a new price and duration for a reused programme never changes existing orders or enrolment periods", async () => {
  const db = await w.db();
  // An existing student on Web Development (4 + 2) and an existing order at the old price.
  const student = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "web-student@example.com", role: "student", fullName: "Web Student", sendInvite: false })).user.id;
  const e = (await owner.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: student, programme: "webdev" })).enrolment.id;
  const reg = await w.post("/api/register", registration({ programme: "webdev", method: "bank", learner: { ...registration().learner, email: "web-buyer@example.com" } }));
  assert.equal(reg.status, 200, await reg.clone().text());
  const before = await db.prepare("SELECT reference, total_kobo, regular_kobo FROM orders WHERE programme_slug = 'webdev'").all<{ reference: string; total_kobo: number; regular_kobo: number }>();
  assert.deepEqual([before.results[0].total_kobo, before.results[0].regular_kobo], [50_000_000, 50_000_000]);
  // The 2027 version: 5 + 2 months, new local price set by the owner.
  await academic.json("PATCH", "/api/app/admin/catalogue/programmes/webdev", { ...COMPLETE, priceNgnKobo: 90_000_000 });
  await owner.json("POST", "/api/app/admin/catalogue/programmes/webdev/publish");
  const live = await db.prepare("SELECT name, price_kobo, was_kobo, training_months, school_slug FROM programmes WHERE slug = 'webdev'").first();
  assert.deepEqual({ ...live }, { name: "Web Development & Full-Stack Engineering", price_kobo: 90_000_000, was_kobo: null, training_months: 5, school_slug: "software-engineering" });
  const after = await db.prepare("SELECT reference, total_kobo, regular_kobo FROM orders WHERE programme_slug = 'webdev'").all();
  assert.deepEqual(after.results, before.results, "orders keep their amounts");
  assert.deepEqual({ ...(await db.prepare("SELECT training_months, internship_months FROM enrolments WHERE id = ?1").bind(e).first()) }, { training_months: 4, internship_months: 2 }, "the enrolment keeps 4 + 2");
  const pub = (await audits("catalogue.publish", "webdev")).at(-1);
  assert.equal(pub.durationChanged, true);
  assert.deepEqual((await audits("catalogue.price_change", "webdev")).filter((a) => a.stage === "published" && a.price === "ngn_local").map((a) => [a.previous, a.next]), [[50_000_000, 90_000_000]]);
  assert.equal(programmeName("cloud-devops"), "Cloud & DevOps Engineering", "names resolve for any record");
});

test("history: migration 0011 never touches orders, payments or instalments, and is additive", () => {
  const sql = readFileSync("migrations/0011_catalogue.sql", "utf8");
  assert.doesNotMatch(sql, /\b(orders|payments|instalments|registrations)\b/);
  assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|RENAME/i);
  assert.doesNotMatch(sql, /UPDATE programmes SET[^;]*\b(price_kobo|training_months|internship_months|name)\s*=/, "live prices, durations and names are not rewritten");
});

// ------------------------------------------------------------------ 6. pricing rules ----
test("pricing: international tuition is USD; GBP and EUR use the approved rates' cross rate; nothing becomes NGN", () => {
  const rates: Rates = { base: "NGN", rates: { NGN: 1, USD: 0.0006, GBP: 0.0005, EUR: 0.00055 }, fetchedAt: "2026-11-27T05:00:00Z", source: "test" };
  assert.equal(internationalAmount(105000, "USD", rates), 1050);
  assert.equal(internationalAmount(105000, "GBP", rates), Math.round(1050 * (0.0005 / 0.0006)));
  assert.equal(internationalAmount(105000, "EUR", null), null, "no rate: show nothing rather than guess");
  assert.equal(internationalAmount(null, "USD", rates), null);
  // @ts-expect-error NGN is not an international currency
  assert.equal(internationalAmount(105000, "NGN", rates), null);
});

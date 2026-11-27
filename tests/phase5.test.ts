// Phase 5: the timed price hold. Dormant in the real config; tested with a test-only timed price on Cloud Engineering.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PROGRAMMES } from "../lib/config.ts";
import { read } from "./helpers.ts";
import { SECRETS, learner, registration, startWorker } from "./worker-harness.ts";

const PATCH = `PROGRAMMES.find((p) => p.slug === "cloud").timedPrice = 400000;`;
const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
type HoldJson = { offer: boolean; active: boolean; ended?: boolean; endsAt: string | null; price: number; reason?: string };

test("dormant: no programme has a timed price, so no hold ever starts", async () => {
  assert.ok(PROGRAMMES.every((p) => p.timedPrice === null));
  const w = await startWorker();
  try {
    const r = await w.fetchApi("/api/hold?p=cloud");
    const j = await r.json() as HoldJson;
    assert.deepEqual([j.offer, j.active, j.price], [false, false, 450000]);
    assert.equal(r.headers.getSetCookie().length, 0, "no cookie");
    const n = await (await w.db()).prepare("SELECT COUNT(*) AS n FROM holds").first<{ n: number }>();
    assert.equal(n?.n, 0, "no database write");
  } finally { await w.dispose(); }
  const page = read("app/hold.tsx");
  assert.match(page, /if \(p\.timedPrice == null\) return; \/\/ dormant/, "no network request for programmes without a timed price");
});

let w: Awaited<ReturnType<typeof startWorker>>;
// Stage B: registration prices from the published catalogue in the database, so the timed price is set there too.
const TIMED_SQL = "UPDATE programmes SET timed_price_kobo = 40000000 WHERE slug = 'cloud'";
before(async () => { w = await startWorker({ patch: PATCH }); await (await w.db()).prepare(TIMED_SQL).run(); });
after(async () => { await w.dispose(); });

test("a hold starts on first visit: 48 minutes, signed HttpOnly cookie, recorded in D1, survives a refresh", async () => {
  const ip = { "cf-connecting-ip": "192.0.2.10" };
  const r1 = await w.fetchApi("/api/hold?p=cloud", { headers: ip });
  const j1 = await r1.json() as HoldJson;
  assert.equal(j1.active, true);
  assert.equal(j1.price, 400000);
  const mins = (Date.parse(j1.endsAt!) - Date.now()) / 60000;
  assert.ok(mins > 47.5 && mins <= 48, `ends in ${mins} min`);
  const raw = r1.headers.getSetCookie();
  const hold = raw.find((c) => c.startsWith("sma_hold_cloud="))!;
  assert.match(hold, /HttpOnly/);
  assert.match(hold, /Secure/);
  assert.match(hold, /SameSite=Lax/);
  assert.match(decodeURIComponent(hold.split(";")[0].split("=")[1]), /^[0-9a-f-]{36}\.[\w-]{43}$/, "value is id.signature");
  const row = await (await w.db()).prepare("SELECT * FROM holds WHERE programme_slug = 'cloud'").first<Record<string, string>>();
  assert.equal(row.expires_at, j1.endsAt);
  const r2 = await w.fetchApi("/api/hold?p=cloud", { headers: { ...ip, cookie: cookiesOf(r1) } });
  const j2 = await r2.json() as HoldJson;
  assert.equal(j2.endsAt, j1.endsAt, "same hold after refresh: the countdown does not restart");
});

test("acceptance 7: checkout charges the timed price only with a valid hold; a price sent by the browser is ignored", async () => {
  const ip = { "cf-connecting-ip": "192.0.2.20" };
  const h = await w.fetchApi("/api/hold?p=cloud", { headers: ip });
  const cookie = cookiesOf(h);
  const withHold = await w.post("/api/register", registration({ price: 1, amount: 100, totalNaira: 5, learner: learner({ email: "hold1@example.com" }) }), { ...ip, cookie });
  const a = await withHold.json() as { totalNaira: number; holdApplied: boolean; reference: string };
  assert.deepEqual([a.totalNaira, a.holdApplied], [400000, true]);
  const init = w.calls.find((c) => c.url.endsWith("/transaction/initialize") && c.body.includes(a.reference))!;
  assert.equal(JSON.parse(init.body).amount, 40_000_000, "Paystack asked for the server's amount in kobo");

  const forged = cookie.replace(/(sma_hold_cloud=[^.]+\.)[\w-]+/, "$1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const b = await (await w.post("/api/register", registration({ learner: learner({ email: "hold2@example.com" }) }), { ...ip, cookie: forged })).json() as { totalNaira: number };
  assert.equal(b.totalNaira, 450000, "forged hold cookie gives the regular price");
  const c = await (await w.post("/api/register", registration({ learner: learner({ email: "hold3@example.com" }) }), { ...ip })).json() as { totalNaira: number };
  assert.equal(c.totalNaira, 450000, "no hold: regular price");
});

test("when the hold ends: regular price, 'ended', and no restart for 7 days, even after clearing cookies", async () => {
  const ip = { "cf-connecting-ip": "192.0.2.30" };
  const r1 = await w.fetchApi("/api/hold?p=cloud", { headers: ip });
  const cookie = cookiesOf(r1);
  const db = await w.db();
  await db.prepare("UPDATE holds SET expires_at = '2000-01-01T00:00:00.000Z' WHERE ip_hash IS NOT NULL AND id = (SELECT id FROM holds ORDER BY started_at DESC LIMIT 1)").run();
  const ended = await (await w.fetchApi("/api/hold?p=cloud", { headers: { ...ip, cookie } })).json() as HoldJson;
  assert.deepEqual([ended.active, ended.ended, ended.price], [false, true, 450000]);
  const reg = await (await w.post("/api/register", registration({ learner: learner({ email: "hold4@example.com" }) }), { ...ip, cookie })).json() as { totalNaira: number };
  assert.equal(reg.totalNaira, 450000, "checkout charges the regular price after the hold ends");
  const fresh = await (await w.fetchApi("/api/hold?p=cloud", { headers: ip })).json() as HoldJson;
  assert.deepEqual([fresh.active, fresh.ended], [false, true], "new cookies, same address: still ended");
  const fromCookie = await (await w.fetchApi("/api/hold?p=cloud", { headers: { "cf-connecting-ip": "192.0.2.31", cookie } })).json() as HoldJson;
  assert.deepEqual([fromCookie.active, fromCookie.ended], [false, true], "same visitor, new address: still ended");
  await db.prepare("UPDATE holds SET cooldown_until = '2000-01-02T00:00:00.000Z'").run();
  const again = await (await w.fetchApi("/api/hold?p=cloud", { headers: { ...ip, cookie } })).json() as HoldJson;
  assert.equal(again.active, true, "after 7 days a new hold can start");
});

test("not configured (no signing key): the regular price shows and nothing breaks", async () => {
  const x = await startWorker({ patch: PATCH, env: { ...SECRETS, HOLD_SIGNING_KEY: "" } });
  await (await x.db()).prepare(TIMED_SQL).run();
  try {
    const j = await (await x.fetchApi("/api/hold?p=cloud")).json() as HoldJson;
    assert.deepEqual([j.offer, j.active, j.price, j.reason], [false, false, 450000, "not_configured"]);
  } finally { await x.dispose(); }
});

test("UI: countdown, crossed-out regular price, calm ending, accessible exit prompt, no fake scarcity", () => {
  const ui = read("app/hold.tsx");
  for (const s of ['role="timer"', 'aria-live="off"', 'aria-live="polite"', "[30, 10, 5, 1]", "prefers-reduced-motion", 'role="dialog"', 'aria-modal="true"',
    '"Escape"', '"Tab"', "Secure my seat", "Not now", "Offer ended", "clientY <= 0", "visibilitychange", "popstate", "sessionStorage", "<s "]) assert.ok(ui.includes(s), `missing ${s}`);
  assert.match(ui, /if \(viaBack\.current\) history\.back\(\)/, "Not now after pressing back lets the visitor leave");
  for (const f of ["app/hold.tsx", "app/page.tsx", "app/programmes/[slug]/page.tsx", "app/checkout/page.tsx", "lib/config.ts"]) {
    assert.doesNotMatch(read(f), /only \d+ (seats?|spots?|places?) left|seats? left|selling fast|almost gone/i, f);
  }
  assert.match(read("app/programmes/[slug]/page.tsx"), /<HoldPrice p=\{p\} \/>/);
});

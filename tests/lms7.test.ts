// LMS 7: security sweep over EVERY learning-platform route, plus the generated API list.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { apiDoc, scanRoutes } from "../scripts/api-docs.mts";
import { ROOT, read } from "./helpers.ts";
import { startWorker } from "./worker-harness.ts";
import { setup, signIn } from "./lms-helpers.ts";

const routes = scanRoutes(ROOT);
let w: Awaited<ReturnType<typeof startWorker>>;
before(async () => { w = await startWorker(); });
after(async () => { await w.dispose(); });
const fill = (p: string) => p.replace(/:[\w]+/g, "x0000000000");

test("the API list in docs/lms/API.md is current", () => {
  assert.ok(routes.length >= 60, `found ${routes.length} routes`);
  assert.equal(readFileSync(join(ROOT, "docs/lms/API.md"), "utf8"), apiDoc(routes), "run: node scripts/api-docs.mts");
});

test("every non-public route refuses signed-out requests (401), and only the three sign-in routes are public", async () => {
  const pub = routes.filter((r) => r.roles === "public").map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(pub, ["POST /api/auth/logout", "POST /api/auth/request", "POST /api/auth/verify"]);
  for (const r of routes.filter((x) => x.roles !== "public")) {
    const res = await w.fetchApi(fill(r.path), { method: r.method, headers: { origin: "https://skillmountainacademy.com", "content-type": "application/json" }, body: r.method === "GET" ? undefined : "{}" });
    assert.equal(res.status, 401, `${r.method} ${r.path} -> ${res.status}`);
  }
});

test("every change refuses requests from other websites (403) even when signed in", async () => {
  const { admin } = await setup(w);
  for (const r of routes.filter((x) => x.method !== "GET" && x.roles !== "public")) {
    const res = await w.fetchApi(fill(r.path), { method: r.method, headers: { cookie: admin.cookie, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 403, `${r.method} ${r.path}`);
  }
});

test("admin-only routes refuse students and instructors", async () => {
  const { make } = await setup(w);
  await make("student", "sweep-s@example.com", "Sweep S");
  await make("instructor", "sweep-i@example.com", "Sweep I");
  const s = await signIn(w, "sweep-s@example.com");
  const i = await signIn(w, "sweep-i@example.com");
  for (const r of routes.filter((x) => x.roles === "admin")) {
    for (const who of [s, i]) {
      const res = await who.send(r.method, fill(r.path), r.method === "GET" ? undefined : {});
      assert.equal(res.status, 403, `${r.method} ${r.path}`);
    }
  }
  for (const r of routes.filter((x) => x.roles === "instructor")) assert.equal((await s.send(r.method, fill(r.path), r.method === "GET" ? undefined : {})).status, 403, `student on ${r.path}`);
  for (const r of routes.filter((x) => x.roles === "student")) assert.equal((await i.send(r.method, fill(r.path), r.method === "GET" ? undefined : {})).status, 403, `instructor on ${r.path}`);
});

test("no secrets or tokens are stored in plain text; errors never leak details to users", () => {
  const users = read("src/server/lms/data/users.ts");
  assert.match(users, /token_hash/);
  assert.match(read("src/server/lms/routes/auth.ts"), /sha256\(`t\|\$\{token\}`\)/);
  assert.match(read("src/server/lms/api.ts"), /sha256\(`s\|\$\{token\}`\)/);
  assert.match(read("src/worker.ts"), /Something went wrong on our side/);
});

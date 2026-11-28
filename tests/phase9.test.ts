// Phase 9: deploy configuration, secrets, free-plan limits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { join } from "node:path";

import { ROOT, files, read } from "./helpers.ts";

const wrangler = () => JSON.parse(read("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));

test("Cloudflare: one Worker serves /api/* first and leaves the static site to the assets server", () => {
  const w = wrangler();
  assert.equal(w.name, "skillmountainacademy");
  assert.equal(w.main, "src/worker.ts");
  assert.equal(w.assets.directory, "./out");
  assert.deepEqual(w.assets.run_worker_first, ["/api/*"]);
  assert.equal(w.assets.html_handling, "auto-trailing-slash");
  assert.equal(w.assets.not_found_handling, "404-page");
  assert.equal(w.d1_databases[0].binding, "DB");
  assert.equal(w.kv_namespaces[0].binding, "KV");
  assert.equal(w.triggers.crons.length, 1, "few cron triggers");
  assert.match(read("next.config.ts"), /output: "export"/, "still a static export");
});

test("every build-time website value read by lib/config.ts is defined for the Worker bundle", () => {
  const used = new Set([...read("lib/config.ts").matchAll(/process\.env\.(NEXT_PUBLIC_\w+)/g)].map((m) => m[1]));
  const defined = Object.keys(wrangler().define).map((k) => k.replace("process.env.", ""));
  for (const u of used) assert.ok(defined.includes(u), `${u} missing from wrangler.jsonc define`);
});

test("no secrets in the repository", () => {
  const all = [...files(".", [".ts", ".tsx", ".mts", ".json", ".jsonc", ".md", ".gs", ".example", ".yml", ".sql"])]
    .filter((f) => !/node_modules|\.next|^out|\.wrangler|package-lock|worker-configuration/.test(f));
  for (const f of all) {
    const s = read(f);
    assert.doesNotMatch(s, /sk_live_[A-Za-z0-9]{10,}|sk_test_[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{20,}|0x4AAAAAAA[A-Za-z0-9_-]{15,}(?!x)/, `${f} looks like it contains a real key`);
  }
  for (const k of ["TURNSTILE_SECRET", "PAYSTACK_SECRET_KEY", "RESEND_API_KEY", "HOLD_SIGNING_KEY", "SHEET_WEBHOOK_URL"]) assert.ok(!Object.keys(wrangler().vars).includes(k), `${k} must be a secret, not a var`);
  assert.match(read(".gitignore"), /\.dev\.vars/);
});

test("free-plan limits: small bundle, capped cron work, few queries per request", async () => {
  const r = await build({ entryPoints: [join(ROOT, "src/worker.ts")], bundle: true, minify: true, write: false, format: "esm", platform: "neutral",
    define: { "process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY": '""', "process.env.NEXT_PUBLIC_SHEET_URL": '""', "process.env.NEXT_PUBLIC_WHATSAPP": '""', "process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY": '""' } });
  const kb = r.outputFiles[0].contents.length / 1024;
  // Raised from 200 to 300 KiB for the final brief (bookings, assistant, records, checklist), and to 320 KiB for the
  // expansion Stages B to D.1.1 (catalogue, capacity, pricing, payment attempts), and to 360 KiB for Stage E
  // (departments, invitations, approvals); the Free plan allows 3 MiB.
  assert.ok(kb < 360, `Worker bundle ${kb.toFixed(1)} KiB (Free plan limit 3 MiB)`);
  assert.ok(Number(read("src/server/cron.ts").match(/MAX_NOTICES_PER_RUN = (\d+)/)![1]) <= 20, "each cron run stays under 50 subrequests and 50 D1 queries");
  const src = files("src", [".ts"]).map(read).join("\n");
  assert.doesNotMatch(src, /bcrypt|scrypt|pbkdf2|argon/i, "no CPU-heavy hashing in routes");
  assert.ok(read("docs/upgrade/LIMITS.md").includes("10 ms"));
});

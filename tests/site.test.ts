// Source-level checks: removed wording, redirects, meta tags, and the brand-colour snapshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function files(dir: string, exts: string[]): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return files(p, exts);
    return exts.some((e) => n.endsWith(e)) ? [p] : [];
  });
}
const SOURCE = [...files("app", [".ts", ".tsx"]), ...files("lib", [".ts"])];

// The one place IELTS and Data Analytics may be named: the short "no longer offered" notice.
const NOTICE = "IELTS Training and Data Analytics are no longer offered.";

test("no IELTS, Data Analytics, dollar labels, 'coming soon' or '6 months' in the site code", () => {
  for (const f of SOURCE) {
    const src = read(f).replace(NOTICE, "");
    for (const bad of [/IELTS/, /Data Analytics/, /US\$/, /≈/, /coming soon/i, /6 months/, /usdRate|useRate/, /waitlist|notify me/i]) {
      assert.doesNotMatch(src, bad, `${f} contains ${bad}`);
    }
  }
});

test("meta: no keywords tag, Abuja in the description, OG alt says Academy", () => {
  const layout = read("app/layout.tsx");
  assert.doesNotMatch(layout, /keywords\s*:/);
  assert.match(layout, /description:[\s\S]*?Abuja/);
  assert.doesNotMatch(layout, /University/);
  assert.match(layout, /Skill Academy for those made for more/);
});

test("old IELTS and Data Analytics paths redirect home with the notice", () => {
  const rules = read("public/_redirects").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.trim().split(/\s+/));
  const sources = rules.map((r) => r[0]);
  for (const s of ["/ielts", "/ielts-checkout", "/checkout/ielts", "/programmes/ielts", "/data-analytics", "/programmes/data"]) {
    assert.ok(sources.includes(s), `missing redirect for ${s}`);
  }
  for (const [src, dest, code] of rules) {
    assert.equal(code, "301");
    if (/ielts|data/.test(src)) assert.equal(dest, "/?notice=removed", src);
    else assert.match(dest, /^\/(#programmes|programmes\/(cybersecurity|webdev)\/)$/, src);
  }
  // Cloudflare requires static rules before wildcard rules.
  const firstSplat = sources.findIndex((s) => s.includes("*"));
  assert.ok(sources.slice(firstSplat).every((s) => s.includes("*")), "static redirects must come before wildcard ones");
  assert.match(read("app/checkout/page.tsx"), /router\.replace\("\/\?notice=removed"\)/, "checkout must redirect ?p=ielts");
  assert.match(read("app/page.tsx"), /notice"\) !== "removed"/, "home page must read the notice");
});

// Brand colours: globals.css and the logos must be byte-identical to Phase 0, and every hex colour in the
// code must be one that existed at Phase 0, in the same file (line numbers may move as files are edited).
test("colour-token snapshot is unchanged since Phase 0", () => {
  const snap = read("docs/upgrade/colour-snapshot-phase0.txt");
  for (const m of snap.matchAll(/^([0-9a-f]{64}) {2}(\S+)$/gm)) {
    const hash = createHash("sha256").update(readFileSync(join(ROOT, m[2]))).digest("hex");
    assert.equal(hash, m[1], `${m[2]} has changed`);
  }
  const before = new Set([...snap.matchAll(/^([\w./-]+):\d+:(#[0-9a-fA-F]{3,8})$/gm)].map((m) => `${m[1]} ${m[2].toLowerCase()}`));
  const scanned = [...SOURCE, "app/globals.css", "docs/google-sheet-script.gs"];
  const now = new Set<string>();
  for (const f of scanned) {
    for (const m of read(f).matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) now.add(`${relative(ROOT, join(ROOT, f))} ${m[0].toLowerCase()}`);
  }
  assert.deepEqual([...now].filter((x) => !before.has(x)), [], "new colour values added");
  assert.deepEqual([...before].filter((x) => !now.has(x)), [], "existing colour values removed or moved to another file");
});

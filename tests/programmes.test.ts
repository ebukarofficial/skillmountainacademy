// Phase 1 checks for the programme data. Run with: npm test (Node 22, no extra packages).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FAQ, FAST_TRACK, GOALS, PROGRAMMES, REMOVED_SLUGS, STEPS, duration, finalPrice, findProgramme,
} from "../lib/config.ts";

const bySlug = (s: string) => {
  const p = PROGRAMMES.find((x) => x.slug === s);
  assert.ok(p, `missing programme ${s}`);
  return p;
};

test("exactly the eight live programmes, in the spec's slugs", () => {
  assert.deepEqual(
    PROGRAMMES.map((p) => p.slug).sort(),
    ["cloud", "cloud-devops", "cybersecurity", "devops", "graphics", "marketing", "uiux", "webdev"],
  );
  assert.equal(new Set(PROGRAMMES.map((p) => p.name)).size, 8, "programme names must be unique (the Apps Script keys on them)");
});

test("prices, crossed-out prices and durations match the spec and owner decisions", () => {
  const want: Record<string, [number, number | undefined, number, number]> = {
    graphics: [350000, undefined, 4, 2],
    marketing: [300000, undefined, 3, 3],
    uiux: [400000, undefined, 4, 2],
    webdev: [500000, undefined, 4, 2],
    cybersecurity: [650000, undefined, 4, 2], // owner: no crossed-out price
    cloud: [450000, undefined, 4, 2],         // owner (20 Nov 2026): no crossed-out price, keep ₦450,000
    devops: [500000, undefined, 4, 2],
    "cloud-devops": [650000, undefined, 5, 2],
  };
  for (const [slug, [price, was, t, i]] of Object.entries(want)) {
    const p = bySlug(slug);
    assert.equal(p.price, price, `${slug} price`);
    assert.equal(p.was, was, `${slug} crossed-out price`);
    assert.equal(p.trainingMonths, t, `${slug} training months`);
    assert.equal(p.internshipMonths, i, `${slug} internship months`);
  }
  assert.ok(PROGRAMMES.every((p) => p.was == null), "no crossed-out prices anywhere");
});

test("duration reads as training + internship", () => {
  assert.equal(duration(bySlug("marketing")), "3 months training + 3 months internship");
  assert.equal(duration(bySlug("cloud-devops")), "5 months training + 2 months internship");
});

test("dormant options: no timed price, fast track off, group price unset", () => {
  assert.equal(FAST_TRACK.enabled, false);
  for (const p of PROGRAMMES) {
    assert.equal(p.timedPrice, null, p.slug);
    assert.equal(p.fastTrack, false, p.slug);
    assert.equal(p.groupPrice, null, p.slug);
    assert.equal(finalPrice(p), p.price);
    assert.equal(finalPrice(p, true), p.price, "no timed price means the regular price even with a hold");
    assert.equal(p.curriculum, `/curricula/${p.slug}.pdf`);
    assert.ok(p.learn.length >= 4, `${p.slug} needs a learn list`);
  }
});

test("Cloud track has three programmes with level and audience for the comparison", () => {
  const cloud = PROGRAMMES.filter((p) => p.track === "cloud").map((p) => p.slug);
  assert.deepEqual(cloud, ["cloud", "devops", "cloud-devops"]);
  assert.equal(bySlug("cloud").level, "Beginner-friendly");
  assert.equal(bySlug("devops").level, "Mid-level");
  for (const s of cloud) assert.ok(bySlug(s).audience, `${s} needs "who it's for"`);
});

test("goal picker only points at live programmes", () => {
  for (const g of GOALS) assert.ok(findProgramme(g.slug), `goal "${g.goal}" points at ${g.slug}`);
  assert.equal(GOALS.find((g) => g.goal === "Protect systems and data")?.slug, "cybersecurity");
});

test("old links: legacy slugs still work, removed programmes are not found", () => {
  assert.equal(findProgramme("cyber")?.slug, "cybersecurity");
  assert.equal(findProgramme("web")?.slug, "webdev");
  for (const s of REMOVED_SLUGS) assert.equal(findProgramme(s), undefined, s);
  assert.equal(findProgramme(null), undefined);
});

test("copy has no IELTS, Data Analytics, dollar labels or 'coming soon'", () => {
  const text = JSON.stringify({ PROGRAMMES, GOALS, STEPS, FAQ });
  for (const bad of [/ielts/i, /data analytics/i, /US\$/, /≈/, /coming soon/i, /6 months/i, /job guarantee/i]) {
    assert.doesNotMatch(text, bad);
  }
});

test("Apps Script FEES lists every programme at its config price, and nothing else", () => {
  const gs = readFileSync(new URL("../docs/google-sheet-script.gs", import.meta.url), "utf8");
  const block = gs.match(/var FEES = \{([\s\S]*?)\};/);
  assert.ok(block, "FEES block not found");
  const fees = Object.fromEntries([...block[1].matchAll(/"([^"]+)":\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(fees, Object.fromEntries(PROGRAMMES.map((p) => [p.name, p.price])));
});

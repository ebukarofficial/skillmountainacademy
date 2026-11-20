// Phase 2: the louder message, programme pages and curriculum buttons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLAGS, MESSAGE, PROGRAMMES, TECH_SLUGS, careerPackage, pillars } from "../lib/config.ts";
import { readHeadings, scan } from "../scripts/curricula.mts";
import { ROOT, SITE_SOURCE, built, files, read } from "./helpers.ts";

// Tailwind font sizes in rem.
const TW: Record<string, number> = { xs: .75, sm: .875, base: 1, lg: 1.125, xl: 1.25, "2xl": 1.5, "3xl": 1.875, "4xl": 2.25, "5xl": 3, "6xl": 3.75, "7xl": 4.5, "8xl": 6, "9xl": 8 };

test("acceptance 5: the hero headline is the message and the largest text on the site", () => {
  const home = read("app/page.tsx");
  const h1 = home.match(/<h1 data-hero-headline className="([^"]+)">([\s\S]*?)<\/h1>/);
  assert.ok(h1, "hero h1 not found");
  const text = h1[2].replace(/<[^>]+>|\{" "\}/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(text, MESSAGE.headline.replace("one-on-one", "one-on-one"));
  assert.match(h1[2], /bg-indigo[^"]*text-brand-orange[^>]*>one-on-one</, "one-on-one is brand orange (on the indigo token)");
  assert.match(h1[1], /font-extrabold/);
  // The smallest the hero ever gets (clamp minimums) must beat the biggest fixed size anywhere else.
  const heroMin = Math.min(...[...h1[1].matchAll(/clamp\(([\d.]+)rem/g)].map((m) => Number(m[1])));
  let biggest = 0, where = "";
  for (const f of files("app", [".tsx"])) {
    const src = read(f).replace(h1[1], "");
    for (const m of src.matchAll(/\btext-(xs|sm|base|lg|[2-9]?xl)\b/g)) if (TW[m[1]] > biggest) { biggest = TW[m[1]]; where = `${f} text-${m[1]}`; }
    for (const m of src.matchAll(/text-\[(?:clamp\([^,]+,[^,]+,\s*)?([\d.]+)rem/g)) if (Number(m[1]) > biggest) { biggest = Number(m[1]); where = `${f} ${m[0]}`; }
  }
  assert.ok(heroMin > biggest, `hero minimum ${heroMin}rem must be larger than ${where} (${biggest}rem)`);
});

test("owner change (20 Nov 2026): no pillars band under the hero", () => {
  const home = read("app/page.tsx");
  assert.doesNotMatch(home, /PillarsBand/, "the band was removed at the owner's request");
  assert.deepEqual(pillars().map((p) => p.title), ["One teacher. One student.", "Flexible"]);
  assert.match(pillars()[1].text, /weekday or Saturday.*pay in 3 parts.*online from anywhere/);
  assert.equal(FLAGS.GROUP_ENABLED, false);
  assert.ok(!pillars().some((p) => /friends/.test(p.title)), "group pillar hidden while GROUP_ENABLED is off");
});

test("the message repeats in the title, description, programme pages and registration page", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /title: "[^"]*Flexible, one-on-one learning/);
  assert.match(layout, /description:\s*\n?\s*"Flexible, one-on-one learning/);
  assert.match(read("app/programmes/[slug]/page.tsx"), /<MessageStrip \/>/);
  assert.match(read("app/checkout/page.tsx"), /<MessageStrip \/>/);
});

test("'homeschool' appears at most twice", () => {
  const n = SITE_SOURCE().reduce((k, f) => k + (read(f).match(/homeschool/gi)?.length ?? 0), 0);
  assert.ok(n <= 2, `found ${n} mentions`);
});

test("career launch package: GitHub for tech programmes, portfolio for the others, internship from config", () => {
  for (const p of PROGRAMMES) {
    const c = careerPackage(p);
    assert.equal(c.length, 6);
    const tech = TECH_SLUGS.includes(p.slug);
    assert.equal(c.includes("GitHub profile setup and project documentation"), tech, p.slug);
    assert.equal(c.includes("Portfolio setup and project documentation"), !tech, p.slug);
    assert.equal(c[5], `A ${p.internshipMonths}-month internship`);
  }
  assert.deepEqual(TECH_SLUGS.sort(), ["cloud", "cloud-devops", "cybersecurity", "devops", "webdev"]);
});

test("no job placement, job guarantee or income claims anywhere", () => {
  for (const f of SITE_SOURCE()) {
    const src = read(f);
    for (const bad of [/guaranteed? (a )?job/i, /job guarantee/i, /job placement/i, /we place you/i, /earn ₦|earn \$|income of/i]) assert.doesNotMatch(src, bad, `${f}: ${bad}`);
  }
});

test("programme pages: one per programme, with Course data, price, curriculum, career package, trust lines and Register", () => {
  const page = read("app/programmes/[slug]/page.tsx");
  for (const s of ["generateStaticParams", "dynamicParams = false", '"@type": "Course"', "<HoldPrice", "<CurriculumActions", "<CareerLaunch", "<TrustLines", "/checkout/?p=", "duration(p)"]) assert.ok(page.includes(s), `missing ${s}`);
  for (const p of PROGRAMMES) {
    const html = built(`programmes/${p.slug}/index.html`);
    if (!html) continue; // checked after a build
    assert.match(html, /"@type":"Course"/, p.slug);
    assert.ok(html.includes(`href="/checkout/?p=${p.slug}"`), `${p.slug} Register link`);
    assert.ok(html.includes(`<title>${p.name.replace("&", "&amp;")} | Flexible, one-on-one learning`), `${p.slug} title`);
  }
  const map = built("sitemap.xml");
  if (map) for (const p of PROGRAMMES) assert.ok(map.includes(`/programmes/${p.slug}/`), `sitemap ${p.slug}`);
});

test("acceptance 9: curriculum buttons open the right PDF in a new tab, with a separate Download link", () => {
  const parts = read("app/site-parts.tsx");
  assert.match(parts, /<a href=\{p\.curriculum\} target="_blank" rel="noopener"/);
  assert.match(parts, /<a href=\{p\.curriculum\} download/);
  assert.match(parts, /disabled/);
  assert.match(read("app/page.tsx"), /href=\{p\.curriculum\} target="_blank" rel="noopener"/);
  for (const p of PROGRAMMES) assert.equal(p.curriculum, `/curricula/${p.slug}.pdf`);
});

test("curriculum scan: headings from PDF bookmarks, missing PDFs warn and disable the button", async () => {
  assert.deepEqual(await readHeadings(join(ROOT, "tests/fixtures/outline.pdf")), ["Module 1: Cloud basics", "Module 2: Networking", "Module 3: Security"]);
  assert.deepEqual(await readHeadings(join(ROOT, "tests/fixtures/plain.pdf")), []);
  const root = mkdtempSync(join(tmpdir(), "sma-cur-"));
  mkdirSync(join(root, "public/curricula"), { recursive: true });
  copyFileSync(join(ROOT, "tests/fixtures/outline.pdf"), join(root, "public/curricula/cloud.pdf"));
  const logs: string[] = [];
  const r = await scan(root, (m) => logs.push(m));
  assert.deepEqual(r.cloud, { pdf: true, headings: ["Module 1: Cloud basics", "Module 2: Networking", "Module 3: Security"] });
  assert.deepEqual(r.devops, { pdf: false, headings: [] });
  assert.equal(logs.filter((l) => l.includes("missing")).length, PROGRAMMES.length - 1);
});

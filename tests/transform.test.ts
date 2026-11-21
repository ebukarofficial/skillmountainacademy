// Institutional transformation (owner brief, 20 Nov 2026): source and build checks for the public site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROGRAMMES } from "../lib/config.ts";
import { PROGRAMME_COPY } from "../lib/programme-content.ts";
import { currencyForCountry } from "../lib/pricing.ts";
import { NAV } from "../lib/nav.ts";
import { ROOT, read } from "./helpers.ts";

const built = (p: string) => { const f = join(ROOT, "out", p); return existsSync(f) ? readFileSync(f, "utf8") : null; };

test("hero: the approved slider is kept; no currency control, price or register button in the hero", () => {
  const home = read("app/page.tsx");
  const hero = home.slice(home.indexOf('id="top"'), home.indexOf("Three principles"));
  assert.ok(home.includes("setInterval(() => setActive((a) => (a + 1) % SLIDES.length), 5500)"), "slide timing changed");
  for (const s of ["SLIDES.map", "h-[26rem] gap-2 sm:h-[30rem] lg:h-[33rem]", "flex-[9]", "text-balance break-words", "[writing-mode:vertical-rl]", "onTouchEnd"]) assert.ok(hero.includes(s), `slider changed: ${s}`);
  assert.doesNotMatch(hero, /CurrencySwitcher|<Money|<Price|sl\.prog\.price|\/checkout\/\?p=|>Register</, "no price, currency control or register button in the hero");
  assert.match(hero, />Explore programme</i);
  assert.doesNotMatch(home, /\/checkout\/\?p=/, "the home page sends visitors to programme pages, not straight to payment");
});

test("navigation: Home, About, Programmes, Our Faculty, The Learning Experience, Admissions; Apply, and no public sign-in", () => {
  assert.deepEqual(NAV.map(([, t]) => t), ["Home", "About", "Programmes", "Our Faculty", "The Learning Experience", "Admissions"]);
  for (const [h] of NAV.slice(1)) assert.ok(existsSync(join(ROOT, "app", h.replace(/^\/|\/$/g, ""), "page.tsx")), `page for ${h}`);
  assert.match(read("app/header.tsx"), />Apply</);
  assert.doesNotMatch(read("app/header.tsx"), /href="\/app\//, "no sign-in link on the public site");
  const map = built("sitemap.xml");
  if (map) for (const [h] of NAV.slice(1)) assert.ok(map.includes(h), `sitemap ${h}`);
});

test("programme cards: title, image, description, one Explore Programme action; no price and no topic list", () => {
  const brand = read("app/brand.tsx");
  const card = brand.slice(brand.indexOf("export function ProgrammeCard"), brand.indexOf("export function ProgrammeGrid"));
  assert.doesNotMatch(card, /price|Money|Price|learn\.map|learnList|curriculum/i);
  assert.equal(card.match(/Explore Programme/g)?.length, 1);
  const html = built("index.html");
  if (html) for (const p of PROGRAMMES) assert.ok(html.includes(`/programmes/${p.slug}/`), p.slug);
});

test("every programme has editorial copy, and the catalogue matches the approved list", () => {
  assert.deepEqual(PROGRAMMES.map((p) => [p.slug, p.name, p.price]), [
    ["graphics", "Graphics Design", 350000], ["uiux", "UI/UX Design (Product Design)", 400000], ["webdev", "Web Development", 500000], ["marketing", "Digital Marketing", 300000],
    ["cybersecurity", "Cybersecurity", 650000], ["cloud", "Cloud Engineering", 450000], ["devops", "DevOps Engineering", 500000], ["cloud-devops", "Cloud & DevOps Engineering", 650000],
    ["ai-automation", "AI Automation", 300000], // added by the final refinement brief (21 Nov 2026), full payment only
  ]);
  for (const p of PROGRAMMES) {
    const c = PROGRAMME_COPY[p.slug];
    assert.ok(c && c.discipline && c.intro.length >= 2 && c.mastery.length >= 4 && c.outcomes.length >= 3 && c.opportunities.length >= 3, p.slug);
  }
  assert.ok(!PROGRAMMES.some((p) => p.was), "no invented discounts");
});

test("currency follows the selected country (NGN, USD, GBP, EUR)", () => {
  assert.equal(currencyForCountry("NG"), "NGN");
  assert.equal(currencyForCountry("US"), "USD");
  assert.equal(currencyForCountry("CA"), "USD");
  assert.equal(currencyForCountry("GB"), "GBP");
  assert.equal(currencyForCountry("DE"), "EUR");
  assert.equal(currencyForCountry("FR"), "EUR");
  assert.equal(currencyForCountry("GH"), "USD");
  assert.match(read("app/programmes/[slug]/page.tsx"), /<CountrySelect compact \/>/);
});

test("the public site never shows capacity figures", () => {
  for (const f of ["app/admissions-status.tsx", "app/admissions/status-table.tsx", "app/admissions/page.tsx", "app/brand.tsx", "app/page.tsx", "app/programmes/[slug]/page.tsx"]) {
    assert.doesNotMatch(read(f), /capacity\.|\.available|seats? (left|remaining)|places? left|enrolled\b/i, f);
  }
});

test("no unsupported claims: rankings, accreditation, graduate numbers, placements, invented testimonials", () => {
  const files = ["app/page.tsx", "app/about/page.tsx", "app/faculty/page.tsx", "app/learning-experience/page.tsx", "app/admissions/page.tsx", "app/programmes/[slug]/page.tsx", "lib/institution.ts", "lib/programme-content.ts"];
  for (const f of files) {
    const src = read(f);
    for (const bad of [/ranked (first|top|#|number)/i, /(is|are) accredited/i, /\d[\d,]* (graduates|alumni|students trained)/i, /guarantee/i, /job placement/i, /world-class faculty/i, /unhackable/i]) assert.doesNotMatch(src, bad, `${f}: ${bad}`);
  }
  assert.doesNotMatch(read("lib/institution.ts"), /"[^"]*" — /, "no quoted testimonials");
});

test("enrolment is built into the programme page and shares the checkout's server-verified flow", () => {
  const enrol = read("app/programmes/[slug]/enrol.tsx");
  assert.match(enrol, /<EnrolmentFlow p=\{p\} embedded \/>/);
  assert.match(enrol, /hashchange/);
  const flow = read("app/checkout/flow.tsx");
  assert.match(flow, /adm\.ready && !adm\.canEnrol/, "closed or full programmes show no form");
  assert.match(read("src/server/routes/register.ts"), /await assertCanRegister\(env\.DB, prog\.slug\);/, "and the server refuses too");
});

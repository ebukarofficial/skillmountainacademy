// Phase 8: reviews, mentors, FAQ, structured data, alt text and the footer email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUSINESS, FAQ, FAQ_GROUP, FLAGS, faqList } from "../lib/config.ts";
import { cleanMentors, cleanReviews, showMentors, showReviews, MIN_REVIEWS } from "../lib/content-rules.ts";
import { built, files, read } from "./helpers.ts";

const json = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const ld = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test("reviews: fed by data/reviews.json, hidden while there are fewer than 3 valid reviews; no invented reviews shipped", () => {
  assert.deepEqual(json("data/reviews.json"), [], "only real reviews, added by the owner");
  assert.equal(MIN_REVIEWS, 3);
  const r = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `L${i}`, programme: "cloud", year: 2026, quote: "Great mentor." }));
  assert.equal(showReviews(cleanReviews(r(2))), false);
  assert.equal(showReviews(cleanReviews(r(3))), true);
  const mixed = cleanReviews([...r(2), { name: "X", programme: "ielts", year: 2026, quote: "q" }, { name: "", programme: "cloud", year: 2026, quote: "q" }, { name: "Y", programme: "cloud", year: 2026, quote: "q", photo: "../../etc/passwd" }]);
  assert.equal(mixed.length, 3, "invalid programme and missing name are skipped");
  assert.equal(mixed[2].photo, undefined, "unsafe photo names are dropped");
  assert.equal(showReviews(cleanReviews(json("data/reviews.json"))), false);
  const home = built("index.html");
  if (home) assert.doesNotMatch(home, /data-reviews|id="reviews"/, "section hidden today");
});

test("mentors: fed by data/mentors.json, hidden until the owner adds entries", () => {
  assert.deepEqual(json("data/mentors.json"), []);
  assert.equal(showMentors(cleanMentors([])), false);
  assert.equal(showMentors(cleanMentors([{ name: "T", role: "Cloud mentor", programmes: ["cloud", "nope"] }])), true);
  assert.deepEqual(cleanMentors([{ name: "T", role: "Cloud mentor", programmes: ["cloud", "nope"] }])[0].programmes, ["cloud"]);
  assert.equal(cleanMentors([{ name: "T" }]).length, 0);
  const home = built("index.html");
  if (home) assert.doesNotMatch(home, /data-mentors/);
  assert.match(read("data/README.md"), /Never invent reviews or mentors/);
});

test("FAQ covers AWS and Azure, the internship, instalments, certificates, children; group classes only when switched on", () => {
  const text = JSON.stringify(faqList());
  for (const s of ["AWS", "Azure", "internship", "3 parts", "certificate", "children's package"]) assert.ok(text.includes(s), `FAQ missing ${s}`);
  assert.equal(FLAGS.GROUP_ENABLED, false);
  assert.ok(!faqList().includes(FAQ_GROUP), "group FAQ hidden while groups are off");
  assert.match(FAQ_GROUP[1], /1 or 2 friends/);
  assert.doesNotMatch(text, /guarantee|job placement/i);
  assert.match(text, /not a promise of employment/);
  assert.ok(FAQ.length >= 15);
});

test("structured data: Organization on every page, FAQPage on the home page, Course on programme pages", () => {
  const home = built("index.html");
  const prog = built("programmes/cyber/index.html") ?? built("programmes/cybersecurity/index.html");
  if (!home || !prog) return;
  const h = ld(home);
  const org = h.find((x) => x["@type"] === "EducationalOrganization");
  assert.ok(org);
  assert.equal(org.email, BUSINESS.email);
  const faq = h.find((x) => x["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, faqList().length);
  assert.equal(faq.mainEntity[0].acceptedAnswer["@type"], "Answer");
  const p = ld(prog);
  assert.ok(p.some((x) => x["@type"] === "Course" && x.offers.priceCurrency === "NGN"));
  assert.ok(p.some((x) => x["@type"] === "EducationalOrganization"));
});

test("descriptive alt text: no empty alt on programme photos", () => {
  for (const f of files("app", [".tsx"])) {
    const src = read(f);
    assert.doesNotMatch(src, /<Image src=\{(PHOTO|sl\.photo)[^>]*alt=""/, `${f} has a programme photo with empty alt`);
  }
  const home = built("index.html");
  if (home) assert.match(home, /alt="A learner studying Cloud Engineering online/);
});

test("the footer shows a contact email on every page", () => {
  assert.match(read("app/page.tsx"), /<SiteFooter \/>/, "the home page uses the shared footer");
  assert.match(read("app/site-parts.tsx"), /Email: <a href=\{`mailto:\$\{BUSINESS\.email\}`\}/);
  const home = built("index.html");
  if (home) assert.ok(home.includes(`mailto:${BUSINESS.email}`));
});

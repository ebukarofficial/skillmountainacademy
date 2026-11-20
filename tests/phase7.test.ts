// Phase 7: the children's package.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUDIENCE, CHILDREN, FLAGS } from "../lib/config.ts";
import { built, read } from "./helpers.ts";

test("/children explains parent accounts, consent, customised curricula and one-on-one teaching", () => {
  const page = read("app/children/page.tsx");
  for (const s of ["parent account", "consent", "customised curriculum", "One teacher. One student.", "<EnquiryForm />", "<MessageStrip />"]) assert.ok(page.toLowerCase().includes(s.toLowerCase()), `missing ${s}`);
  const html = built("children/index.html");
  if (html) assert.match(html, /<title>Children&#x27;s package \| Flexible, one-on-one learning/);
  const map = built("sitemap.xml");
  if (map) assert.ok(map.includes("/children/"));
});

test("parent enquiry form: the spec's fields, consent, Turnstile, posts to the Worker, safe fallback", () => {
  const f = read("app/children/enquiry-form.tsx");
  for (const n of ['name="parentName"', 'name="email"', 'name="phone"', 'name="childAge"', 'name="programme"', 'name="consent"', "<Turnstile", '"/api/children-enquiry"', "data-enquiry-fallback", "wa.me"]) assert.ok(f.includes(n), `missing ${n}`);
  assert.match(read("src/server/routes/children.ts"), /CHILDREN\.minAge, CHILDREN\.maxAge/);
});

test("acceptance 10: children's self-serve checkout is invisible while CHILDREN_ENABLED is off", () => {
  assert.equal(FLAGS.CHILDREN_ENABLED, false);
  assert.deepEqual(CHILDREN.programmes, []);
  assert.match(read("app/children/page.tsx"), /const selfServe = FLAGS\.CHILDREN_ENABLED && CHILDREN\.programmes\.length > 0;/);
  const html = built("children/index.html");
  if (html) {
    assert.doesNotMatch(html, /data-children-selfserve/);
    assert.doesNotMatch(html, /Register your child/);
  }
  const home = built("index.html");
  if (home) assert.doesNotMatch(home, /data-group-option|Learn with 1 or 2 friends/, "group option invisible too");
});

test("the 'Parents and children' card in Who it's for links to /children/", () => {
  const card = AUDIENCE.find(([t]) => t === "Parents and children");
  assert.ok(card);
  assert.equal(card[2], "/children/");
  const home = built("index.html");
  if (home) assert.match(home, /href="\/children\/"/);
});

// The official email layout: logo header, photo hero, branded footer with social links, brand colours only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { letter, notice } from "../src/server/email.ts";

test("letters carry the logo, the student photo, the headline and a footer with every social link", () => {
  const html = letter("Your secure sign-in link", "Dear Ada &amp; Co", "<p>Body</p>");
  assert.match(html, /<img src="https:\/\/skillmountainacademy\.com\/email\/logo-white\.png/);
  assert.match(html, /hero-student\.jpg/);
  assert.match(html, /Your secure sign‑in link/, "hyphenated words stay together");
  assert.match(html, /Dear Ada &amp; Co,/, "already-escaped names are not escaped twice");
  for (const s of ["facebook", "instagram", "linkedin", "x", "tiktok", "whatsapp"]) {
    assert.match(html, new RegExp(`/email/${s}\\.png`), s);
    assert.ok(existsSync(`public/email/${s}.png`), `public/email/${s}.png`);
  }
  for (const f of ["logo-white.png", "hero-student.jpg"]) assert.ok(existsSync(`public/email/${f}`), f);
  assert.match(html, /admission@skillmountainacademy\.com/);
  const colours = new Set(html.match(/#[0-9a-fA-F]{6}\b/g));
  for (const c of colours) assert.ok(["#16163a", "#1e0e6f", "#c8233a", "#fcf9db", "#fffdf0", "#f7892b", "#14296b", "#5b2270", "#ffffff"].includes(c.toLowerCase()), `brand colour only: ${c}`);
});

test("internal notices to staff use the staff card, not the student photo", () => {
  const html = notice("New registration", "<p>x</p>");
  assert.doesNotMatch(html, /hero-student/);
  assert.match(html, /hero-staff\.png/);
  assert.match(html, /New registration/);
});

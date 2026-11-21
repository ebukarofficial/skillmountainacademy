// Every kind of email has its own card: label, colour and picture; all pictures exist; palette colours only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { letter, notice, type EmailKind } from "../src/server/email.ts";
import { designOf } from "../lib/notify-rules.ts";

const KINDS: EmailKind[] = ["admission", "login", "instructor", "admin", "enquiry", "notification", "reminder", "payment", "graduation"];

test("each email kind has its own label and picture, served from the site", () => {
  const seen = new Set<string>();
  for (const k of KINDS) {
    const html = letter("Headline", "Dear Ada", "<p>Body</p>", k);
    const img = html.match(/email\/(hero-[a-z]+\.(?:png|jpg))/)![1];
    assert.ok(existsSync(`public/email/${img}`), img);
    seen.add(img);
    for (const f of ["logo-white.png", "facebook.png", "instagram.png", "linkedin.png", "x.png", "tiktok.png", "whatsapp.png"]) assert.ok(html.includes(`/email/${f}`), `${k} ${f}`);
    for (const hex of html.match(/#[0-9a-fA-F]{6}\b/g) ?? []) assert.ok(["#16163a", "#1e0e6f", "#14296b", "#5b2270", "#c8233a", "#f7892b", "#fcf9db", "#fffdf0", "#ffffff"].includes(hex.toLowerCase()), `${k}: ${hex}`);
  }
  assert.equal(seen.size, KINDS.length, "a different picture for every kind");
  assert.match(notice("New registration", "<p>x</p>", "enquiry"), /For the Academy team\./);
});

test("notifications pick the right card", () => {
  assert.equal(designOf("reminder.1h"), "reminder");
  assert.equal(designOf("session.cancelled"), "reminder");
  assert.equal(designOf("payment.due"), "payment");
  assert.equal(designOf("programme.completed"), "graduation");
  assert.equal(designOf("assignment.new"), "notification");
  assert.match(readFileSync("src/server/lms/routes/auth.ts", "utf8"), /kind: user\.role === "admin" \? "admin" : user\.role === "instructor" \? "instructor" : "login"/);
});

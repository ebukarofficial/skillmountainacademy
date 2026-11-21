// LMS 6: dashboard screens (static pages that call the API; the server enforces every permission).
import { test } from "node:test";
import assert from "node:assert/strict";
import { built, files, read } from "./helpers.ts";

test("sign-in, confirm and dashboard pages exist, are private (noindex) and not in the sitemap", () => {
  for (const f of ["app/app/page.tsx", "app/app/login/page.tsx", "app/app/confirm/page.tsx", "app/app/student/login/page.tsx", "app/app/instructor/login/page.tsx", "app/app/layout.tsx"]) assert.ok(read(f));
  assert.match(read("app/app/layout.tsx"), /robots: \{ index: false, follow: false \}/);
  for (const p of ["app/index.html", "app/login/index.html", "app/confirm/index.html", "app/student/login/index.html", "app/instructor/login/index.html"]) {
    const html = built(p);
    if (html) assert.match(html, /<meta name="robots" content="noindex, nofollow"/, p);
  }
  const map = built("sitemap.xml");
  if (map) assert.doesNotMatch(map, /\/app\//);
});

test("the confirm page signs in only on a click (POST), never on page load", () => {
  const src = read("app/app/confirm/page.tsx");
  assert.match(src, /onClick=\{go\}/);
  assert.match(src, /api\("\/api\/auth\/verify", \{ method: "POST"/);
  assert.doesNotMatch(src, /useEffect/);
});

test("each role gets its own workspace in the shared shell, with the brief's sections", () => {
  const page = read("app/app/page.tsx");
  for (const r of ["StudentDashboard", "InstructorDashboard", "AdminDashboard"]) assert.ok(page.includes(`<${r}`));
  for (const f of ["student", "instructor", "admin"]) assert.match(read(`app/app/${f}.tsx`), /<AppShell me=\{me\} nav=\{nav\}/, f);
  const stu = read("app/app/student.tsx");
  for (const s of ["Welcome to your learning space.", "Registration No", "<NextClass", "Your responsibilities", "Classes and calendar", "Coursework", "Learning materials", "Learning assistant", "Messages", "Progress", "Academic record", "Admitted", "Payments", "Email preferences", "Join the live session", "has not added the"]) assert.ok(stu.includes(s), s);
  const ins = read("app/app/instructor.tsx");
  for (const s of ["Attendance to record", "My schedule", "Next 7 days", "Add link", "Completed", "Student missed", "Waiting to be marked", "Set work", "My performance", "Faculty No"]) assert.ok(ins.includes(s), s);
  const adm = read("app/app/admin.tsx");
  for (const s of ["Overview", "Admit a student", "/api/app/admin/admit", "People", "Enrolments", "Orders", "Academics", "Finance", "Instructors", "Materials", "Platform", "Fixed weekly class time", "Confirm bank payment"]) assert.ok(adm.includes(s), s);
  const shell = read("app/app/shell.tsx");
  for (const s of ["Notifications", "Sign out", "My account", "aria-current"]) assert.ok(shell.includes(s), s);
  assert.doesNotMatch([stu, ins, adm, shell].join("\n"), /--font-serif|bg-cream/, "dashboards use the modern sans and white cards");
});

test("dashboards use only existing colour tokens (no hex values) and never show a made-up Meet link", () => {
  for (const f of files("app/app", [".tsx"])) {
    assert.doesNotMatch(read(f), /#[0-9a-fA-F]{3,8}\b/, `${f} must use colour tokens`);
  }
  assert.doesNotMatch(read("app/app/student.tsx"), /meet\.google\.com\//, "links come only from the instructor");
});

test("the public site has no sign-in links; students and staff have their own private entrances", () => {
  for (const f of ["app/header.tsx", "app/site-parts.tsx", "app/page.tsx"]) assert.doesNotMatch(read(f), /href="\/app\//, f);
  assert.match(read("app/page.tsx"), /<SiteFooter \/>/);
  assert.match(read("app/app/student/login/page.tsx"), /<EntryPage kind="student" \/>/);
  assert.match(read("app/app/instructor/login/page.tsx"), /<EntryPage kind="instructor" \/>/);
  assert.match(read("app/app/login/page.tsx"), /<EntryPage kind="admin" \/>/, "/app/login/ is for administrators only");
  assert.match(read("app/app/staff/page.tsx"), /\/app\/instructor\/login\//, "the old staff entrance forwards to faculty");
  const entry = read("app/app/entry.tsx");
  for (const s of ["QUOTES", "pickQuote", "localStorage", "next", "Turnstile"]) assert.ok(entry.includes(s), s);
  for (const f of ["app/app/login/page.tsx", "app/app/student/login/page.tsx", "app/app/instructor/login/page.tsx"]) assert.match(read(f), /index: false/, `${f} is not indexed`);
});

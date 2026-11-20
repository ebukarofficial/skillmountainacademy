// LMS 6: dashboard screens (static pages that call the API; the server enforces every permission).
import { test } from "node:test";
import assert from "node:assert/strict";
import { built, files, read } from "./helpers.ts";

test("sign-in, confirm and dashboard pages exist, are private (noindex) and not in the sitemap", () => {
  for (const f of ["app/app/page.tsx", "app/app/login/page.tsx", "app/app/login/confirm/page.tsx", "app/app/layout.tsx"]) assert.ok(read(f));
  assert.match(read("app/app/layout.tsx"), /robots: \{ index: false, follow: false \}/);
  for (const p of ["app/index.html", "app/login/index.html", "app/login/confirm/index.html"]) {
    const html = built(p);
    if (html) assert.match(html, /<meta name="robots" content="noindex, nofollow"/, p);
  }
  const map = built("sitemap.xml");
  if (map) assert.doesNotMatch(map, /\/app\//);
});

test("the confirm page signs in only on a click (POST), never on page load", () => {
  const src = read("app/app/login/confirm/page.tsx");
  assert.match(src, /onClick=\{go\}/);
  assert.match(src, /api\("\/api\/auth\/verify", \{ method: "POST"/);
  assert.doesNotMatch(src, /useEffect/);
});

test("each role gets its dashboard; the student's centre column (next class) comes first on phones", () => {
  const page = read("app/app/page.tsx");
  for (const r of ["StudentDashboard", "InstructorDashboard", "AdminDashboard"]) assert.ok(page.includes(`<${r}`));
  const stu = read("app/app/student.tsx");
  assert.match(stu, /order-1 space-y-5 lg:order-2">\s*<NextClass/);
  for (const s of ["This week's assignments", "Quizzes and assessments", "Graded work", "Learning materials", "Upcoming classes", "Learning assistant", "My programme", "My progress", "Payments", "Join live session", "Meet link pending"]) assert.ok(stu.includes(s), s);
  const ins = read("app/app/instructor.tsx");
  for (const s of ["Attendance to record", "My schedule", "Next 7 days", "Add link", "Completed", "Student missed", "To mark", "Set work", "My performance"]) assert.ok(ins.includes(s), s);
  const adm = read("app/app/admin.tsx");
  for (const s of ["Overview", "Users", "Enrolments", "Orders", "Academics", "Finance", "Instructors", "Materials", "Platform", "Fixed weekly class time", "Confirm bank payment"]) assert.ok(adm.includes(s), s);
});

test("dashboards use only existing colour tokens (no hex values) and never show a made-up Meet link", () => {
  for (const f of files("app/app", [".tsx"])) {
    assert.doesNotMatch(read(f), /#[0-9a-fA-F]{3,8}\b/, `${f} must use colour tokens`);
  }
  assert.doesNotMatch(read("app/app/student.tsx"), /meet\.google\.com\//, "links come only from the instructor");
});

test("footers link to sign-in", () => {
  assert.match(read("app/page.tsx"), /href="\/app\/login\/"/);
  assert.match(read("app/site-parts.tsx"), /href="\/app\/login\/"/);
});

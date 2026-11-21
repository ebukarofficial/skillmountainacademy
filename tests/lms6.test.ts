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
  for (const s of ["Welcome, {firstName(me.fullName)}.", "Registration No", "<NextClass", "Your Academic Tasks", "Announcements and messages", "My Programme", "Current module", "Continue learning", "topics completed",
    "Learning Materials", "Assignments", "Assessments", "Calendar", "Messages", "Notifications", "Profile", "Academic progress", "Academic record", "Admitted", "Payments", "Email preferences", "Join the live session", "has not added the"]) assert.ok(stu.includes(s), s);
  const ins = read("app/app/instructor.tsx");
  for (const s of ["Overview", "My Students", "My Programmes", "Teaching Calendar", "Class Sessions", "Assignments", "Assessments", "Attendance", "Messages", "Academic Resources", "Instructor Profile",
    "Today's classes", "Upcoming classes", "Assignments awaiting grading", "New student messages", "Recent academic activity", "Attendance to record", "My schedule", "Next 7 days", "Add link", "Completed", "Student missed", "Faculty No"]) assert.ok(ins.includes(s), s);
  const adm = read("app/app/admin.tsx");
  for (const s of ["Institutional overview", "Students", "Instructors", "Programmes", "Admissions", "Payments", "Academic records", "Instructor allocation", "Attendance", "Assessments", "Learning materials", "Notifications", "Security and audit",
    "Admit a student", "/api/app/admin/admit", "/api/app/admin/coursework", "Fixed weekly class time", "Confirm bank payment"]) assert.ok(adm.includes(s), s);
  const shell = read("app/app/shell.tsx");
  for (const s of ["Notifications", "Sign out", "My profile", "aria-current", "View all notifications", "Skip to content", 'quick("calendar"', 'quick("messages"']) assert.ok(shell.includes(s), s);
  assert.doesNotMatch([stu, ins, adm, shell].join("\n"), /--font-serif|bg-cream|bg-paper|uppercase/, "dashboards: modern sans, white surfaces, no decorative capitals");
  assert.match(shell, /<div className="min-h-screen overflow-x-clip bg-ink\/\[0\.03\]">/, "a soft neutral page under white cards (owner: white should be subtle)");
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

test("academic calendar: upcoming and month views, built only from real sessions and deadlines", () => {
  const cal = read("app/app/calendar.tsx");
  for (const s of ["Upcoming events", "Month", "Previous month", "Next month", "Africa/Lagos", 'role="grid"']) assert.ok(cal.includes(s), s);
  const stu = read("app/app/student.tsx");
  assert.match(stu, /sessions\.data\?\.sessions[\s\S]*assignments\.map[\s\S]*allQuizzes\.map/, "events come from sessions, assignments and quizzes");
  assert.match(read("src/server/lms/routes/teaching.ts"), /completedLessons\(c\.db, c\.user\.id\)/, "a student's lesson completion comes from their own record");
});

test("public site: catalogue search and discipline filter, academic homepage order, sample certificate labelled", () => {
  const cat = read("app/programmes/catalogue.tsx");
  for (const s of ["Search programmes", 'aria-label="Disciplines"', "All levels"]) assert.ok(cat.includes(s), s);
  const home = read("app/page.tsx");
  const order = ['id="why"', 'id="programmes"', 'id="certificate"', 'id="model"', 'id="faculty"', 'id="book"'].map((s) => home.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `homepage order ${order}`);
  assert.match(home, /SAMPLE/);
  assert.match(home, /Illustration only/);
  assert.match(home, /not a university degree/);
  assert.doesNotMatch(home, /globally respected/, "no unverifiable claims");
  // Owner: the public website keeps its colours and the stylish serif (italic) hero; only the dashboards changed.
  assert.match(read("app/layout.tsx"), /cormorant-garamond/);
  assert.match(read("app/page.tsx"), /data-hero-headline className="[^"]*font-\(family-name:--font-serif\)[\s\S]*?<em className="font-medium text-brand-red">made for more\.<\/em>/);
  assert.doesNotMatch(read("app/layout.tsx"), /<body[^>]*bg-white/, "public pages keep the cream background");
});

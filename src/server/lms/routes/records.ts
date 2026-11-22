// Instructor records (owner brief, 21 Nov 2026). Every figure is calculated from class, coursework and attendance records.
//   GET /api/app/instructor/records      one card per assigned student
//   GET /api/app/instructor/attendance   this week, this month, and recent classes with their outcome
//   GET /api/app/instructor/meet-link    the instructor's own Google Meet room and the classes using it
//   PUT /api/app/instructor/meet-link    {url, apply: "none" | "empty" | "all"}
import { ApiError, nowIso } from "../../http";
import { ok, route, type Ctx } from "../api";
import { instructorEnrolments, type Enrolment } from "../data/enrolments";
import { applyMeetLink, attendanceBetween, enrolmentSessionStats, listSessions, sessionsUsingLink } from "../data/teaching";
import { getUser, updateUser } from "../data/users";
import { progressFor } from "./coursework";
import { MEET_RE, sessionView } from "./teaching";
import { addDays, lagosDate, lagosToIso } from "../time";
import { cleanRules, DEFAULT_RULES, RULES_KEY, type AlertRules } from "../rules";
import { getSetting } from "../data/engagement";

const cleanRulesFrom = async (c: Ctx) => cleanRules(await getSetting(c.db, RULES_KEY));

// No grade-point scale has been approved, so the Academy reports an academic average instead of a GPA:
// the mean of the assignment, test (quiz) and assessment averages that exist, equally weighted.
export function academicAverage(p: { assignments: { avgScorePct: number | null }; quizzes: { avgScorePct: number | null }; assessments: { avgScorePct: number | null } }) {
  const xs = [p.assignments.avgScorePct, p.quizzes.avgScorePct, p.assessments.avgScorePct].filter((v): v is number => v !== null);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

export async function studentRecord(c: Ctx, e: Enrolment & { full_name: string; email?: string; photo_key: string | null; student_no: string | null }, rules: AlertRules = DEFAULT_RULES) {
  const [p, s] = await Promise.all([progressFor(c.db, e, rules), enrolmentSessionStats(c.db, e.id, nowIso())]);
  const average = academicAverage(p);
  const status = e.status !== "active" ? e.status.replace(/_/g, " ") : p.needsAttention.length ? "Needs attention" : "On track";
  return {
    enrolmentId: e.id, studentId: e.student_id, fullName: e.full_name, studentNo: e.student_no, photo: e.photo_key ? `/api/app/files/photo/${e.student_id}` : null,
    programme: e.programme_slug, programmeName: p.programmeName, enrolmentStatus: e.status, progress: p.overall,
    sessions: { scheduled: s.total - s.rescheduled, upcoming: s.upcoming, attended: s.attended, missed: s.missed, cancelled: s.cancelled, rescheduled: s.rescheduled, late: s.late, excused: s.excused,
      attendancePct: p.attendance.pct },
    marks: { assignments: p.assignments.avgScorePct, tests: p.quizzes.avgScorePct, assessments: p.assessments.avgScorePct, average },
    status, needsAttention: p.needsAttention,
  };
}

route("GET", "/api/app/instructor/records", ["instructor"], async (c) => {
  const [rows, rules] = await Promise.all([instructorEnrolments(c.db, c.user.id), cleanRulesFrom(c)]);
  return ok({ records: await Promise.all(rows.filter((e) => e.status !== "withdrawn").map((e) => studentRecord(c, e, rules))), averageMethod: "Mean of assignment, test and assessment averages (no GPA scale has been set)." });
});

route("GET", "/api/app/instructor/attendance", ["instructor"], async (c) => {
  const today = lagosDate(new Date());
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const weekFrom = addDays(today, -dow), monthFrom = `${today.slice(0, 8)}01`;
  const nextMonth = (() => { const [y, m] = today.split("-").map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; })();
  const [week, month, recent] = await Promise.all([
    attendanceBetween(c.db, c.user.id, lagosToIso(weekFrom, "00:00"), lagosToIso(addDays(weekFrom, 7), "00:00")),
    attendanceBetween(c.db, c.user.id, lagosToIso(monthFrom, "00:00"), lagosToIso(nextMonth, "00:00")),
    listSessions(c.db, { instructorId: c.user.id, from: lagosToIso(addDays(today, -30), "00:00"), to: lagosToIso(addDays(today, 1), "00:00"), limit: 300 }),
  ]);
  return ok({ week: { from: weekFrom, ...week }, month: { from: monthFrom, ...month }, sessions: recent.reverse().map((s) => sessionView(s, c.user)) });
});

route("GET", "/api/app/instructor/meet-link", ["instructor"], async (c) => {
  const u = await getUser(c.db, c.user.id);
  const link = u?.meet_link ?? null;
  const using = link ? await sessionsUsingLink(c.db, c.user.id, link, nowIso()) : [];
  return ok({ meetLink: link, sessions: using.map((s) => sessionView(s, c.user)) });
});

route("PUT", "/api/app/instructor/meet-link", ["instructor"], async (c) => {
  const b = await c.body<{ url?: string; apply?: string }>();
  const url = String(b.url ?? "").trim();
  if (url && !MEET_RE.test(url)) throw new ApiError(400, "invalid", "Use a Google Meet link like https://meet.google.com/abc-defg-hij");
  const apply = b.apply === "all" || b.apply === "empty" ? b.apply : "none";
  if (!url && apply !== "none") throw new ApiError(400, "invalid", "Add a link before applying it to classes.");
  await updateUser(c.db, c.user.id, { meet_link: url || null });
  const at = nowIso();
  const changed = url && apply !== "none" ? await applyMeetLink(c.db, c.user.id, url, at, apply === "all", at) : 0;
  await c.audit("meet.default", "user", c.user.id, { set: !!url, apply, changed });
  // Students are told by the reminder emails (24 h, 1 h, 15 min), which carry the join instruction; meet_notified_at was reset.
  return ok({ meetLink: url || null, applied: changed });
});

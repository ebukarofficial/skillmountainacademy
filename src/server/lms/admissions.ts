// Admissions and capacity, computed from the database. The public sees only open / upcoming / closed / full;
// capacity figures stay inside the admin API.
import { PROGRAMMES } from "../../../lib/config.ts";
import { admissionStatus, capacity, DEFAULT_SETTING, type Capacity, type PublicStatus, type Setting } from "../../../lib/admissions.ts";
import { ApiError } from "../http";
import { allAssignments, allSettings, enrolledCounts, listPeriods, type Assignment, type PeriodRow } from "./data/admissions";

export type ProgrammeAdmission = { slug: string; name: string; setting: Setting; status: PublicStatus; capacity: Capacity; assignments: Assignment[] };

const counts = (a: Assignment) => a.status === "active" && (a.verification === null || a.verification === "approved");

export async function programmeAdmissions(db: D1Database, now = new Date()): Promise<{ list: ProgrammeAdmission[]; periods: PeriodRow[] }> {
  const since = new Date(now.getTime() - 90 * 86400_000).toISOString();
  const [settings, periods, enrolled, assignments] = await Promise.all([allSettings(db), listPeriods(db, since), enrolledCounts(db), allAssignments(db)]);
  const list = PROGRAMMES.map((p) => {
    const row = settings.find((s) => s.programme_slug === p.slug);
    const setting: Setting = row ? { mode: row.mode, enforce_capacity: row.enforce_capacity, reserved: row.reserved, default_instructor_cap: row.default_instructor_cap, listed: row.listed } : DEFAULT_SETTING;
    const mine = assignments.filter((a) => a.programme_slug === p.slug);
    const cap = capacity(mine.filter(counts), setting.default_instructor_cap, enrolled.find((e) => e.programme_slug === p.slug)?.n ?? 0, setting.reserved);
    return { slug: p.slug, name: p.name, setting, status: admissionStatus(p.slug, setting, periods, now, cap), capacity: cap, assignments: mine };
  });
  return { list, periods };
}

// Public view: status only.
export async function publicAdmissions(db: D1Database): Promise<Record<string, PublicStatus>> {
  const { list } = await programmeAdmissions(db);
  return Object.fromEntries(list.map((x) => [x.slug, x.status]));
}

// Used by POST /api/register before anything is saved or charged. If the admissions tables do not exist yet
// (migration 0004 not applied), registration carries on as before.
export async function assertCanRegister(db: D1Database | undefined, slug: string) {
  if (!db) return;
  let status: PublicStatus | undefined;
  try {
    status = (await publicAdmissions(db))[slug];
  } catch (e) {
    if (e instanceof ApiError && e.code === "not_configured") return;
    throw e;
  }
  if (!status || status.state === "open") return;
  const msg = status.state === "full" ? "This programme's current intake is fully subscribed, so we cannot take new registrations or payments for it right now."
    : status.state === "upcoming" ? "Admissions for this programme have not opened yet. Please check the programme page for the opening date."
    : "Admissions for this programme are currently closed.";
  throw new ApiError(409, status.state === "full" ? "programme_full" : "admissions_closed", msg);
}

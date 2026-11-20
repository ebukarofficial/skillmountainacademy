// SQL for admissions, capacity, teaching assignments and instructor verification.
import { all, one, run, type DB } from "./base";
import type { AdmissionMode, Period, Setting } from "../../../../lib/admissions.ts";

export type SettingRow = Setting & { programme_slug: string; updated_at: string | null; updated_by: string | null };
export type PeriodRow = Period & { id: string; label: string | null; created_at: string; created_by: string | null };
export type Assignment = { instructor_id: string; programme_slug: string; max_students: number | null; full_name: string; email: string; verification: string | null; status: string };

export const allSettings = (db: DB) => all<SettingRow>(db, "SELECT * FROM programme_admissions");
export const getSetting = (db: DB, slug: string) => one<SettingRow>(db, "SELECT * FROM programme_admissions WHERE programme_slug = ?1", slug);
export const upsertSetting = (db: DB, slug: string, s: { mode: AdmissionMode; enforce_capacity: number; reserved: number; default_instructor_cap: number; listed: number }, by: string, at: string) =>
  run(db, `INSERT INTO programme_admissions (programme_slug, mode, enforce_capacity, reserved, default_instructor_cap, listed, updated_at, updated_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(programme_slug) DO UPDATE SET mode = ?2, enforce_capacity = ?3, reserved = ?4, default_instructor_cap = ?5, listed = ?6, updated_at = ?7, updated_by = ?8`,
  slug, s.mode, s.enforce_capacity, s.reserved, s.default_instructor_cap, s.listed, at, by);

// Periods that are current or still to come (plus those that ended in the last 90 days, for the admin list).
export const listPeriods = (db: DB, since: string) => all<PeriodRow>(db, "SELECT * FROM admission_periods WHERE closes_at >= ?1 ORDER BY opens_at", since);
export const getPeriod = (db: DB, id: string) => one<PeriodRow>(db, "SELECT * FROM admission_periods WHERE id = ?1", id);
export const createPeriod = (db: DB, p: PeriodRow) => run(db, "INSERT INTO admission_periods (id, programme_slug, label, opens_at, closes_at, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  p.id, p.programme_slug, p.label, p.opens_at, p.closes_at, p.created_at, p.created_by);
export const cancelPeriod = (db: DB, id: string, at: string) => run(db, "UPDATE admission_periods SET cancelled_at = ?2 WHERE id = ?1 AND cancelled_at IS NULL", id, at);

// Active students per programme (paused students keep their place).
export const enrolledCounts = (db: DB) => all<{ programme_slug: string; n: number }>(db, "SELECT programme_slug, COUNT(*) AS n FROM enrolments WHERE status IN ('active', 'paused') GROUP BY programme_slug");
export const enrolledCount = async (db: DB, slug: string) => (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM enrolments WHERE programme_slug = ?1 AND status IN ('active', 'paused')", slug))?.n ?? 0;

// Every teaching assignment, with the instructor's state. Only approved + active ones count towards capacity.
const ASSIGN = `SELECT ip.instructor_id, ip.programme_slug, ip.max_students, u.full_name, u.email, u.verification, u.status
  FROM instructor_programmes ip JOIN users u ON u.id = ip.instructor_id`;
export const allAssignments = (db: DB) => all<Assignment>(db, `${ASSIGN} ORDER BY u.full_name`);
export const programmeAssignments = (db: DB, slug: string) => all<Assignment>(db, `${ASSIGN} WHERE ip.programme_slug = ?1`, slug);
export const instructorAssignments = (db: DB, id: string) => all<Assignment>(db, `${ASSIGN} WHERE ip.instructor_id = ?1`, id);
export const upsertAssignment = (db: DB, instructorId: string, slug: string, max: number | null, at: string) =>
  run(db, "INSERT INTO instructor_programmes (instructor_id, programme_slug, max_students, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(instructor_id, programme_slug) DO UPDATE SET max_students = ?3", instructorId, slug, max, at);
export const deleteAssignment = (db: DB, instructorId: string, slug: string) => run(db, "DELETE FROM instructor_programmes WHERE instructor_id = ?1 AND programme_slug = ?2", instructorId, slug);
// Students an instructor already has on a programme.
export const instructorLoad = (db: DB) => all<{ instructor_id: string; programme_slug: string; n: number }>(db,
  "SELECT instructor_id, programme_slug, COUNT(*) AS n FROM enrolments WHERE instructor_id IS NOT NULL AND status IN ('active', 'paused') GROUP BY instructor_id, programme_slug");

// Recruitment: every instructor account, newest first, with its verification state.
export type Candidate = { id: string; email: string; full_name: string; phone: string | null; status: string; verification: string | null; verification_checks: string | null;
  highest_qualification: string | null; qualifications: string | null; experience: string | null; specialization: string | null; links: string | null; bio: string | null;
  public_profile: number; photo_key: string | null; created_at: string };
const CANDIDATE = "SELECT id, email, full_name, phone, status, verification, verification_checks, highest_qualification, qualifications, experience, specialization, links, bio, public_profile, photo_key, created_at FROM users WHERE role = 'instructor'";
export const listCandidates = (db: DB, stage: string | null) => stage
  ? all<Candidate>(db, `${CANDIDATE} AND verification = ?1 ORDER BY created_at DESC LIMIT 500`, stage)
  : all<Candidate>(db, `${CANDIDATE} ORDER BY created_at DESC LIMIT 500`);
export const getCandidate = (db: DB, id: string) => one<Candidate>(db, `${CANDIDATE} AND id = ?1`, id);

// The public Faculty page: approved, active instructors who agreed to be listed.
export const publicFaculty = (db: DB) => all<Candidate & { programmes: string | null }>(db,
  `SELECT u.id, u.full_name, u.specialization, u.bio, u.qualifications, u.highest_qualification, u.links, u.photo_key,
     (SELECT GROUP_CONCAT(programme_slug) FROM instructor_programmes WHERE instructor_id = u.id) AS programmes
   FROM users u WHERE u.role = 'instructor' AND u.status = 'active' AND u.verification = 'approved' AND u.public_profile = 1 ORDER BY u.full_name LIMIT 200`);

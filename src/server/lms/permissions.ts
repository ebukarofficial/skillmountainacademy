// Administrator permission groups (Stage 2, audit finding F1). DEFAULT DENY: an administrator with a group may call an
// administrator route only if the route is listed below AND the group holds that area at the right level. A route that
// admits administrators but is missing from this table is refused for every scoped group (tests check that the table is
// complete).
//
// Activation is safe by design: `users.admin_role` is NULL for every existing administrator, and NULL means "not yet
// assigned: full access as today". Nothing changes for anyone until the owner assigns groups (see the migration plan in
// docs/SMA_SECURITY_REMEDIATION.md). Only a Super Administrator (or an unassigned administrator, i.e. the owner today)
// can assign groups.

export const ADMIN_ROLES = ["super", "admissions", "finance", "academic", "faculty", "support", "reporting"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type Area =
  | "any"          // every administrator: own profile, notifications, programme outlines, photos
  | "overview"     // the summary dashboard
  | "admissions"   // admission status and periods, applications, call requests, assistant enquiries, admitting a student
  | "orders"       // registrations and orders (needed by admissions and finance)
  | "finance"      // payments, manual transfers, currency
  | "academic"     // programmes, courses, lessons, enrolments, timetables, sessions, coursework, monitoring settings
  | "records"      // a student's progress, grades, weekly checklist and files (academic, support, reporting)
  | "faculty"      // instructor recruitment, verification, teaching programmes, instructor performance
  | "support"      // student contact: emails, guardian details, contact records
  | "people"       // the user directory (read) used by several screens
  | "users"        // creating, changing, suspending and inviting accounts; administrator groups; MFA resets
  | "security";    // audit log, platform status, test email

type Grant = { read: Area[]; write: Area[] };
const ALL_AREAS: Area[] = ["any", "overview", "admissions", "orders", "finance", "academic", "records", "faculty", "support", "people", "users", "security"];

export const GRANTS: Record<AdminRole, Grant> = {
  super:      { read: ALL_AREAS, write: ALL_AREAS },
  admissions: { read: ["any", "overview", "admissions", "orders", "people"], write: ["any", "admissions"] },
  finance:    { read: ["any", "overview", "orders", "finance", "people"], write: ["any", "finance"] },
  academic:   { read: ["any", "overview", "academic", "records", "people"], write: ["any", "academic"] },
  faculty:    { read: ["any", "overview", "faculty", "people"], write: ["any", "faculty"] },
  support:    { read: ["any", "overview", "records", "support", "people"], write: ["any", "support"] },
  reporting:  { read: ["any", "overview", "admissions", "orders", "finance", "academic", "records", "faculty"], write: ["any"] },
};

// [method, path, area]. GET = read; anything else = write.
const TABLE: [string, string, Area][] = [
  ["GET", "/api/me", "any"], ["PATCH", "/api/me", "any"], ["PUT", "/api/me/photo", "any"], ["GET", "/api/app/files/photo/:id", "any"],
  ["GET", "/api/app/notifications", "any"], ["POST", "/api/app/notifications/read", "any"], ["GET", "/api/app/programmes/:slug/courses", "any"],
  ["POST", "/api/auth/activity", "any"], ["POST", "/api/auth/logout-all", "any"],
  ["GET", "/api/auth/mfa/status", "any"], ["POST", "/api/auth/mfa/setup", "any"], ["POST", "/api/auth/mfa/enable", "any"],
  ["POST", "/api/auth/mfa/disable", "any"], ["POST", "/api/auth/mfa/recovery-codes", "any"],

  ["GET", "/api/app/admin/overview", "overview"],

  ["GET", "/api/app/admin/admissions", "admissions"], ["PATCH", "/api/app/admin/admissions/:slug", "admissions"],
  ["POST", "/api/app/admin/admissions/periods", "admissions"], ["DELETE", "/api/app/admin/admissions/periods/:id", "admissions"],
  ["POST", "/api/app/admin/admit", "admissions"],
  ["GET", "/api/app/admin/bookings", "admissions"], ["PATCH", "/api/app/admin/bookings/:id", "admissions"],
  ["GET", "/api/app/admin/enquiries", "admissions"], ["POST", "/api/app/admin/enquiries/:id/handled", "admissions"],

  ["GET", "/api/app/admin/orders", "orders"],

  ["GET", "/api/app/admin/finance", "finance"], ["GET", "/api/app/admin/payments", "finance"],
  ["POST", "/api/app/admin/orders/:reference/payments", "finance"],
  ["GET", "/api/app/admin/currency", "finance"], ["POST", "/api/app/admin/currency/refresh", "finance"],

  ["GET", "/api/app/admin/academics", "academic"], ["GET", "/api/app/admin/coursework", "academic"],
  ["POST", "/api/app/admin/courses", "academic"], ["PATCH", "/api/app/admin/courses/:id", "academic"],
  ["POST", "/api/app/admin/courses/:id/lessons", "academic"], ["PATCH", "/api/app/admin/lessons/:id", "academic"],
  ["GET", "/api/app/admin/enrolments", "academic"], ["POST", "/api/app/admin/enrolments", "academic"], ["PATCH", "/api/app/admin/enrolments/:id", "academic"],
  ["GET", "/api/app/admin/enrolments/:id/timetable", "academic"], ["POST", "/api/app/admin/enrolments/:id/timetable", "academic"],
  ["GET", "/api/app/admin/sessions", "academic"], ["GET", "/api/app/admin/sessions/pending-outcomes", "academic"],
  ["POST", "/api/app/admin/sessions", "academic"], ["POST", "/api/app/admin/sessions/:id/reschedule", "academic"],
  ["GET", "/api/app/admin/monitoring", "academic"],
  ["GET", "/api/app/admin/settings/engagement", "academic"], ["PUT", "/api/app/admin/settings/engagement", "academic"],
  ["GET", "/api/app/resources", "academic"], ["POST", "/api/app/resources", "academic"], ["PATCH", "/api/app/resources/:id", "academic"],
  ["DELETE", "/api/app/resources/:id", "academic"], ["PUT", "/api/app/resources/:id/file", "academic"], ["GET", "/api/app/files/resource/:id", "academic"],
  ["GET", "/api/app/sessions/:id", "academic"],

  ["GET", "/api/app/students/:id/progress", "records"], ["GET", "/api/app/students/:id/grades", "records"],
  ["GET", "/api/app/weekly/:enrolmentId", "records"], ["GET", "/api/app/files/submission/:id", "records"],

  ["GET", "/api/app/admin/instructors", "faculty"], ["GET", "/api/app/admin/instructors/:id/performance", "faculty"],
  ["PUT", "/api/app/admin/instructors/:id/programmes/:slug", "faculty"], ["DELETE", "/api/app/admin/instructors/:id/programmes/:slug", "faculty"],
  ["GET", "/api/app/admin/recruitment", "faculty"], ["GET", "/api/app/admin/recruitment/:id", "faculty"], ["PATCH", "/api/app/admin/recruitment/:id", "faculty"],

  ["GET", "/api/app/admin/students/:id/contact", "support"], ["PUT", "/api/app/admin/students/:id/guardian", "support"],
  ["POST", "/api/app/admin/students/:id/email", "support"], ["POST", "/api/app/admin/students/:id/contacts", "support"],

  ["GET", "/api/app/admin/users", "people"], ["GET", "/api/app/admin/users/:id", "people"],
  ["POST", "/api/app/admin/users", "users"], ["PATCH", "/api/app/admin/users/:id", "users"], ["POST", "/api/app/admin/users/:id/invite", "users"],
  ["POST", "/api/app/admin/users/:id/mfa-reset", "users"],
  ["GET", "/api/app/admin/settings/retention", "security"], ["PUT", "/api/app/admin/settings/retention", "security"],

  ["GET", "/api/app/admin/audit", "security"], ["GET", "/api/app/admin/platform", "security"], ["POST", "/api/app/admin/test-email", "security"],
];

const MAP = new Map(TABLE.map(([m, p, a]) => [`${m} ${p}`, a]));
export const permissionTable = () => TABLE.map(([method, path, area]) => ({ method, path, area }));
export const areaFor = (method: string, path: string): Area | undefined => MAP.get(`${method} ${path}`);
export const isAdminRole = (v: unknown): v is AdminRole => typeof v === "string" && (ADMIN_ROLES as readonly string[]).includes(v);

// Does this administrator (group, or null for unassigned) hold the right for this route? Default deny.
export function adminMay(role: string | null | undefined, method: string, path: string): boolean {
  if (role === null || role === undefined) return true; // unassigned = today's full access (see header)
  if (!isAdminRole(role)) return false;                 // an unknown value never grants anything
  const area = areaFor(method, path);
  if (!area) return false;
  const g = GRANTS[role];
  return method === "GET" ? g.read.includes(area) : g.write.includes(area);
}

// Areas an administrator can see, for the dashboard (display only; the server still checks every request).
export function areasFor(role: string | null | undefined): { read: Area[]; write: Area[] } {
  if (role === null || role === undefined) return { read: ALL_AREAS, write: ALL_AREAS };
  if (!isAdminRole(role)) return { read: [], write: [] };
  return GRANTS[role];
}

// Only a Super Administrator, or an unassigned administrator (the owner before groups are assigned), may manage groups.
export const canManageAdmins = (role: string | null | undefined) => role === null || role === undefined || role === "super";

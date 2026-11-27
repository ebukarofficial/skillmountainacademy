// Administrator permission groups (Stage 2, audit finding F1). DEFAULT DENY: an administrator with a group may call an
// administrator route only if the route is listed below AND the group holds that area at the right level. A route that
// admits administrators but is missing from this table is refused for every scoped group (tests check that the table is
// complete).
//
// Existing administrators (`users.admin_role` NULL, "unassigned") keep the day-to-day access they have today, EXCEPT
// managing administrators: since Stage 2B they cannot create administrators, change anyone's group, change roles to or
// from administrator, or suspend administrators. Those powers belong only to:
//   - the OWNER: the one account whose email equals the OWNER_EMAIL server variable (set in wrangler.jsonc, not in the
//     database, so no request can make someone the owner). The owner always has full access and cannot be suspended,
//     removed, demoted or reset by anyone else;
//   - Super Administrators, who are appointed (and removed) only by the owner, and only after the owner has completed
//     the one-time bootstrap (POST /api/app/owner/bootstrap). See docs/SMA_STAGE_2B_SECURITY_VERIFICATION.md.

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
  | "security"     // audit log, platform status, test email
  | "catalogue"    // programme catalogue: schools, drafts, prices, order (publishing also needs the owner or a delegate)
  | "owner";       // the owner console: bootstrap, permanent removals, removal approvals (the owner only)

type Grant = { read: Area[]; write: Area[] };
const ALL_AREAS: Area[] = ["any", "overview", "admissions", "orders", "finance", "academic", "records", "faculty", "support", "people", "users", "security", "catalogue"];

export const GRANTS: Record<AdminRole, Grant> = {
  super:      { read: ALL_AREAS, write: ALL_AREAS },
  admissions: { read: ["any", "overview", "admissions", "orders", "people"], write: ["any", "admissions"] },
  finance:    { read: ["any", "overview", "orders", "finance", "people"], write: ["any", "finance"] },
  academic:   { read: ["any", "overview", "academic", "records", "people", "catalogue"], write: ["any", "academic", "catalogue"] },
  faculty:    { read: ["any", "overview", "faculty", "people"], write: ["any", "faculty"] },
  support:    { read: ["any", "overview", "records", "support", "people"], write: ["any", "support"] },
  reporting:  { read: ["any", "overview", "admissions", "orders", "finance", "academic", "records", "faculty", "catalogue"], write: ["any"] },
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
  ["POST", "/api/app/admin/users/:id/removal-requests", "users"],

  ["GET", "/api/app/owner/status", "any"],
  ["POST", "/api/app/owner/bootstrap", "owner"], ["GET", "/api/app/owner/staff", "owner"], ["GET", "/api/app/owner/audit", "owner"],
  ["POST", "/api/app/owner/users/:id/remove", "owner"], ["GET", "/api/app/owner/removal-requests", "owner"],
  ["POST", "/api/app/owner/removal-requests/:id", "owner"],
  ["GET", "/api/app/owner/legacy-admins", "owner"], ["PUT", "/api/app/owner/policy", "owner"],

  // Programme catalogue (Stage B). Publishing, pausing and retiring are "catalogue" writes AND, in the handler, need the
  // owner or a Super Administrator the owner has delegated (catalogue policy), from a session that passed the code.
  ["GET", "/api/app/admin/catalogue", "catalogue"],
  ["POST", "/api/app/admin/catalogue/programmes", "catalogue"], ["PATCH", "/api/app/admin/catalogue/programmes/:slug", "catalogue"],
  ["PUT", "/api/app/admin/catalogue/order", "catalogue"],
  ["POST", "/api/app/admin/catalogue/programmes/:slug/publish", "catalogue"], ["POST", "/api/app/admin/catalogue/programmes/:slug/pause", "catalogue"],
  ["POST", "/api/app/admin/catalogue/programmes/:slug/retire", "catalogue"],
  ["PUT", "/api/app/owner/catalogue-policy", "owner"],
  // Stage C: lifecycle history and resume (resume follows the catalogue publisher rule in its handler), instructor
  // capacity and assignment options (the Academic group, who allocate instructors), and the owner's capacity policy.
  ["POST", "/api/app/admin/catalogue/programmes/:slug/resume", "catalogue"], ["GET", "/api/app/admin/catalogue/programmes/:slug/history", "catalogue"],
  ["GET", "/api/app/admin/capacity", "academic"], ["GET", "/api/app/admin/assignment-options", "academic"],
  ["PUT", "/api/app/owner/capacity-policy", "owner"],
];

const MAP = new Map(TABLE.map(([m, p, a]) => [`${m} ${p}`, a]));
export const permissionTable = () => TABLE.map(([method, path, area]) => ({ method, path, area }));
export const areaFor = (method: string, path: string): Area | undefined => MAP.get(`${method} ${path}`);
export const isAdminRole = (v: unknown): v is AdminRole => typeof v === "string" && (ADMIN_ROLES as readonly string[]).includes(v);

// Does this administrator hold the right for this route? Default deny. The owner may do everything; the "owner" area is
// the owner's alone; an unassigned administrator keeps today's access except the "users" and "owner" areas.
export function adminMay(role: string | null | undefined, method: string, path: string, owner = false): boolean {
  const area = areaFor(method, path);
  if (owner) return true;
  if (!area || area === "owner") return false;
  // Unassigned (existing) administrators keep their day-to-day access, including student and instructor accounts.
  // Everything that touches ADMINISTRATORS (creating one, promoting to admin, groups, suspending an administrator, MFA
  // resets, removal requests) is refused in the route handlers by canManageAdmins / groupChangeRefusal /
  // accountChangeRefusal, which need the owner, or a Super Administrator appointed after the owner's bootstrap.
  if (role === null || role === undefined) return true;
  if (!isAdminRole(role)) return false;                 // an unknown value never grants anything
  const g = GRANTS[role];
  return method === "GET" ? g.read.includes(area) : g.write.includes(area);
}

// Areas an administrator can see, for the dashboard (display only; the server still checks every request).
export function areasFor(role: string | null | undefined, owner = false): { read: Area[]; write: Area[] } {
  if (owner) return { read: [...ALL_AREAS, "owner"], write: [...ALL_AREAS, "owner"] };
  if (role === null || role === undefined) return { read: ALL_AREAS, write: ALL_AREAS };
  if (!isAdminRole(role)) return { read: [], write: [] };
  return GRANTS[role];
}

// ---- the owner ----
// Stage 2C: who the owner is is resolved once per request by resolveOwner (data/owner.ts) from OWNER_EMAIL plus the
// bootstrap record, and passed around as an OwnerRef. Nothing a user sends can change it.
type Who = { id: string; email: string; role: string; status: string; admin_role?: string | null; removed_at?: string | null };
export type OwnerRef = { ownerId: string | null };
export const ownerEmail = (env: { OWNER_EMAIL?: string }) => (env.OWNER_EMAIL || "").trim().toLowerCase();
export const isOwner = (u: { id: string } | null | undefined, o: OwnerRef): boolean => !!u && !!o.ownerId && u.id === o.ownerId;
export const isSuper = (u: Who) => u.role === "admin" && u.admin_role === "super";
// Can this person manage administrator accounts at all (create, suspend, change role, groups)? Owner, or a Super
// Administrator once the owner has completed the bootstrap.
export const canManageAdmins = (actor: Who, o: OwnerRef, bootstrapped: boolean) =>
  isOwner(actor, o) || (bootstrapped && isSuper(actor));

// Every administrator-group change goes through here. Returns a refusal message, or null when allowed.
export function groupChangeRefusal(actor: Who, target: Who, next: string, o: OwnerRef, bootstrapped: boolean): string | null {
  const owner = isOwner(actor, o);
  if (!isAdminRole(next)) return "Unknown administrator group.";
  if (!bootstrapped) return owner ? "Complete the owner set-up first (Owner console)." : "Administrator groups can be assigned once the owner has completed set-up.";
  if (!owner && !isSuper(actor)) return "Only the owner or a Super Administrator can change administrator groups.";
  if (target.role !== "admin") return "Administrator groups apply to administrators only.";
  if (target.removed_at) return "This account has been removed.";
  if (isOwner(target, o)) return "The owner's access cannot be changed.";
  if (actor.id === target.id) return "Nobody can change their own administrator group.";
  if ((next === "super" || target.admin_role === "super") && !owner) return "Only the owner can appoint or change a Super Administrator.";
  return null;
}
// May the actor suspend, reactivate, change the role of, or request removal of this account?
export function accountChangeRefusal(actor: Who, target: Who, o: OwnerRef, bootstrapped: boolean): string | null {
  if (isOwner(target, o) && actor.id !== target.id) return "The owner's account cannot be changed by anyone else.";
  if (target.removed_at) return "This account has been permanently removed.";
  if (target.role === "admin" && actor.id !== target.id) {
    if (!canManageAdmins(actor, o, bootstrapped)) return "Only the owner or a Super Administrator can change administrator accounts.";
    if (target.admin_role === "super" && !isOwner(actor, o)) return "Only the owner can change a Super Administrator.";
  }
  return null;
}

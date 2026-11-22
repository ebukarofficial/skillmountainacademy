// Profiles (everyone edits their own) and user management (admins only).
import { ADMIN_ROLES, canManageAdmins, isAdminRole } from "../permissions";
import { setAdminRole } from "../data/users";
import { ApiError, nowIso } from "../../http";
import { Checker } from "../../validate";
import { ALL, notFound, ok, page, route } from "../api";
import { canSignIn, createUser, deleteUserSessions, getUser, getUserByEmail, listAudit, listUsers, updateUser, type Role, type User } from "../data/users";
import { adminView, selfView } from "../views";
import { sendSignInLink } from "./auth";
import { newStaffNo, newStudentNo } from "../ids";

const ROLES: Role[] = ["student", "instructor", "admin"];

function readLinks(c: Checker, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const o = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of ["linkedin", "x", "facebook", "portfolio", "website", "github", "instagram"]) {
    const s = c.opt(o[k], 200);
    if (!s) continue;
    if (!/^https:\/\/[^\s<>"]+$/.test(s)) c.errors.push(`The ${k} link must start with https://`);
    out[k] = s;
  }
  return JSON.stringify(out);
}
function readList(c: Checker, v: unknown, max = 12): string | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) { c.errors.push("Please send a list."); return undefined; }
  return JSON.stringify(v.slice(0, max).map((x) => c.opt(x, 200)).filter(Boolean));
}

// Fields a user may change about themselves.
function profilePatch(c: Checker, b: Record<string, unknown>, role: Role): Partial<User> {
  const p: Partial<User> = {};
  if (b.fullName !== undefined) p.full_name = c.req(b.fullName, "Full name", 120);
  if (b.phone !== undefined) p.phone = c.phone(b.phone, "Phone", false);
  if (b.bio !== undefined) p.bio = c.opt(b.bio, 1500);
  if (role !== "student") {
    if (b.specialization !== undefined) p.specialization = c.opt(b.specialization, 200);
    const q = readList(c, b.qualifications); if (q !== undefined) p.qualifications = q;
    const l = readLinks(c, b.links); if (l !== undefined) p.links = l;
  }
  if (role === "instructor") {
    if (b.headline !== undefined) p.headline = c.opt(b.headline, 160);
    const a = readList(c, b.achievements, 10); if (a !== undefined) p.achievements = a;
    const g = readList(c, b.languages, 10); if (g !== undefined) p.languages = g;
    if (b.countryOrigin !== undefined) p.country_origin = c.opt(b.countryOrigin, 60);
    if (b.countryResidence !== undefined) p.country_residence = c.opt(b.countryResidence, 60);
    const cert = readCertificates(c, b.certifications); if (cert !== undefined) p.certifications = cert;
  }
  return p;
}

// Certificates with a public page where anyone can check them (Credly, Coursera, Microsoft Learn, a university register...).
function readCertificates(c: Checker, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) { c.errors.push("Certifications must be a list."); return undefined; }
  const out = v.slice(0, 12).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const title = c.opt(o.title, 160), issuer = c.opt(o.issuer, 120), year = c.opt(o.year, 4), url = c.opt(o.url, 300);
    if (!title && !url) return null;
    if (!title) c.errors.push("Each certification needs a title.");
    if (url && !/^https:\/\/[^\s<>"]+$/.test(url)) c.errors.push(`The verification link for "${title}" must start with https://`);
    if (year && !/^(19|20)\d\d$/.test(year)) c.errors.push(`The year for "${title}" must look like 2024.`);
    return { title, issuer, year, url };
  }).filter(Boolean);
  return JSON.stringify(out);
}

route("PATCH", "/api/me", ALL, async (c) => {
  const ch = new Checker();
  const body = await c.body();
  const patch: Partial<User> = profilePatch(ch, body, c.user.role);
  // Optional emails: class reminders and general updates. Essential emails (sign-in, payments, grades) always go.
  if (body.emailPrefs && typeof body.emailPrefs === "object") {
    const p = body.emailPrefs as Record<string, unknown>;
    patch.email_prefs = JSON.stringify({ reminders: p.reminders !== false, updates: p.updates !== false });
  }
  ch.done();
  await updateUser(c.db, c.user.id, patch);
  await c.audit("profile.update", "user", c.user.id, Object.keys(patch));
  return ok({ user: selfView((await getUser(c.db, c.user.id))!) });
});

route("GET", "/api/app/admin/users", ["admin"], async (c) => {
  const s = c.url.searchParams;
  const role = s.get("role");
  const status = s.get("status");
  const users = await listUsers(c.db, { role: role && ROLES.includes(role as Role) ? role : undefined, status: status === "active" || status === "suspended" ? status : undefined, q: s.get("q")?.slice(0, 80) || undefined, ...page(c.url) });
  return ok({ users: users.map(adminView) });
});

route("GET", "/api/app/admin/users/:id", ["admin"], async (c) => {
  const u = await getUser(c.db, c.params.id);
  if (!u) throw notFound("That user");
  return ok({ user: adminView(u) });
});

route("POST", "/api/app/admin/users", ["admin"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const email = ch.email(b.email);
  const role = ch.oneOf(b.role, ROLES, "a role");
  const fields = profilePatch(ch, { ...b, fullName: b.fullName ?? "" }, role);
  ch.done();
  if (await getUserByEmail(c.db, email)) throw new ApiError(409, "exists", "A user with this email already exists.");
  const u: User = { id: crypto.randomUUID(), email, role, status: "active", full_name: fields.full_name!, phone: fields.phone ?? null, bio: fields.bio ?? null,
    photo_key: null, student_no: role === "student" ? await newStudentNo(c.db) : null, specialization: fields.specialization ?? null, qualifications: fields.qualifications ?? null,
    links: fields.links ?? null, registration_id: null, created_at: nowIso(), last_login_at: null };
  // A new instructor starts as a candidate: they cannot sign in or teach until approved in Recruitment.
  if (role === "instructor") u.verification = "application_received";
  if (role === "admin") u.staff_no = (await newStaffNo(c.db, "admin")) ?? undefined;
  await createUser(c.db, u);
  // Stage 2 least privilege: a NEW administrator gets the group asked for, or read-only Reporting until one is assigned.
  if (role === "admin") await setAdminRole(c.db, u.id, isAdminRole(b.adminRole) ? b.adminRole : "reporting");
  await c.audit("user.create", "user", u.id, { email, role, adminRole: role === "admin" ? (isAdminRole(b.adminRole) ? b.adminRole : "reporting") : undefined });
  if (b.sendInvite !== false && canSignIn(u)) c.exec.waitUntil(sendSignInLink(c.env, c.db, u, true));
  return ok({ user: adminView((await getUser(c.db, u.id)) ?? u) }, 201);
});

route("PATCH", "/api/app/admin/users/:id", ["admin"], async (c) => {
  const u = await getUser(c.db, c.params.id);
  if (!u) throw notFound("That user");
  const b = await c.body();
  const ch = new Checker();
  const patch = profilePatch(ch, b, (b.role as Role) ?? u.role);
  if (b.role !== undefined) patch.role = ch.oneOf(b.role, ROLES, "a role");
  if (b.status !== undefined) patch.status = ch.oneOf(b.status, ["active", "suspended"] as const, "a status");
  const adminRole = b.adminRole === undefined ? undefined : ch.oneOf(b.adminRole, ADMIN_ROLES, "an administrator group");
  ch.done();
  if (u.id === c.user.id && (patch.status === "suspended" || (patch.role && patch.role !== "admin"))) throw new ApiError(400, "self", "You cannot suspend yourself or remove your own admin role.");
  // Administrator groups: only a Super Administrator (or the unassigned owner) may set them; nobody can lower their own
  // access by mistake, and the only group anyone may give themselves is Super Administrator.
  if (adminRole !== undefined) {
    if (!canManageAdmins(c.user.admin_role)) throw new ApiError(403, "forbidden", "Only a Super Administrator can change administrator groups.");
    if ((patch.role ?? u.role) !== "admin") throw new ApiError(400, "invalid", "Administrator groups apply to administrators only.");
    if (u.id === c.user.id && adminRole !== "super") throw new ApiError(400, "self", "You can only assign yourself Super Administrator. Ask another Super Administrator to change your group.");
  }
  if (patch.role === "student" && !u.student_no) patch.student_no = await newStudentNo(c.db);
  if (patch.role === "admin" && !u.staff_no) patch.staff_no = (await newStaffNo(c.db, "admin")) ?? undefined;
  // Becoming an instructor means going through verification first (unless they were approved before).
  if (patch.role === "instructor" && u.role !== "instructor" && u.verification !== "approved") patch.verification = "application_received";
  await updateUser(c.db, u.id, patch);
  const becameAdmin = patch.role === "admin" && u.role !== "admin";
  if (adminRole !== undefined || becameAdmin) await setAdminRole(c.db, u.id, adminRole ?? "reporting");
  const groupChanged = adminRole !== undefined && adminRole !== (u.admin_role ?? null);
  // Suspension, a role change or a new administrator group takes effect at once: every session of that person ends
  // (except the caller's own when they promote themselves to Super Administrator).
  if (patch.status === "suspended" || (patch.role && patch.role !== u.role) || (groupChanged && u.id !== c.user.id)) await deleteUserSessions(c.db, u.id);
  await c.audit("user.update", "user", u.id, { ...patch, ...(adminRole !== undefined ? { adminRole } : {}) });
  return ok({ user: adminView((await getUser(c.db, u.id))!) });
});

route("POST", "/api/app/admin/users/:id/invite", ["admin"], async (c) => {
  const u = await getUser(c.db, c.params.id);
  if (!u) throw notFound("That user");
  if (u.status !== "active") throw new ApiError(400, "suspended", "This account is suspended.");
  if (!canSignIn(u)) throw new ApiError(400, "not_approved", "This instructor has not been approved yet. Approve them in Recruitment first.");
  const sent = await sendSignInLink(c.env, c.db, u, true);
  await c.audit("user.invite", "user", u.id);
  return ok({ sent });
});

route("GET", "/api/app/admin/audit", ["admin"], async (c) => ok({ entries: await listAudit(c.db, page(c.url, 200).limit, page(c.url, 200).offset) }));

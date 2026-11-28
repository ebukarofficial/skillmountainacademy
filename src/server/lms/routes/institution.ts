// Institution (Expansion Stage E): departments, department heads, staff invitations, approvals and the owner's policies.
//   GET  /api/app/admin/institution                      overview for the owner and Super Administrators
//   POST /api/app/admin/departments                      {slug, name, purpose}                 owner (or super by policy)
//   PATCH /api/app/admin/departments/:slug               {name, purpose, status}               owner (or super by policy)
//   POST /api/app/admin/departments/:slug/members        {userId, position, reason}            owner (or super by policy)
//   POST /api/app/admin/assignments/:id/end              {reason}                              owner (or super by policy)
//   GET  /api/app/admin/department                       a member's own department (heads also see its roster)
//   GET  /api/app/admin/users/:id/access-history         access changes for one person          owner, super
//   GET/POST /api/app/admin/invitations, POST .../:id/revoke                                     owner, super
//   POST /api/auth/invitations/preview|accept|decline    {token}                               the invited person
//   GET/POST /api/app/admin/approvals, GET .../:id, POST .../:id/decision|cancel|escalate
//   PUT  /api/app/owner/institution-policy, PUT /api/app/owner/approval-policy                   the owner only
// Departments grant NO permissions: rights still come only from administrator groups (permissions.ts). Every write
// needs a session that passed the authenticator code. Nothing is seeded; the owner creates the structure.
import { ApiError, nowIso, sha256 } from "../../http";
import { Checker } from "../../validate";
import { Repo } from "../../repo";
import { notFound, ok, parseJsonCol, publicRoute, requireStrongAuth, route, type Ctx } from "../api";
import { ADMIN_ROLES, GRANTS, accountChangeRefusal, adminMay, canManageAdmins, groupChangeRefusal, isAdminRole, isSuper, ownerEmail, permissionTable, type AdminRole } from "../permissions";
import { audit, canSignIn, getUser, getUserByEmail, logError } from "../data/users";
import { isBootstrapped } from "../data/owner";
import { newStaffNo } from "../ids";
import {
  accessHistory, activeAssignments, assignmentHistory, createAssignment, createDepartment, currentHead, decideApproval, departmentRoster, endAssignment, escalateApproval, getApproval,
  getAssignment, getDepartment, getInvitation, historyFor, invitationByHash, listApprovals, listDepartments, listInvitations, moveInvitation, acceptInvitationAtomic, approveRequest,
  updateDepartment, userAssignments, createInvitation, type ApprovalRequest, type Invitation,
} from "../data/institution";
import {
  DEFAULT_APPROVALS, EVALUATED_ONLY, EXECUTABLE, appointHead, assertAssignable, assertOneDepartment, executeApproved, EXECUTION_STALE_MS, getApprovalPolicy, getInstitutionPolicy, mayDecide,
  openApproval, ruleFor, saveApprovalPolicy, saveInstitutionPolicy, type ApprovalPolicy, type Category, type CategoryRule, type InstitutionPolicy, type PaymentReleaseRule,
} from "../institution";
import { sendStaffInvitation, startSession } from "./auth";

const INVITE_HOURS = 24;
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const b64u = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const inviteHash = (token: string) => sha256(`i|${token}`);

// ---------- who may manage what ----------
const managerOrRefuse = (c: Ctx) => { if (!c.isOwner && !isSuper(c.user)) throw new ApiError(403, "forbidden", "Only the owner or a Super Administrator can see the institution's structure."); };
async function authority(c: Ctx, what: "departments" | "staff" | "heads") {
  if (c.isOwner) return;
  const p = await getInstitutionPolicy(c.db);
  const allowed = isSuper(c.user) && (what === "departments" ? p.superMayManageDepartments : what === "staff" ? p.superMayAssignStaff : p.superMayAppointHeads);
  if (!allowed) {
    await c.audit("institution.refused", "user", c.user.id, { what });
    throw new ApiError(403, "forbidden", what === "heads" ? "Appointing a department head is for the owner (or a Super Administrator the owner has authorised)." :
      what === "staff" ? "Assigning staff to departments is for the owner (or a Super Administrator the owner has authorised)." :
      "Managing departments is for the owner (or a Super Administrator the owner has authorised).");
  }
}
const reasonOf = (b: Record<string, unknown>, ch = new Checker()) => { const r = ch.req(b.reason, "Reason", 500); ch.done(); return r; };

const inviteView = (i: Invitation) => ({ id: i.id, email: i.email, fullName: i.full_name, role: i.role, adminRole: i.admin_role, departmentSlug: i.department_slug, position: i.position,
  status: i.status, expiresAt: i.expires_at, createdAt: i.created_at, createdBy: i.created_by, decidedAt: i.decided_at, decidedBy: i.decided_by, revokeReason: i.revoke_reason });
const approvalView = (r: ApprovalRequest) => ({ ...r, payload: parseJsonCol<Record<string, unknown>>(r.payload, {}) });
const GROUP_NAMES: Record<string, string> = { super: "Super Administrator", admissions: "Admissions", finance: "Finance", academic: "Academic Administration", faculty: "Faculty Management", support: "Student Support", reporting: "Read-only Reporting" };
const roleLabel = (i: Pick<Invitation, "role" | "admin_role">) => i.role === "instructor" ? "Instructor (faculty)" : `Administrator (${GROUP_NAMES[i.admin_role ?? "reporting"] ?? "Read-only Reporting"})`;

// Expiry is applied lazily (on read and on use) and audited once, by compare-and-set.
async function expireIfDue(db: D1Database, i: Invitation): Promise<Invitation> {
  if (i.status !== "pending" || Date.parse(i.expires_at) > Date.now()) return i;
  if (await moveInvitation(db, i.id, "expired", {}, nowIso())) await audit(db, { actor_id: null, action: "invite.expired", target_type: "staff_invitation", target_id: i.id, detail: { email: i.email } });
  return { ...i, status: "expired" };
}
async function expireApprovalIfDue(c: Ctx, r: ApprovalRequest): Promise<ApprovalRequest> {
  if (r.status !== "pending" || Date.parse(r.expires_at) > Date.now()) return r;
  const res = (await decideApproval(c.db, r.id, "expired", null, null, nowIso()));
  if (res) await c.audit("approval.expired", "approval_request", r.id, { category: r.category, target: r.target_id });
  return { ...r, status: "expired" };
}

// ---------- overview ----------
route("GET", "/api/app/admin/institution", ["admin"], async (c) => {
  managerOrRefuse(c);
  const [departments, assignments, invitations, approvals] = await Promise.all([listDepartments(c.db), activeAssignments(c.db), listInvitations(c.db), listApprovals(c.db)]);
  return ok({
    departments: departments.map((d) => ({ ...d, head: assignments.find((a) => a.department_slug === d.slug && a.position === "head") ?? null, members: assignments.filter((a) => a.department_slug === d.slug).length })),
    assignments: assignments.map((a) => ({ id: a.id, userId: a.user_id, fullName: a.full_name, role: a.role, adminRole: a.admin_role, status: a.user_status, removed: !!a.removed_at, department: a.department_slug, position: a.position, since: a.created_at, reason: a.reason })),
    invitations: await Promise.all(invitations.map(async (i) => inviteView(await expireIfDue(c.db, i)))),
    approvals: { pending: approvals.filter((a) => a.status === "pending").length },
    policies: { institution: await getInstitutionPolicy(c.db), approvals: await getApprovalPolicy(c.db) },
    categories: { executable: EXECUTABLE, evaluatedOnly: EVALUATED_ONLY },
    roles: { groups: ADMIN_ROLES, grants: GRANTS, routes: permissionTable() },
    you: { owner: c.isOwner, super: isSuper(c.user) },
  });
});

// ---------- departments ----------
route("POST", "/api/app/admin/departments", ["admin"], async (c) => {
  await authority(c, "departments");
  await requireStrongAuth(c, "department.create");
  const b = await c.body();
  const ch = new Checker();
  const slug = String(b.slug ?? "").trim().toLowerCase();
  if (!SLUG.test(slug)) ch.errors.push("The short name must be 2 to 40 lowercase letters, numbers or hyphens, starting with a letter.");
  const name = ch.req(b.name, "Name", 80);
  const purpose = ch.opt(b.purpose, 500);
  ch.done();
  if (await getDepartment(c.db, slug)) throw new ApiError(409, "exists", "A department with this short name already exists.");
  const at = nowIso();
  await createDepartment(c.db, { slug, name, purpose, status: "active", created_at: at, created_by: c.user.id, updated_at: at, updated_by: c.user.id });
  await c.audit("department.created", "department", slug, { name, purpose });
  return ok({ department: await getDepartment(c.db, slug) }, 201);
});

route("PATCH", "/api/app/admin/departments/:slug", ["admin"], async (c) => {
  await authority(c, "departments");
  await requireStrongAuth(c, "department.update", c.params.slug);
  const d = await getDepartment(c.db, c.params.slug);
  if (!d) throw notFound("That department");
  const b = await c.body();
  const ch = new Checker();
  const name = b.name === undefined ? d.name : ch.req(b.name, "Name", 80);
  const purpose = b.purpose === undefined ? d.purpose : ch.opt(b.purpose, 500);
  const status = b.status === undefined ? d.status : ch.oneOf(b.status, ["active", "archived"] as const, "a status");
  const reason = ch.req(b.reason, "Reason", 500);
  ch.done();
  if (status === "archived" && d.status !== "archived" && (await departmentRoster(c.db, d.slug)).length)
    throw new ApiError(409, "has_members", "End every membership in this department before archiving it. Their records are kept.");
  await updateDepartment(c.db, d.slug, { name, purpose, status }, c.user.id, nowIso());
  await c.audit("department.updated", "department", d.slug, { from: { name: d.name, purpose: d.purpose, status: d.status }, to: { name, purpose, status }, reason });
  return ok({ department: await getDepartment(c.db, d.slug) });
});

route("POST", "/api/app/admin/departments/:slug/members", ["admin"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const userId = ch.req(b.userId, "Staff member", 60);
  const position = ch.oneOf(b.position, ["head", "staff"] as const, "a position");
  const reason = ch.req(b.reason, "Reason", 500);
  ch.done();
  if (position === "head" && !c.isOwner && !(await getInstitutionPolicy(c.db)).superMayAppointHeads && isSuper(c.user) && (await ruleFor(c.db, "department_head_appointment")))
    throw new ApiError(409, "approval_required", "Appointing a head needs approval. Submit an approval request instead.");
  await authority(c, position === "head" ? "heads" : "staff");
  if (userId === c.user.id) throw new ApiError(403, "self", "Nobody can assign themselves to a department or appoint themselves head.");
  await requireStrongAuth(c, "department.member_add", userId);
  const d = await getDepartment(c.db, c.params.slug);
  if (!d || d.status !== "active") throw notFound("That active department");
  if (position === "head") return ok({ assignment: await getAssignment(c.db, await appointHead(c, d.slug, userId, reason)) }, 201);
  await assertAssignable(c, userId);
  await assertOneDepartment(c, userId, d.slug);
  const id = crypto.randomUUID();
  await createAssignment(c.db, { id, user_id: userId, department_slug: d.slug, position: "staff", reason, created_at: nowIso(), created_by: c.user.id });
  await c.audit("staff.assigned", "user", userId, { department: d.slug, assignment: id, reason });
  return ok({ assignment: await getAssignment(c.db, id) }, 201);
});

route("POST", "/api/app/admin/assignments/:id/end", ["admin"], async (c) => {
  const a = await getAssignment(c.db, c.params.id);
  if (!a) throw notFound("That assignment");
  if (a.ended_at) throw new ApiError(409, "ended", "This assignment has already ended.");
  await authority(c, a.position === "head" ? "heads" : "staff");
  if (a.user_id === c.user.id) throw new ApiError(403, "self", "Nobody can change their own department assignment.");
  await requireStrongAuth(c, "department.member_end", a.user_id);
  const reason = reasonOf(await c.body());
  await endAssignment(c.db, a.id, c.user.id, reason, nowIso());
  await c.audit(a.position === "head" ? "staff.head_ended" : "staff.unassigned", "user", a.user_id, { department: a.department_slug, assignment: a.id, reason });
  return ok({ assignment: await getAssignment(c.db, a.id) });
});

// A member sees their own department; a head also sees its roster (names, positions, groups and status only: no email,
// no student, finance or personal data). Nobody sees another department through this route.
route("GET", "/api/app/admin/department", ["admin"], async (c) => {
  const mine = await userAssignments(c.db, c.user.id);
  if (!mine.length) return ok({ departments: [] });
  const out = [];
  for (const a of mine) {
    const d = await getDepartment(c.db, a.department_slug);
    const roster = a.position === "head" ? (await departmentRoster(c.db, a.department_slug)).map((r) => ({ fullName: r.full_name, position: r.position, role: r.role, adminRole: r.admin_role, status: r.user_status, since: r.created_at })) : undefined;
    out.push({ slug: a.department_slug, name: d?.name ?? a.department_slug, purpose: d?.purpose ?? null, position: a.position, since: a.created_at, roster });
  }
  return ok({ departments: out });
});

route("GET", "/api/app/admin/users/:id/access-history", ["admin"], async (c) => {
  managerOrRefuse(c);
  const u = await getUser(c.db, c.params.id);
  if (!u) throw notFound("That user");
  const assignments = await assignmentHistory(c.db, u.id);
  return ok({ user: { id: u.id, fullName: u.full_name, role: u.role, adminRole: u.admin_role ?? null, status: u.status, removedAt: u.removed_at ?? null },
    assignments, history: (await accessHistory(c.db, u.id)).map((h) => ({ ...h, detail: parseJsonCol(h.detail, null) })) });
});

// ---------- invitations (one person at a time; no bulk sending) ----------
route("GET", "/api/app/admin/invitations", ["admin"], async (c) => {
  if (!canManageAdmins(c.user, c.owner, await isBootstrapped(c.db))) throw new ApiError(403, "forbidden", "Only the owner or a Super Administrator can see staff invitations.");
  return ok({ invitations: await Promise.all((await listInvitations(c.db)).map(async (i) => inviteView(await expireIfDue(c.db, i)))) });
});

route("POST", "/api/app/admin/invitations", ["admin"], async (c) => {
  const booted = await isBootstrapped(c.db);
  if (!canManageAdmins(c.user, c.owner, booted)) throw new ApiError(403, "forbidden", "Only the owner or a Super Administrator can invite staff.");
  const b = await c.body();
  const ch = new Checker();
  const email = ch.email(b.email);
  const fullName = ch.req(b.fullName, "Full name", 120);
  const role = ch.oneOf(b.role, ["admin", "instructor"] as const, "a staff role");
  const adminRole = role === "admin" ? ch.oneOf(b.adminRole, ADMIN_ROLES, "an administrator group") : null;
  const departmentSlug = b.departmentSlug ? String(b.departmentSlug) : null;
  const position = departmentSlug ? ch.oneOf(b.position ?? "staff", ["head", "staff"] as const, "a position") : null;
  ch.done();
  if (adminRole === "super" && !c.isOwner) throw new ApiError(403, "forbidden", "Only the owner can invite a Super Administrator.");
  if (departmentSlug) {
    await authority(c, position === "head" ? "heads" : "staff");
    const d = await getDepartment(c.db, departmentSlug);
    if (!d || d.status !== "active") throw notFound("That active department");
    if (position === "head" && (await currentHead(c.db, d.slug))) throw new ApiError(409, "head_exists", "That department already has a head. End the current headship first.");
  }
  await requireStrongAuth(c, "invite.create");
  if (ownerEmail(c.env) && email === ownerEmail(c.env)) throw new ApiError(400, "reserved", "This email address is reserved for the platform owner.");
  if (await getUserByEmail(c.db, email)) throw new ApiError(409, "exists", "A user with this email already exists. Change their access from Users instead.");
  const token = b64u(32);
  const at = nowIso();
  const i: Invitation = { id: crypto.randomUUID(), email, full_name: fullName, role, admin_role: adminRole, department_slug: departmentSlug, position, token_hash: await inviteHash(token),
    status: "pending", expires_at: new Date(Date.now() + INVITE_HOURS * 3600_000).toISOString(), created_at: at, created_by: c.user.id, decided_at: null, decided_by: null, revoke_reason: null, accepted_user_id: null };
  try { await createInvitation(c.db, i); }
  catch (e) { if (/UNIQUE/i.test(String(e))) throw new ApiError(409, "pending_exists", "There is already a pending invitation for this email. Revoke it first."); throw e; }
  await c.audit("invite.created", "staff_invitation", i.id, { email, role, adminRole, department: departmentSlug, position, expiresAt: i.expires_at });
  // One email to this one person. The token goes only into that email; it is never stored, logged or returned.
  c.exec.waitUntil(sendStaffInvitation(c.env, { email, fullName }, token, roleLabel(i), i.expires_at).catch(() => false));
  return ok({ invitation: inviteView(i) }, 201);
});

route("POST", "/api/app/admin/invitations/:id/revoke", ["admin"], async (c) => {
  if (!canManageAdmins(c.user, c.owner, await isBootstrapped(c.db))) throw new ApiError(403, "forbidden", "Only the owner or a Super Administrator can revoke staff invitations.");
  const i = await getInvitation(c.db, c.params.id);
  if (!i) throw notFound("That invitation");
  if (i.admin_role === "super" && !c.isOwner) throw new ApiError(403, "forbidden", "Only the owner can revoke a Super Administrator invitation.");
  await requireStrongAuth(c, "invite.revoke", i.id);
  const reason = reasonOf(await c.body());
  const res = (await moveInvitation(c.db, i.id, "revoked", { by: c.user.id, reason }, nowIso()));
  if (!res) throw new ApiError(409, "not_pending", `This invitation is ${(await getInvitation(c.db, i.id))?.status}; only a pending invitation can be revoked.`);
  await c.audit("invite.revoked", "staff_invitation", i.id, { email: i.email, reason });
  return ok({ invitation: inviteView((await getInvitation(c.db, i.id))!) });
});

// Public side: the invited person opens /app/invite/?t=… . A wrong, used, revoked or expired token gets the same answer.
const INVALID = () => new ApiError(400, "invalid_invitation", "This invitation link is not valid, has expired or was already used. Ask the Academy for a new invitation.");
async function pendingByToken(c: { db: D1Database; ipHash: string }, raw: unknown) {
  await new Repo(c.db).limitOrThrow(`invite:${c.ipHash}`, 20, 600);
  const token = String(raw ?? "");
  if (!/^[\w-]{30,64}$/.test(token)) throw INVALID();
  const found = await invitationByHash(c.db, await inviteHash(token));
  if (!found) throw INVALID();
  const i = await expireIfDue(c.db, found);
  if (i.status !== "pending") throw INVALID();
  return i;
}
const maskEmail = (e: string) => e.replace(/^(.).*?(@.*)$/, (_, a, d) => `${a}•••${d}`);

publicRoute("POST", "/api/auth/invitations/preview", async (c) => {
  const i = await pendingByToken(c, (await c.body<{ token?: string }>()).token);
  const d = i.department_slug ? await getDepartment(c.db, i.department_slug) : null;
  return ok({ invitation: { fullName: i.full_name, email: maskEmail(i.email), role: roleLabel(i), department: d?.name ?? null, position: i.position, expiresAt: i.expires_at } });
});

publicRoute("POST", "/api/auth/invitations/decline", async (c) => {
  const i = await pendingByToken(c, (await c.body<{ token?: string }>()).token);
  const res = (await moveInvitation(c.db, i.id, "declined", {}, nowIso()));
  if (!res) throw INVALID();
  await audit(c.db, { actor_id: null, action: "invite.declined", target_type: "staff_invitation", target_id: i.id, detail: { email: i.email }, ip_hash: c.ipHash });
  return ok({ declined: true });
});

publicRoute("POST", "/api/auth/invitations/accept", async (c) => {
  const raw = (await c.body<{ token?: string }>()).token;
  // A repeated acceptance (a double click, a retry after a lost response) never creates a second account and never
  // starts another session: the person is told the account exists and to sign in through the usual entrance.
  const prior = /^[\w-]{30,64}$/.test(String(raw ?? "")) ? await invitationByHash(c.db, await inviteHash(String(raw))) : null;
  if (prior?.status === "accepted" && prior.accepted_user_id && (await getUser(c.db, prior.accepted_user_id))) {
    await new Repo(c.db).limitOrThrow(`invite:${c.ipHash}`, 20, 600);
    return ok({ accepted: true, signedIn: false, alreadyAccepted: true, message: "This invitation was already accepted. Sign in from your staff entrance with the invited email address." });
  }
  const i = await pendingByToken(c, raw);
  if (await getUserByEmail(c.db, i.email)) throw new ApiError(409, "exists", "An account with this email already exists. Sign in instead, or ask the Academy.");
  const dept = i.department_slug ? await getDepartment(c.db, i.department_slug) : null;
  if (i.department_slug && (!dept || dept.status !== "active")) throw new ApiError(409, "department_unavailable", "The department in this invitation is no longer active. Ask the Academy for a new invitation.");
  if (i.position === "head" && i.department_slug && (await currentHead(c.db, i.department_slug))) throw new ApiError(409, "head_exists", "That department now has a head. Ask the Academy for a new invitation.");
  const userId = crypto.randomUUID();
  const at = nowIso();
  // Exactly what was invited: the role, group and department recorded on the invitation. Nothing the browser sends.
  const detail = { role: i.role, adminRole: i.admin_role, department: i.department_slug, position: i.position };
  let accepted: boolean;
  try {
    accepted = await acceptInvitationAtomic(c.db, { invitationId: i.id, userId, at, email: i.email, fullName: i.full_name, role: i.role,
      adminRole: i.role === "admin" ? (i.admin_role && isAdminRole(i.admin_role) ? i.admin_role : "reporting") : null,
      staffNo: await newStaffNo(c.db, i.role), verification: i.role === "instructor" ? "application_received" : null,
      departmentSlug: i.department_slug && i.position ? i.department_slug : null, position: i.department_slug ? i.position : null, createdBy: i.created_by, assignmentId: crypto.randomUUID(),
      auditAccepted: JSON.stringify({ email: i.email, ...detail }), auditJoined: JSON.stringify({ invitation: i.id, ...detail }), ipHash: c.ipHash });
  } catch (e) {
    // Rolled back as a whole: the invitation is still pending and can be accepted again once the problem is fixed.
    await logError(c.db, "/api/auth/invitations/accept", `Invitation ${i.id} not accepted (rolled back): ${String((e as Error)?.message ?? e).slice(0, 300)}`).catch(() => undefined);
    if (/UNIQUE/i.test(String(e))) throw new ApiError(409, "exists", "An account with this email already exists. Sign in instead, or ask the Academy.");
    throw new ApiError(503, "try_again", "We could not complete this just now. Your invitation is still valid: please try again in a few minutes.");
  }
  // Another request accepted it first, or it expired in the meantime: nothing was written by this one.
  if (!accepted) throw INVALID();
  const user = (await getUser(c.db, userId))!;
  if (!canSignIn(user)) return ok({ accepted: true, signedIn: false });
  // The account is complete and valid from here on. If the session cannot be started, the person signs in through
  // the usual email link instead; nothing needs repairing.
  try {
    const { cookie, mfa } = await startSession(c, user, "auth.login.invitation");
    return ok({ accepted: true, signedIn: true, role: user.role, mfaRequired: mfa }, 200, { "set-cookie": cookie });
  } catch (e) {
    await audit(c.db, { actor_id: userId, action: "invite.session_failed", target_type: "user", target_id: userId, detail: { invitation: i.id, error: String((e as Error)?.message ?? e).slice(0, 200) } }).catch(() => undefined);
    return ok({ accepted: true, signedIn: false, message: "Your account is ready. Sign in from your staff entrance with the invited email address." });
  }
});

// ---------- approvals ----------
const visible = (c: Ctx, r: ApprovalRequest) => c.isOwner || isSuper(c.user) || r.requested_by === c.user.id;

route("GET", "/api/app/admin/approvals", ["admin"], async (c) => {
  const rows = [];
  const names = new Map<string, string>();
  const name = async (id: string | null) => { if (!id) return null; if (!names.has(id)) names.set(id, (await getUser(c.db, id))?.full_name ?? "Unknown"); return names.get(id)!; };
  for (const r0 of await listApprovals(c.db)) {
    if (!visible(c, r0)) continue;
    const r = await expireApprovalIfDue(c, r0);
    const recoverable = r.status === "approved" && (r.execution_status === "failed" || r.execution_status === "awaiting_execution"
      || (r.execution_status === "executing" && Date.now() - Date.parse(r.execution_claimed_at ?? r.updated_at) > EXECUTION_STALE_MS));
    rows.push({ ...approvalView(r), requesterName: await name(r.requested_by), deciderName: await name(r.decided_by), canDecide: r.status === "pending" && !mayDecide(c, r),
      canRecover: recoverable && !mayDecide(c, r) });
  }
  return ok({ approvals: rows });
});

route("GET", "/api/app/admin/approvals/:id", ["admin"], async (c) => {
  const r = await getApproval(c.db, c.params.id);
  if (!r || !visible(c, r)) throw notFound("That request");
  return ok({ approval: approvalView(await expireApprovalIfDue(c, r)), history: (await historyFor(c.db, r.id)).map((h) => ({ ...h, detail: parseJsonCol(h.detail, null) })) });
});

route("POST", "/api/app/admin/approvals", ["admin"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const category = String(b.category ?? "");
  const targetId = ch.req(b.targetId, "Target", 80);
  const reason = ch.req(b.reason, "Reason", 500);
  ch.done();
  if ((EVALUATED_ONLY as readonly string[]).includes(category)) throw new ApiError(400, "category_not_available", "This approval category has no approved policy or executor yet.");
  if (!(EXECUTABLE as readonly string[]).includes(category) || category === "payment_attempt_release") throw new ApiError(400, "invalid", "Unknown approval category. Payment releases are requested from the payment attempt itself.");
  const cat = category as Category;
  const rule = await ruleFor(c.db, cat);
  if (!rule) throw new ApiError(409, "approval_not_configured", "The owner has not switched on approvals for this kind of change.");
  if (c.isOwner) throw new ApiError(400, "owner_acts_directly", "The owner makes this change directly; no approval request is needed.");
  const payload = (b.payload && typeof b.payload === "object" ? b.payload : {}) as Record<string, unknown>;
  const booted = await isBootstrapped(c.db);
  // The requester must hold the authority to ask for this change; the approver's authority is checked again at execution.
  const targetType = "user";
  let clean: Record<string, unknown> = {};
  if (cat === "staff_group_change") {
    const t = await getUser(c.db, targetId);
    if (!t) throw notFound("That staff member");
    const next = String(payload.adminRole ?? "");
    const why = groupChangeRefusal(c.user, t, next, c.owner, booted);
    if (why) { await c.audit("admin.group_refused", "user", t.id, { why, to: next, via: "approval" }); throw new ApiError(403, "forbidden", why); }
    if ((t.admin_role ?? null) === next) throw new ApiError(400, "no_change", "That is already this person's group.");
    clean = { adminRole: next, from: t.admin_role ?? null };
  } else if (cat === "staff_reinstatement") {
    const t = await getUser(c.db, targetId);
    if (!t || !["admin", "instructor"].includes(t.role)) throw notFound("That staff member");
    if (t.status !== "suspended") throw new ApiError(409, "not_suspended", "This account is not suspended.");
    if (t.id === c.user.id) throw new ApiError(403, "self", "Nobody can ask for their own reinstatement.");
    if (!adminMay(c.effectiveAdminRole, "PATCH", "/api/app/admin/users/:id", c.isOwner)) throw new ApiError(403, "forbidden", "Your group cannot change accounts.");
    const why = accountChangeRefusal(c.user, t, c.owner, booted);
    if (why) throw new ApiError(403, "forbidden", why);
  } else if (cat === "department_head_appointment") {
    if (!isSuper(c.user)) throw new ApiError(403, "forbidden", "Only a Super Administrator can ask for a head appointment.");
    if (targetId === c.user.id) throw new ApiError(403, "self", "Nobody can ask to appoint themselves head.");
    const d = await getDepartment(c.db, String(payload.departmentSlug ?? ""));
    if (!d || d.status !== "active") throw notFound("That active department");
    await assertAssignable(c, targetId);
    clean = { departmentSlug: d.slug };
  }
  await requireStrongAuth(c, "approval.request", targetId);
  const request = await openApproval(c, { category: cat, targetType, targetId, payload: clean, reason, rule });
  return ok({ request: approvalView(request) }, 201);
});

route("POST", "/api/app/admin/approvals/:id/decision", ["admin"], async (c) => {
  const r0 = await getApproval(c.db, c.params.id);
  if (!r0 || !visible(c, r0)) throw notFound("That request");
  const r = await expireApprovalIfDue(c, r0);
  if (r.status !== "pending") throw new ApiError(409, r.status === "expired" ? "expired" : "decided", `This request is ${r.status}.`);
  const why = mayDecide(c, r);
  if (why) { await c.audit("approval.decision_refused", "approval_request", r.id, { why }); throw new ApiError(403, "forbidden", why); }
  const b = await c.body();
  const ch = new Checker();
  const decision = ch.oneOf(b.decision, ["approve", "reject"] as const, "approve or reject");
  const comment = decision === "reject" ? ch.req(b.comment, "Comment", 1000) : ch.opt(b.comment, 1000);
  ch.done();
  await requireStrongAuth(c, "approval.decide", r.id);
  if (decision === "approve" && !(await ruleFor(c.db, r.category as Category)))
    throw new ApiError(409, "policy_withdrawn", "The owner has switched this approval off since the request was made. Cancel the request.");
  const at = nowIso();
  const res = decision === "approve" ? await approveRequest(c.db, r.id, c.user.id, comment, at) : await decideApproval(c.db, r.id, "rejected", c.user.id, comment, at);
  if (!res) throw new ApiError(409, "changed", "This request changed in the meantime. Reload it.");
  await c.audit(decision === "approve" ? "approval.approved" : "approval.rejected", "approval_request", r.id, { category: r.category, target: r.target_id, comment });
  if (decision === "reject") return ok({ approval: approvalView((await getApproval(c.db, r.id))!) });
  // The decision is recorded; the action runs now, as its own step with its own status.
  const outcome = await executeApproved(c, r.id, false);
  return ok({ approval: approvalView((await getApproval(c.db, r.id))!), executed: outcome.executed, execution: outcome, ...(outcome.error ? { error: outcome.error } : {}) });
});

// Recovery of an approved request whose action failed, or whose run was interrupted. An explicit request by an
// eligible approver (never automatic), re-checking approver eligibility, the owner's policy and the target's state.
route("POST", "/api/app/admin/approvals/:id/execute", ["admin"], async (c) => {
  const r = await getApproval(c.db, c.params.id);
  if (!r || !visible(c, r)) throw notFound("That request");
  if (r.status !== "approved") throw new ApiError(409, "not_approved", `This request is ${r.status}; only an approved request can be carried out.`);
  if (r.execution_status === "completed") throw new ApiError(409, "already_completed", "This request has already been carried out.");
  const why = mayDecide(c, r);
  if (why) { await c.audit("approval.recovery_refused", "approval_request", r.id, { why }); throw new ApiError(403, "forbidden", why); }
  await requireStrongAuth(c, "approval.execute", r.id);
  if (!(await ruleFor(c.db, r.category as Category))) throw new ApiError(409, "policy_withdrawn", "The owner has switched this approval off since it was approved. It cannot be carried out; record the outcome and close it.");
  await c.audit("approval.recovery_requested", "approval_request", r.id, { previous: r.execution_status, attempts: r.execution_attempts });
  const outcome = await executeApproved(c, r.id, true);
  return ok({ approval: approvalView((await getApproval(c.db, r.id))!), executed: outcome.executed, execution: outcome, ...(outcome.error ? { error: outcome.error } : {}) });
});

route("POST", "/api/app/admin/approvals/:id/cancel", ["admin"], async (c) => {
  const r = await getApproval(c.db, c.params.id);
  if (!r || !visible(c, r)) throw notFound("That request");
  if (r.requested_by !== c.user.id && !c.isOwner) throw new ApiError(403, "forbidden", "Only the person who asked, or the owner, can cancel a request.");
  const reason = reasonOf(await c.body());
  const res = (await decideApproval(c.db, r.id, "cancelled", c.user.id, reason, nowIso()));
  if (!res) throw new ApiError(409, "decided", `This request is ${r.status}.`);
  await c.audit("approval.cancelled", "approval_request", r.id, { category: r.category, target: r.target_id, reason });
  return ok({ approval: approvalView((await getApproval(c.db, r.id))!) });
});

route("POST", "/api/app/admin/approvals/:id/escalate", ["admin"], async (c) => {
  const r = await getApproval(c.db, c.params.id);
  if (!r || !visible(c, r)) throw notFound("That request");
  if (r.requested_by !== c.user.id && !isSuper(c.user) && !c.isOwner) throw new ApiError(403, "forbidden", "Only the person who asked or a Super Administrator can escalate a request.");
  const reason = reasonOf(await c.body());
  const res = (await escalateApproval(c.db, r.id, nowIso()));
  if (!res) throw new ApiError(409, "not_escalatable", "Only a pending request waiting for a Super Administrator can be escalated to the owner.");
  await c.audit("approval.escalated", "approval_request", r.id, { from: "super", to: "owner", reason });
  return ok({ approval: approvalView((await getApproval(c.db, r.id))!) });
});

// ---------- owner policies ----------
route("PUT", "/api/app/owner/institution-policy", ["admin"], async (c) => {
  await requireStrongAuth(c, "owner.institution_policy");
  const b = await c.body();
  const keys: (keyof InstitutionPolicy)[] = ["superMayManageDepartments", "superMayAssignStaff", "superMayAppointHeads", "multipleDepartments"];
  for (const k of keys) if (typeof b[k] !== "boolean") throw new ApiError(400, "invalid", `${k} must be true or false.`);
  const next = Object.fromEntries(keys.map((k) => [k, b[k]])) as InstitutionPolicy;
  const before = await getInstitutionPolicy(c.db);
  await saveInstitutionPolicy(c.db, next, c.user.id);
  await c.audit("owner.institution_policy", "settings", "institution_policy", { from: before, to: next });
  return ok({ policy: next });
});

function readRule(v: unknown, label: string): CategoryRule {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.enabled !== "boolean") throw new ApiError(400, "invalid", `${label}: enabled must be true or false.`);
  if (o.approver !== "owner" && o.approver !== "super") throw new ApiError(400, "invalid", `${label}: approver must be owner or super.`);
  const h = Number(o.expiresInHours);
  if (!Number.isInteger(h) || h < 1 || h > 720) throw new ApiError(400, "invalid", `${label}: expiresInHours must be a whole number from 1 to 720.`);
  return { enabled: o.enabled, approver: o.approver, expiresInHours: h };
}
route("PUT", "/api/app/owner/approval-policy", ["admin"], async (c) => {
  await requireStrongAuth(c, "owner.approval_policy");
  const b = await c.body<{ categories?: Record<string, unknown>; paymentRelease?: unknown }>();
  const next: ApprovalPolicy = { ...DEFAULT_APPROVALS, categories: {} };
  for (const [k, v] of Object.entries(b.categories ?? {})) {
    if ((EVALUATED_ONLY as readonly string[]).includes(k)) throw new ApiError(400, "category_not_available", `${k} has no executor yet and cannot be switched on.`);
    if (!(EXECUTABLE as readonly string[]).includes(k) || k === "payment_attempt_release") throw new ApiError(400, "invalid", `Unknown approval category ${k}.`);
    next.categories[k as Exclude<Category, "payment_attempt_release">] = readRule(v, k);
  }
  if (b.paymentRelease !== undefined && b.paymentRelease !== null) {
    const o = b.paymentRelease as Record<string, unknown>;
    const base = readRule(o, "paymentRelease");
    if (!Array.isArray(o.allowedGroups) || o.allowedGroups.some((g) => !isAdminRole(g))) throw new ApiError(400, "invalid", "paymentRelease: allowedGroups must list administrator groups.");
    if (typeof o.requiresApproval !== "boolean") throw new ApiError(400, "invalid", "paymentRelease: requiresApproval must be true or false.");
    next.paymentRelease = { ...base, allowedGroups: [...new Set(o.allowedGroups as AdminRole[])], requiresApproval: o.requiresApproval } satisfies PaymentReleaseRule;
  }
  const before = await getApprovalPolicy(c.db);
  await saveApprovalPolicy(c.db, next, c.user.id);
  await c.audit("owner.approval_policy", "settings", "approval_policy", { from: before, to: next });
  return ok({ policy: next });
});


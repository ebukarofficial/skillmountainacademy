// The owner console (Stage 2B, hardened in Stage 2C). Who the owner is is resolved on the server (data/owner.ts
// resolveOwner): the account recorded at bootstrap whose email still equals OWNER_EMAIL. Every route here except /status
// is in the "owner" permission area: the owner alone, and only from a session that passed the authenticator code (api.ts).
//
//   GET  /api/app/owner/status                       any administrator: owner state, set-up, and (owner) review counts
//   POST /api/app/owner/bootstrap                    owner, once (atomic): fixes the owner's account; owner becomes Super
//   GET  /api/app/owner/staff                        owner: every administrator and instructor, groups, MFA, removals
//   GET  /api/app/owner/audit?actor&action&target    owner: searchable audit log
//   POST /api/app/owner/users/:id/remove {reason}    owner: permanently revokes access (records are kept, not deleted)
//   GET  /api/app/owner/removal-requests?status      owner: requests raised by Super Administrators
//   POST /api/app/owner/removal-requests/:id {decision: "approve"|"reject", note}
//   GET  /api/app/owner/legacy-admins                owner: administrators with no group, awaiting review
//   PUT  /api/app/owner/policy {restrictUnassigned}  owner: restrict unassigned administrators to read-only
//   POST /api/app/admin/users/:id/removal-requests {reason}   Super Administrator: asks the owner to remove a staff account
import { ApiError, nowIso } from "../../http";
import { ok, page, requireStrongAuth, route, strongSession, type Ctx } from "../api";
import { auditSearch, createRemovalRequest, decideRemovalRequest, getOwnerPolicy, getRemovalRequest, isBootstrapped, listRemovalRequests, listStaff,
  pendingRequestFor, recordBootstrap, removeAccount, saveOwnerPolicy, teachingToReassign, unassignedAdmins } from "../data/owner";
import { getUser, setAdminRole } from "../data/users";
import { Checker } from "../../validate";
import { accountChangeRefusal, isOwner, isSuper, ownerEmail } from "../permissions";

const reasonOf = (b: Record<string, unknown>) => {
  const ch = new Checker();
  const reason = ch.req(b.reason, "Reason", 500);
  if (ch.errors.length) throw new ApiError(400, "invalid", ch.errors.join(" "));
  return reason;
};

async function target(c: Ctx) {
  const u = await getUser(c.db, c.params.id);
  if (!u) throw new ApiError(404, "not_found", "That account was not found.");
  if (isOwner(u, c.owner)) throw new ApiError(403, "forbidden", "The owner's account cannot be removed.");
  if (u.removed_at) throw new ApiError(409, "already_removed", "This account has already been removed.");
  return u;
}

route("GET", "/api/app/owner/status", ["admin"], async (c) => {
  const st = c.ownerState;
  const owner = c.isOwner;
  return ok({
    ownerConfigured: !!ownerEmail(c.env), isOwner: owner, state: st?.state ?? "unconfigured",
    bootstrapped: !!st?.record, bootstrappedAt: st?.record?.bootstrapped_at ?? null,
    // What the owner needs to do next; only the owner sees the details.
    strongSession: strongSession(c.session),
    pendingRemovals: owner ? (await listRemovalRequests(c.db, "pending").catch(() => [])).length : undefined,
    unassignedAdmins: owner ? (await unassignedAdmins(c.db, c.owner.ownerId)).length : undefined,
    policy: owner ? await getOwnerPolicy(c.db) : undefined,
  });
});

// The one-time set-up. The owner's account is fixed in owner_record (one row, cannot be changed by the application), and
// the owner becomes Super Administrator, after which groups can be assigned (by the owner and the Super Administrators the
// owner appoints). The insert is atomic, so it cannot be repeated or raced; nobody else can reach this route.
route("POST", "/api/app/owner/bootstrap", ["admin"], async (c) => {
  if (c.ownerState?.state !== "pending") throw new ApiError(409, "done", c.ownerState?.state === "bootstrapped" ? "Owner set-up is already complete." : "Owner set-up is not available. See the owner console status.");
  const at = nowIso();
  if (!(await recordBootstrap(c.db, c.user.id, c.user.email, at))) throw new ApiError(409, "done", "Owner set-up is already complete.");
  await setAdminRole(c.db, c.user.id, "super");
  await c.audit("owner.bootstrap", "user", c.user.id, { email: c.user.email.toLowerCase(), group: "super", previousGroup: c.user.admin_role ?? null });
  return ok({ bootstrapped: true, at });
});

route("GET", "/api/app/owner/staff", ["admin"], async (c) => ok({
  staff: (await listStaff(c.db)).map((u) => ({ id: u.id, email: u.email, fullName: u.full_name, role: u.role, status: u.status, adminRole: u.admin_role, staffNo: u.staff_no,
    lastLoginAt: u.last_login_at, removedAt: u.removed_at, removalReason: u.removal_reason, mfa: u.mfa === "active", owner: isOwner(u, c.owner) })),
}));

route("GET", "/api/app/owner/audit", ["admin"], async (c) => {
  const q = c.url.searchParams;
  const clip = (v: string | null) => (v ? v.trim().slice(0, 120) || undefined : undefined);
  const { limit, offset } = page(c.url, 200);
  return ok({ entries: await auditSearch(c.db, { actor: clip(q.get("actor")), action: clip(q.get("action")), target: clip(q.get("target")), limit, offset }) });
});

route("POST", "/api/app/owner/users/:id/remove", ["admin"], async (c) => {
  const u = await target(c);
  const reason = reasonOf(await c.body());
  const reassign = u.role === "instructor" ? await teachingToReassign(c.db, u.id) : [];
  await removeAccount(c.db, u.id, c.user.id, reason, nowIso());
  await c.audit("owner.remove", "user", u.id, { role: u.role, adminRole: u.admin_role ?? null, reason, activeEnrolmentsToReassign: reassign.length });
  return ok({ removed: true, accessRevoked: true, recordsDeleted: false, activeEnrolmentsToReassign: reassign.length, reassign: reassign.map(reassignView) });
});

route("GET", "/api/app/owner/removal-requests", ["admin"], async (c) => {
  const st = c.url.searchParams.get("status");
  return ok({ requests: await listRemovalRequests(c.db, st && ["pending", "approved", "rejected"].includes(st) ? st : undefined) });
});

route("POST", "/api/app/owner/removal-requests/:id", ["admin"], async (c) => {
  const r = await getRemovalRequest(c.db, c.params.id);
  if (!r) throw new ApiError(404, "not_found", "Request not found.");
  const b = await c.body<{ decision?: string; note?: string }>();
  const decision = b.decision === "approve" ? "approved" : b.decision === "reject" ? "rejected" : null;
  if (!decision) throw new ApiError(400, "invalid", "Choose approve or reject.");
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
  const u = await getUser(c.db, r.user_id);
  if (decision === "approved" && (!u || isOwner(u, c.owner))) throw new ApiError(403, "forbidden", "The owner's account cannot be removed.");
  if (!(await decideRemovalRequest(c.db, r.id, decision, c.user.id, note, nowIso()))) throw new ApiError(409, "decided", "This request has already been decided.");
  let reassign: Awaited<ReturnType<typeof teachingToReassign>> = [];
  if (decision === "approved" && u && !u.removed_at) {
    reassign = u.role === "instructor" ? await teachingToReassign(c.db, u.id) : [];
    await removeAccount(c.db, u.id, c.user.id, `${r.reason}${note ? ` (owner: ${note})` : ""}`, nowIso());
  }
  await c.audit(`owner.removal_${decision}`, "user", r.user_id, { request: r.id, reason: r.reason, note, activeEnrolmentsToReassign: reassign.length });
  return ok({ decision, accessRevoked: decision === "approved", recordsDeleted: false, activeEnrolmentsToReassign: reassign.length, reassign: reassign.map(reassignView) });
});

// A Super Administrator cannot remove staff permanently; they ask the owner. (Suspension stays available to them.)
route("POST", "/api/app/admin/users/:id/removal-requests", ["admin"], async (c) => {
  if (!isSuper(c.user) && !c.isOwner) throw new ApiError(403, "forbidden", "Only a Super Administrator can request a permanent removal.");
  const u = await target(c);
  if (u.role === "student") throw new ApiError(400, "invalid", "Removal requests are for staff accounts. The owner can remove a student account directly.");
  if (u.id === c.user.id) throw new ApiError(400, "self", "You cannot request your own removal.");
  const why = accountChangeRefusal(c.user, u, c.owner, await isBootstrapped(c.db));
  if (why) throw new ApiError(403, "forbidden", why);
  if (await pendingRequestFor(c.db, u.id)) throw new ApiError(409, "pending", "A removal request for this account is already waiting for the owner.");
  const reason = reasonOf(await c.body());
  await requireStrongAuth(c, "owner.removal_request", u.id);
  const id = crypto.randomUUID();
  await createRemovalRequest(c.db, { id, user_id: u.id, requested_by: c.user.id, reason, created_at: nowIso() });
  await c.audit("owner.removal_requested", "user", u.id, { request: id, reason });
  return ok({ requested: true, id }, 201);
});

const reassignView = (e: { id: string; programme: string; status: string; student_name: string; future_classes: number }) =>
  ({ enrolmentId: e.id, programme: e.programme, status: e.status, student: e.student_name, futureClasses: e.future_classes });

// Legacy administrators (no group): the owner reviews each one and assigns a group explicitly (Users > edit, or the
// owner console). Nothing is assigned automatically.
route("GET", "/api/app/owner/legacy-admins", ["admin"], async (c) => ok({
  admins: (await unassignedAdmins(c.db, c.owner.ownerId)).map((u) => ({ id: u.id, email: u.email, fullName: u.full_name, lastLoginAt: u.last_login_at, status: u.status })),
  policy: await getOwnerPolicy(c.db),
}));

// Optional restriction, off by default: unassigned administrators become read-only (the Reporting group's rights) until
// the owner assigns them a group. Recommended once the owner has reviewed every legacy administrator.
route("PUT", "/api/app/owner/policy", ["admin"], async (c) => {
  const b = await c.body<{ restrictUnassigned?: unknown }>();
  if (typeof b.restrictUnassigned !== "boolean") throw new ApiError(400, "invalid", "restrictUnassigned must be true or false.");
  const before = await getOwnerPolicy(c.db);
  await saveOwnerPolicy(c.db, { restrictUnassigned: b.restrictUnassigned }, c.user.id, nowIso());
  await c.audit("owner.policy", "settings", "owner_policy", { from: before, to: { restrictUnassigned: b.restrictUnassigned } });
  return ok({ policy: { restrictUnassigned: b.restrictUnassigned } });
});

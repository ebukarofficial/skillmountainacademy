// The owner console (Stage 2B). The owner is the account whose email equals OWNER_EMAIL (wrangler.jsonc); see
// permissions.ts. Every route here except /status is in the "owner" permission area: the owner alone, and (when two-step
// sign-in is configured) only from a session that passed the authenticator code.
//
//   GET  /api/app/owner/status                       any administrator: who the owner is, whether set-up is complete
//   POST /api/app/owner/bootstrap                    owner, once: becomes Super Administrator; enables group assignment
//   GET  /api/app/owner/staff                        owner: every administrator and instructor, groups, MFA, removals
//   GET  /api/app/owner/audit?actor&action&target    owner: searchable audit log
//   POST /api/app/owner/users/:id/remove {reason}    owner: permanently removes any account except the owner's own
//   GET  /api/app/owner/removal-requests?status      owner: requests raised by Super Administrators
//   POST /api/app/owner/removal-requests/:id {decision: "approve"|"reject", note}
//   POST /api/app/admin/users/:id/removal-requests {reason}   Super Administrator: asks the owner to remove a staff account
import { ApiError, nowIso } from "../../http";
import { ok, page, route, type Ctx } from "../api";
import { activeTeaching, auditSearch, createRemovalRequest, decideRemovalRequest, getBootstrap, getRemovalRequest, isBootstrapped, listRemovalRequests, listStaff,
  pendingRequestFor, removeAccount, saveBootstrap } from "../data/owner";
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
  if (isOwner(u, c.env)) throw new ApiError(403, "forbidden", "The owner's account cannot be removed.");
  if (u.removed_at) throw new ApiError(409, "already_removed", "This account has already been removed.");
  return u;
}

route("GET", "/api/app/owner/status", ["admin"], async (c) => {
  const b = await getBootstrap(c.db);
  return ok({ ownerConfigured: !!ownerEmail(c.env), isOwner: c.isOwner, bootstrapped: !!b, bootstrappedAt: b?.at ?? null,
    pendingRemovals: c.isOwner ? (await listRemovalRequests(c.db, "pending").catch(() => [])).length : undefined });
});

// The one-time set-up: the owner becomes Super Administrator, after which groups can be assigned (by the owner and the
// Super Administrators the owner appoints). It cannot be repeated, and no one else can perform it.
route("POST", "/api/app/owner/bootstrap", ["admin"], async (c) => {
  if (await isBootstrapped(c.db)) throw new ApiError(409, "done", "Owner set-up is already complete.");
  const at = nowIso();
  await setAdminRole(c.db, c.user.id, "super");
  await saveBootstrap(c.db, { at, by: c.user.id, email: c.user.email });
  await c.audit("owner.bootstrap", "user", c.user.id, { group: "super" });
  return ok({ bootstrapped: true, at });
});

route("GET", "/api/app/owner/staff", ["admin"], async (c) => ok({
  staff: (await listStaff(c.db)).map((u) => ({ id: u.id, email: u.email, fullName: u.full_name, role: u.role, status: u.status, adminRole: u.admin_role, staffNo: u.staff_no,
    lastLoginAt: u.last_login_at, removedAt: u.removed_at, removalReason: u.removal_reason, mfa: u.mfa === "active", owner: isOwner({ ...u, removed_at: u.removed_at }, c.env) })),
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
  const teaching = u.role === "instructor" ? await activeTeaching(c.db, u.id) : 0;
  await removeAccount(c.db, u.id, c.user.id, reason, nowIso());
  await c.audit("owner.remove", "user", u.id, { role: u.role, adminRole: u.admin_role ?? null, reason, activeEnrolmentsToReassign: teaching });
  return ok({ removed: true, activeEnrolmentsToReassign: teaching });
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
  if (decision === "approved" && (!u || isOwner(u, c.env))) throw new ApiError(403, "forbidden", "The owner's account cannot be removed.");
  if (!(await decideRemovalRequest(c.db, r.id, decision, c.user.id, note, nowIso()))) throw new ApiError(409, "decided", "This request has already been decided.");
  let teaching = 0;
  if (decision === "approved" && u && !u.removed_at) {
    teaching = u.role === "instructor" ? await activeTeaching(c.db, u.id) : 0;
    await removeAccount(c.db, u.id, c.user.id, `${r.reason}${note ? ` (owner: ${note})` : ""}`, nowIso());
  }
  await c.audit(`owner.removal_${decision}`, "user", r.user_id, { request: r.id, note, activeEnrolmentsToReassign: teaching });
  return ok({ decision, activeEnrolmentsToReassign: teaching });
});

// A Super Administrator cannot remove staff permanently; they ask the owner. (Suspension stays available to them.)
route("POST", "/api/app/admin/users/:id/removal-requests", ["admin"], async (c) => {
  if (!isSuper(c.user) && !c.isOwner) throw new ApiError(403, "forbidden", "Only a Super Administrator can request a permanent removal.");
  const u = await target(c);
  if (u.role === "student") throw new ApiError(400, "invalid", "Removal requests are for staff accounts. The owner can remove a student account directly.");
  if (u.id === c.user.id) throw new ApiError(400, "self", "You cannot request your own removal.");
  const why = accountChangeRefusal(c.user, u, c.env, await isBootstrapped(c.db));
  if (why) throw new ApiError(403, "forbidden", why);
  if (await pendingRequestFor(c.db, u.id)) throw new ApiError(409, "pending", "A removal request for this account is already waiting for the owner.");
  const id = crypto.randomUUID();
  await createRemovalRequest(c.db, { id, user_id: u.id, requested_by: c.user.id, reason: reasonOf(await c.body()), created_at: nowIso() });
  await c.audit("owner.removal_requested", "user", u.id, { request: id });
  return ok({ requested: true, id }, 201);
});

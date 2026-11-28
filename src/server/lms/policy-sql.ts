// Commit-time policy predicates (Expansion Stage E.3).
//
// Every rule an approved action depends on is expressed here as an SQL condition, evaluated INSIDE the same D1 batch
// (one transaction) that commits the action, so no action can commit on authority or business state that was read
// earlier and has since changed. These predicates are the SQL form of the existing rules in permissions.ts
// (isOwner, isSuper, canManageAdmins, groupChangeRefusal, accountChangeRefusal, adminMay for the "users" area),
// data/owner.ts (resolveOwner, isBootstrapped, the restrictUnassigned policy), institution.ts (mayDecide,
// assertAssignable, the one-department policy, the approval policy) and payment-release.ts (checkReleasable). They
// add no policy of their own. tests/stageE3-commit-authorization.test.ts checks them against the JavaScript rules on
// a matrix of cases, so the two forms cannot drift apart unnoticed.
//
// Pure module (no imports): every value is a bound parameter allocated through Params; nothing is interpolated.

export type Val = string | number | null;
export class Params {
  vals: Val[] = [];
  private readonly first: number;
  constructor(first = 1) { this.first = first; }
  p(v: Val): string { this.vals.push(v); return `?${this.first + this.vals.length - 1}`; }
}
// A named commit-time condition. build() returns an SQL boolean expression using parameters from ps.
export type Cond = { name: string; message: string; build: (ps: Params) => string };

// ---- people ----
// The verified owner: the bootstrap record, OWNER_EMAIL and a usable admin account all agree (resolveOwner "bootstrapped").
const ownerIs = (ps: Params, userCol: string, ownerEmail: string) => {
  const e = ps.p(ownerEmail.toLowerCase());
  return `EXISTS (SELECT 1 FROM owner_record r JOIN users o ON o.id = r.user_id WHERE r.id = 1 AND o.id = ${userCol} AND lower(r.email) = ${e} AND lower(o.email) = ${e} AND o.role = 'admin' AND o.status = 'active' AND o.removed_at IS NULL)`;
};
const bootstrapped = "EXISTS (SELECT 1 FROM owner_record WHERE id = 1)";
const activeUser = (ps: Params, id: string) => `EXISTS (SELECT 1 FROM users WHERE id = ${ps.p(id)} AND status = 'active' AND removed_at IS NULL)`;
const isSuperUser = (ps: Params, id: string) => `EXISTS (SELECT 1 FROM users WHERE id = ${ps.p(id)} AND role = 'admin' AND admin_role = 'super')`;
const isOwnerUser = (ps: Params, id: string, ownerEmail: string) => ownerIs(ps, ps.p(id), ownerEmail);
// canManageAdmins: the owner, or a Super Administrator once the owner has bootstrapped.
const canManageAdmins = (ps: Params, id: string, ownerEmail: string) => `(${isOwnerUser(ps, id, ownerEmail)} OR (${bootstrapped} AND ${isSuperUser(ps, id)}))`;

// groupChangeRefusal(actor, target, next) === null, evaluated on current rows.
export function groupChangeAllowed(ps: Params, actorId: string, targetId: string, next: string, ownerEmail: string): string {
  const t = ps.p(targetId);
  const n = ps.p(next);
  const actorOwner = isOwnerUser(ps, actorId, ownerEmail);
  return `(${n} IN ('super', 'admissions', 'finance', 'academic', 'faculty', 'support', 'reporting') AND ${bootstrapped} AND (${actorOwner} OR ${isSuperUser(ps, actorId)}) AND EXISTS (SELECT 1 FROM users WHERE id = ${t} AND role = 'admin' AND removed_at IS NULL) AND NOT ${ownerIs(ps, t, ownerEmail)} AND ${ps.p(actorId)} <> ${t} AND ((${n} <> 'super' AND COALESCE((SELECT admin_role FROM users WHERE id = ${t}), '') <> 'super') OR ${isOwnerUser(ps, actorId, ownerEmail)}))`;
}
// accountChangeRefusal(actor, target) === null, evaluated on current rows.
export function accountChangeAllowed(ps: Params, actorId: string, targetId: string, ownerEmail: string): string {
  const t = ps.p(targetId);
  const a = ps.p(actorId);
  return `(EXISTS (SELECT 1 FROM users WHERE id = ${t}) AND (NOT ${ownerIs(ps, t, ownerEmail)} OR ${a} = ${t}) AND NOT EXISTS (SELECT 1 FROM users WHERE id = ${t} AND removed_at IS NOT NULL) AND (NOT EXISTS (SELECT 1 FROM users WHERE id = ${t} AND role = 'admin') OR ${a} = ${t} OR (${canManageAdmins(ps, actorId, ownerEmail)} AND (COALESCE((SELECT admin_role FROM users WHERE id = ${t}), '') <> 'super' OR ${isOwnerUser(ps, actorId, ownerEmail)}))))`;
}
// adminMay(effective group, "PATCH", "/api/app/admin/users/:id"): the "users" area is written by Super Administrators,
// by unassigned (legacy) administrators unless the owner restricts them, and by the owner.
export function usersAreaWriter(ps: Params, actorId: string, ownerEmail: string): string {
  const a = ps.p(actorId);
  return `(${isOwnerUser(ps, actorId, ownerEmail)} OR EXISTS (SELECT 1 FROM users WHERE id = ${a} AND role = 'admin' AND (admin_role = 'super' OR (admin_role IS NULL AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'owner_policy' AND json_extract(value, '$.restrictUnassigned') = 1)))))`;
}

// ---- conditions shared by every approved action ----
export function commonConditions(o: { approvalId: string; category: string; approverId: string; requesterId: string; targetType: string; targetId: string; ownerEmail: string }): Cond[] {
  const policyPath = o.category === "payment_attempt_release" ? "$.paymentRelease.enabled" : `$.categories.${o.category}.enabled`;
  return [
    { name: "policy_enabled", message: "The owner has switched this approval off.",
      build: (ps) => `EXISTS (SELECT 1 FROM app_settings WHERE key = 'approval_policy' AND json_extract(value, ${ps.p(policyPath)}) = 1)` },
    // mayDecide: never the requester, never the target of a change to people; "owner" requests need the owner;
    // "super" requests need the owner or an active Super Administrator. The approver's account must be active.
    { name: "approver_authority", message: "The approver no longer has the authority to carry this out.",
      build: (ps) => `(${activeUser(ps, o.approverId)} AND ${ps.p(o.approverId)} <> ${ps.p(o.requesterId)} AND (${ps.p(o.targetType)} <> 'user' OR ${ps.p(o.approverId)} <> ${ps.p(o.targetId)}) AND (${isOwnerUser(ps, o.approverId, o.ownerEmail)} OR ((SELECT approver FROM approval_requests WHERE id = ${ps.p(o.approvalId)}) = 'super' AND ${isSuperUser(ps, o.approverId)})))` },
    { name: "requester_active", message: "The person who asked no longer has an active account.", build: (ps) => activeUser(ps, o.requesterId) },
  ];
}

// ---- category conditions ----
export const groupChangeConditions = (o: { approverId: string; requesterId: string; targetId: string; next: string; ownerEmail: string }): Cond[] => [
  { name: "requester_authority", message: "The person who asked no longer has the authority for this group change.",
    build: (ps) => groupChangeAllowed(ps, o.requesterId, o.targetId, o.next, o.ownerEmail) },
  { name: "approver_action_authority", message: "The approver no longer has the authority for this group change.",
    build: (ps) => groupChangeAllowed(ps, o.approverId, o.targetId, o.next, o.ownerEmail) },
];
export const reinstatementConditions = (o: { approverId: string; requesterId: string; targetId: string; ownerEmail: string }): Cond[] => [
  { name: "target_suspended", message: "The account is no longer a suspended staff account.",
    build: (ps) => `EXISTS (SELECT 1 FROM users WHERE id = ${ps.p(o.targetId)} AND status = 'suspended' AND removed_at IS NULL AND role IN ('admin', 'instructor'))` },
  { name: "requester_authority", message: "The person who asked no longer has the authority to reactivate this account.",
    build: (ps) => `(${usersAreaWriter(ps, o.requesterId, o.ownerEmail)} AND ${accountChangeAllowed(ps, o.requesterId, o.targetId, o.ownerEmail)})` },
  { name: "approver_action_authority", message: "The approver no longer has the authority to reactivate this account.",
    build: (ps) => accountChangeAllowed(ps, o.approverId, o.targetId, o.ownerEmail) },
];
// The plan's snapshot: the head it will replace (or none), and the target's open assignments it was built from.
export const headConditions = (o: { requesterId: string; targetId: string; slug: string; currentHeadAssignment: string | null; targetAssignments: string[]; ownerEmail: string;
  needsMultiple: boolean }): Cond[] => [
  { name: "requester_authority", message: "The person who asked is no longer a Super Administrator.",
    build: (ps) => isSuperUser(ps, o.requesterId) },
  { name: "department_active", message: "The department is no longer active.",
    build: (ps) => `EXISTS (SELECT 1 FROM departments WHERE slug = ${ps.p(o.slug)} AND status = 'active')` },
  // assertAssignable: an active, not removed administrator or instructor who is not the owner.
  { name: "target_assignable", message: "The person can no longer be appointed (not an active staff member).",
    build: (ps) => `(EXISTS (SELECT 1 FROM users WHERE id = ${ps.p(o.targetId)} AND status = 'active' AND removed_at IS NULL AND role IN ('admin', 'instructor')) AND NOT ${isOwnerUser(ps, o.targetId, o.ownerEmail)})` },
  { name: "headship_unchanged", message: "The department's headship changed after this was planned.",
    build: (ps) => o.currentHeadAssignment
      ? `EXISTS (SELECT 1 FROM staff_assignments WHERE id = ${ps.p(o.currentHeadAssignment)} AND department_slug = ${ps.p(o.slug)} AND position = 'head' AND ended_at IS NULL)`
      : `NOT EXISTS (SELECT 1 FROM staff_assignments WHERE department_slug = ${ps.p(o.slug)} AND position = 'head' AND ended_at IS NULL)` },
  { name: "membership_unchanged", message: "The person's department memberships changed after this was planned.",
    build: (ps) => `COALESCE((SELECT group_concat(id, ',') FROM (SELECT id FROM staff_assignments WHERE user_id = ${ps.p(o.targetId)} AND ended_at IS NULL ORDER BY id)), '') = ${ps.p([...o.targetAssignments].sort().join(","))}` },
  ...(o.needsMultiple ? [{ name: "multiple_departments_allowed", message: "Belonging to several departments is no longer allowed by the owner's policy.",
    build: () => `EXISTS (SELECT 1 FROM app_settings WHERE key = 'institution_policy' AND json_extract(value, '$.multipleDepartments') = 1)` }] : []),
];
// checkReleasable at commit time (the read-only Paystack verification stays before the transaction), and the existing
// release rule that the requester's group is one the owner authorised.
export const releaseConditions = (o: { attemptId: string; requesterId: string; claimedBefore: string; version: number }): Cond[] => [
  // Stage E.4: unchanged since this run's Paystack check (any webhook, payment or other change moves the version). The
  // freshness and settling of that evidence are enforced by migration 0018's release trigger in the same transaction.
  { name: "payment_evidence", message: "The attempt changed after Paystack was checked (or a payment arrived).",
    build: (ps) => `EXISTS (SELECT 1 FROM payment_attempts WHERE id = ${ps.p(o.attemptId)} AND version = ${ps.p(o.version)} AND outcome IS NULL)` },
  { name: "attempt_releasable", message: "The payment attempt is no longer one that can be released.",
    build: (ps) => `EXISTS (SELECT 1 FROM payment_attempts WHERE id = ${ps.p(o.attemptId)} AND (state = 'uncertain' OR (state = 'claimed' AND claimed_at < ${ps.p(o.claimedBefore)})))` },
  { name: "instalment_unpaid", message: "This part has been paid. Nothing to release.",
    build: (ps) => `EXISTS (SELECT 1 FROM payment_attempts a JOIN instalments i ON i.id = a.instalment_id WHERE a.id = ${ps.p(o.attemptId)} AND i.status <> 'paid')` },
  { name: "requester_authority", message: "The person who asked is no longer in a group the owner authorised to release payment attempts.",
    build: (ps) => `EXISTS (SELECT 1 FROM app_settings s, json_each(json_extract(s.value, '$.paymentRelease.allowedGroups')) g WHERE s.key = 'approval_policy' AND g.value = (SELECT admin_role FROM users WHERE id = ${ps.p(o.requesterId)} AND role = 'admin'))` },
];

// The validation statement's SQL: one CASE over every condition. Inside the fenced batch it sets the fence row's
// effect_check, a NOT NULL column, to NULL when any condition is false, which fails the statement and rolls back the
// whole batch (a conditional UPDATE that changes no row would NOT fail the batch; this does).
export function validationSql(conds: Cond[], firstParam: number): { sql: string; vals: Val[] } {
  const ps = new Params(firstParam);
  const all = conds.map((c) => `(${c.build(ps)})`).join("\n AND ");
  return { sql: `CASE WHEN ${all || "1"} THEN 'validated' ELSE NULL END`, vals: ps.vals };
}
// One condition alone, as a SELECT returning 1 or 0: used to explain a rollback, and by the parity tests.
export function probeSql(c: Cond): { sql: string; vals: Val[] } {
  const ps = new Params(1);
  return { sql: `SELECT CASE WHEN (${c.build(ps)}) THEN 1 ELSE 0 END AS ok`, vals: ps.vals };
}

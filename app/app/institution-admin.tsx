"use client";
// Institution (Expansion Stage E): departments and heads, staff assignments, single invitations, approvals, the role
// and permission matrix, the owner's policies and a person's access history. DISPLAY ONLY: every action is checked again
// by the server (src/server/lms/routes/institution.ts), which also decides what each person may see.
import { useState } from "react";
import { api, Badge, Btn, Card, Empty, Field, inputCls, Msg, useAction, useLoad, when } from "./ui";

type Access = { role: string | null; owner?: boolean; areas: { read: string[]; write: string[] } } | null;
type Dept = { slug: string; name: string; purpose: string | null; status: string; members: number; head: { user_id: string; full_name: string } | null };
type Assign = { id: string; userId: string; fullName: string; role: string; adminRole: string | null; status: string; removed: boolean; department: string; position: string; since: string; reason: string | null };
type Invite = { id: string; email: string; fullName: string; role: string; adminRole: string | null; departmentSlug: string | null; position: string | null; status: string; expiresAt: string; createdAt: string; revokeReason: string | null };
type Rule = { enabled: boolean; approver: "owner" | "super"; expiresInHours: number };
type Release = Rule & { allowedGroups: string[]; requiresApproval: boolean };
type Policies = { institution: Record<string, boolean>; approvals: { categories: Record<string, Rule>; paymentRelease: Release | null } };
type Overview = { departments: Dept[]; assignments: Assign[]; invitations: Invite[]; approvals: { pending: number }; policies: Policies;
  categories: { executable: string[]; evaluatedOnly: string[] }; roles: { groups: string[]; grants: Record<string, { read: string[]; write: string[] }>; routes: { method: string; path: string; area: string }[] };
  you: { owner: boolean; super: boolean } };
type Approval = { id: string; category: string; target_id: string; payload: Record<string, unknown>; reason: string; requested_by: string; requesterName: string | null; approver: string; status: string;
  expires_at: string; decided_at: string | null; deciderName: string | null; decision_comment: string | null; executed_at: string | null; execution_result: string | null; escalated_at: string | null; created_at: string; canDecide: boolean;
  execution_status: string; execution_attempts: number; canRecover: boolean };
// Stage E.1: what happened to the action, shown apart from the decision.
const EXECUTION: Record<string, string> = { not_applicable: "", awaiting_execution: "action not carried out yet", executing: "action in progress", completed: "action carried out", failed: "action NOT carried out" };

const GROUPS: [string, string][] = [["super", "Super Administrator"], ["admissions", "Admissions"], ["finance", "Finance"], ["academic", "Academic Administration"], ["faculty", "Faculty Management"], ["support", "Student Support"], ["reporting", "Read-only Reporting"]];
const groupName = (g: string | null) => GROUPS.find(([k]) => k === g)?.[1] ?? (g ? g : "Unassigned");
const CATEGORY: Record<string, string> = {
  staff_group_change: "Change an administrator group", staff_reinstatement: "Reactivate a suspended staff account", department_head_appointment: "Appoint a department head",
  payment_attempt_release: "Release a Paystack checkout attempt", sensitive_academic_override: "Sensitive academic override", financial_adjustment: "Financial adjustment",
  exceptional_admission: "Exceptional admission", sensitive_data_access: "Sensitive data access",
};
const POLICY_LABELS: [string, string][] = [["superMayManageDepartments", "Super Administrators may create, rename and archive departments"], ["superMayAssignStaff", "Super Administrators may add and end ordinary department membership"],
  ["superMayAppointHeads", "Super Administrators may appoint department heads directly"], ["multipleDepartments", "One person may belong to more than one department"]];

function Segments<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return <div role="tablist" className="mb-5 inline-flex flex-wrap rounded-lg border border-ink/15 p-0.5">{items.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={`rounded-md px-4 py-2 text-sm font-semibold ${value === v ? "bg-indigo text-white" : "text-ink/75 hover:text-ink"}`}>{l}</button>)}</div>;
}
const ask = (q: string) => { const r = prompt(q); return r && r.trim() ? r.trim() : null; };

export function InstitutionAdmin({ access, meId }: { access: Access; meId: string }) {
  const manager = !!access?.owner || access?.role === "super";
  type Seg = "structure" | "staff" | "invitations" | "approvals" | "roles" | "policies" | "history" | "mine";
  const [seg, setSeg] = useState<Seg>(manager ? "structure" : "mine");
  const items: [Seg, string][] = manager
    ? [["structure", "Departments"], ["staff", "Staff assignments"], ["invitations", "Invitations"], ["approvals", "Approvals"], ["roles", "Roles and permissions"], ["policies", "Policies"], ["history", "Access history"], ["mine", "My department"]]
    : [["mine", "My department"], ["approvals", "My requests"]];
  return <>
    <Segments value={seg} onChange={setSeg} items={items} />
    {seg === "mine" && <MyDepartment />}
    {seg === "approvals" && <Approvals meId={meId} />}
    {manager && seg !== "mine" && seg !== "approvals" && <Managed seg={seg} />}
  </>;
}

function Managed({ seg }: { seg: string }) {
  const { data, error, reload } = useLoad<Overview>("/api/app/admin/institution");
  if (error) return <Card><Msg text={error} /></Card>;
  if (!data) return <Card><Empty>Loading…</Empty></Card>;
  if (seg === "structure") return <Structure o={data} reload={reload} />;
  if (seg === "staff") return <Staff o={data} reload={reload} />;
  if (seg === "invitations") return <Invitations o={data} reload={reload} />;
  if (seg === "roles") return <Roles o={data} />;
  if (seg === "policies") return <PoliciesView o={data} reload={reload} />;
  return <History o={data} />;
}

function Structure({ o, reload }: { o: Overview; reload: () => void }) {
  const { busy, msg, run } = useAction();
  return <div className="space-y-5">
    <Card title="Departments">
      <p className="text-sm text-ink/70">Departments organise staff and give each a head. They grant no access: what a person can do still comes only from their administrator group.
        {!o.departments.length && " No departments have been created yet. The recommended structure is in the Stage E report and waits for the owner's decision."}</p>
      {!!o.departments.length && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="text-ink/60"><tr><th className="py-2 pr-3">Department</th><th className="pr-3">Head</th><th className="pr-3">Members</th><th className="pr-3">Status</th><th /></tr></thead>
        <tbody>{o.departments.map((d) => <tr key={d.slug} className="border-t border-ink/10 align-top">
          <td className="py-2 pr-3"><b>{d.name}</b><span className="block text-xs text-ink/55">{d.slug}{d.purpose ? ` · ${d.purpose}` : ""}</span></td>
          <td className="pr-3">{d.head?.full_name ?? <span className="text-ink/50">no head</span>}</td><td className="pr-3">{d.members}</td><td className="pr-3"><Badge s={d.status} /></td>
          <td className="text-right"><Btn small kind="ghost" disabled={busy} onClick={() => { const reason = ask(`${d.status === "active" ? "Archive" : "Restore"} ${d.name}? Reason (required):`); if (reason) run(() => api(`/api/app/admin/departments/${d.slug}`, { method: "PATCH", body: { status: d.status === "active" ? "archived" : "active", reason } }), "Saved.", reload); }}>{d.status === "active" ? "Archive" : "Restore"}</Btn></td>
        </tr>)}</tbody></table></div>}
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
    <Card title="Create a department">
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = Object.fromEntries(new FormData(form)); run(() => api("/api/app/admin/departments", { method: "POST", body: f }), "Department created.", () => { form.reset(); reload(); }); }}>
        <Field label="Short name (e.g. admissions)"><input name="slug" required className={inputCls} /></Field>
        <Field label="Name"><input name="name" required className={inputCls} /></Field>
        <Field label="Purpose (optional)"><input name="purpose" className={inputCls} /></Field>
        <div className="sm:col-span-3"><Btn type="submit" disabled={busy}>Create department</Btn></div>
      </form>
    </Card>
  </div>;
}

function Staff({ o, reload }: { o: Overview; reload: () => void }) {
  const { busy, msg, run } = useAction();
  const people = useLoad<{ users: { id: string; fullName: string; role: string; status: string }[] }>("/api/app/admin/users?limit=100");
  const staff = (people.data?.users ?? []).filter((u) => u.role !== "student" && u.status === "active");
  return <div className="space-y-5">
    <Card title="Current assignments">
      {!o.assignments.length ? <Empty>Nobody is assigned to a department yet.</Empty> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="text-ink/60"><tr><th className="py-2 pr-3">Person</th><th className="pr-3">Department</th><th className="pr-3">Position</th><th className="pr-3">Group</th><th className="pr-3">Since</th><th /></tr></thead>
        <tbody>{o.assignments.map((a) => <tr key={a.id} className="border-t border-ink/10 align-top">
          <td className="py-2 pr-3"><b>{a.fullName}</b>{a.status !== "active" && <span className="ml-2"><Badge s={a.status} /></span>}</td>
          <td className="pr-3">{o.departments.find((d) => d.slug === a.department)?.name ?? a.department}</td><td className="pr-3">{a.position === "head" ? "Head" : "Staff"}</td>
          <td className="pr-3">{a.role === "instructor" ? "Instructor" : groupName(a.adminRole)}</td><td className="pr-3">{when(a.since)}</td>
          <td className="text-right"><Btn small kind="ghost" disabled={busy} onClick={() => { const reason = ask(`End ${a.fullName}'s ${a.position === "head" ? "headship" : "membership"}? The record is kept. Reason (required):`); if (reason) run(() => api(`/api/app/admin/assignments/${a.id}/end`, { method: "POST", body: { reason } }), "Ended. The record is kept.", reload); }}>End</Btn></td>
        </tr>)}</tbody></table></div>}
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
    <Card title="Assign a staff member">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = Object.fromEntries(new FormData(form)) as Record<string, string>; run(() => api(`/api/app/admin/departments/${f.department}/members`, { method: "POST", body: { userId: f.userId, position: f.position, reason: f.reason } }), "Assigned.", () => { form.reset(); reload(); }); }}>
        <Field label="Staff member"><select name="userId" required className={inputCls}><option value="">Choose…</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.role})</option>)}</select></Field>
        <Field label="Department"><select name="department" required className={inputCls}><option value="">Choose…</option>{o.departments.filter((d) => d.status === "active").map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</select></Field>
        <Field label="Position"><select name="position" className={inputCls}><option value="staff">Staff</option><option value="head">Head</option></select></Field>
        <Field label="Reason (required)"><input name="reason" required className={inputCls} /></Field>
        <div className="sm:col-span-2"><Btn type="submit" disabled={busy}>Assign</Btn></div>
      </form>
    </Card>
  </div>;
}

function Invitations({ o, reload }: { o: Overview; reload: () => void }) {
  const { busy, msg, run } = useAction();
  const [role, setRole] = useState("admin");
  return <div className="space-y-5">
    <Card title="Invite one staff member">
      <p className="text-sm text-ink/70">One invitation, to one person. The link works once, expires after 24 hours and gives exactly the role, group and department chosen here. Nobody can change them when accepting.</p>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = Object.fromEntries(new FormData(form)) as Record<string, string>; run(() => api("/api/app/admin/invitations", { method: "POST", body: { ...f, departmentSlug: f.departmentSlug || undefined } }), "Invitation created and emailed to that person.", () => { form.reset(); reload(); }); }}>
        <Field label="Full name"><input name="fullName" required className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" required className={inputCls} /></Field>
        <Field label="Role"><select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}><option value="admin">Administrator</option><option value="instructor">Instructor</option></select></Field>
        {role === "admin" && <Field label="Administrator group"><select name="adminRole" required className={inputCls}><option value="">Choose…</option>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
        <Field label="Department (optional)"><select name="departmentSlug" className={inputCls}><option value="">None</option>{o.departments.filter((d) => d.status === "active").map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</select></Field>
        <Field label="Position"><select name="position" className={inputCls}><option value="staff">Staff</option><option value="head">Head</option></select></Field>
        <div className="sm:col-span-2"><Btn type="submit" disabled={busy}>Send invitation</Btn></div>
      </form>
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
    <Card title="Invitations">
      {!o.invitations.length ? <Empty>No invitations yet.</Empty> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="text-ink/60"><tr><th className="py-2 pr-3">Person</th><th className="pr-3">Access</th><th className="pr-3">Status</th><th className="pr-3">Expires</th><th /></tr></thead>
        <tbody>{o.invitations.map((i) => <tr key={i.id} className="border-t border-ink/10 align-top">
          <td className="py-2 pr-3"><b>{i.fullName}</b><span className="block text-xs text-ink/55">{i.email}</span></td>
          <td className="pr-3">{i.role === "instructor" ? "Instructor" : groupName(i.adminRole)}{i.departmentSlug && <span className="block text-xs text-ink/55">{i.position === "head" ? "Head of " : ""}{o.departments.find((d) => d.slug === i.departmentSlug)?.name ?? i.departmentSlug}</span>}</td>
          <td className="pr-3"><Badge s={i.status} />{i.revokeReason && <span className="block text-xs text-ink/55">{i.revokeReason}</span>}</td><td className="pr-3">{when(i.expiresAt)}</td>
          <td className="text-right">{i.status === "pending" && <Btn small kind="ghost" disabled={busy} onClick={() => { const reason = ask(`Revoke the invitation for ${i.fullName}? Reason (required):`); if (reason) run(() => api(`/api/app/admin/invitations/${i.id}/revoke`, { method: "POST", body: { reason } }), "Invitation revoked.", reload); }}>Revoke</Btn>}</td>
        </tr>)}</tbody></table></div>}
    </Card>
  </div>;
}

function Approvals({ meId }: { meId: string }) {
  const { data, error, reload } = useLoad<{ approvals: Approval[] }>("/api/app/admin/approvals");
  const { busy, msg, run } = useAction();
  if (error) return <Card><Msg text={error} /></Card>;
  if (!data) return <Card><Empty>Loading…</Empty></Card>;
  return <Card title="Approval requests">
    <p className="text-sm text-ink/70">Nothing in a request happens until it is approved, and nobody can approve their own request. When approved, every rule is checked again before the change is made.</p>
    {!data.approvals.length ? <Empty>No requests.</Empty> : <ul className="mt-3 divide-y divide-ink/10">{data.approvals.map((a) => <li key={a.id} className="py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><b>{CATEGORY[a.category] ?? a.category}</b><Badge s={a.status} />{a.status === "approved" && a.execution_status !== "completed" && <Badge s={a.execution_status === "failed" ? "failed" : "pending"} />}<span className="text-ink/55">needs {a.approver === "owner" ? "the owner" : "a Super Administrator"}{a.escalated_at ? " (escalated)" : ""}</span></div>
      <p className="text-ink/75">Asked by {a.requesterName ?? "unknown"} on {when(a.created_at)}: {a.reason}</p>
      {a.decided_at && <p className="text-ink/65">{a.status} by {a.deciderName ?? "—"} on {when(a.decided_at)}{a.decision_comment ? `: ${a.decision_comment}` : ""}</p>}
      {a.status === "approved" && <p className={a.execution_status === "failed" ? "font-semibold text-brand-red" : "text-ink/65"} data-execution={a.execution_status}>
        Approved: {EXECUTION[a.execution_status] ?? a.execution_status}{a.execution_attempts > 1 ? ` (${a.execution_attempts} runs)` : ""}{a.execution_result ? `. ${a.execution_result}` : ""}</p>}
      {a.status === "approved" && a.canRecover && <div className="mt-2"><Btn small kind="ghost" disabled={busy} onClick={() => { if (confirm("Carry out this approved request now? Every rule is checked again first, and nothing is repeated if it already took effect.")) run(() => api(`/api/app/admin/approvals/${a.id}/execute`, { method: "POST", body: {} }), "Done. See the result on the request.", reload); }}>Carry out again</Btn></div>}
      {a.status === "pending" && <div className="mt-2 flex flex-wrap gap-2">
        {a.canDecide && <><Btn small disabled={busy} onClick={() => { if (confirm("Approve this request? The change is made at once.")) run(() => api(`/api/app/admin/approvals/${a.id}/decision`, { method: "POST", body: { decision: "approve" } }), "Approved.", reload); }}>Approve</Btn>
          <Btn small kind="ghost" disabled={busy} onClick={() => { const comment = ask("Reject this request. Comment (required):"); if (comment) run(() => api(`/api/app/admin/approvals/${a.id}/decision`, { method: "POST", body: { decision: "reject", comment } }), "Rejected.", reload); }}>Reject</Btn></>}
        {a.requested_by === meId && <Btn small kind="ghost" disabled={busy} onClick={() => { const reason = ask("Cancel this request. Reason (required):"); if (reason) run(() => api(`/api/app/admin/approvals/${a.id}/cancel`, { method: "POST", body: { reason } }), "Cancelled.", reload); }}>Cancel</Btn>}
        {a.approver === "super" && <Btn small kind="ghost" disabled={busy} onClick={() => { const reason = ask("Escalate to the owner. Reason (required):"); if (reason) run(() => api(`/api/app/admin/approvals/${a.id}/escalate`, { method: "POST", body: { reason } }), "Escalated to the owner.", reload); }}>Escalate to owner</Btn>}
      </div>}
    </li>)}</ul>}
    <Msg text={msg.text} kind={msg.kind} />
  </Card>;
}

function Roles({ o }: { o: Overview }) {
  const areas = [...new Set(o.roles.routes.map((r) => r.area))].filter((a) => a !== "owner");
  return <Card title="Administrator groups and what they can do">
    <p className="text-sm text-ink/70">Read = can see; Write = can change. Anything not listed is refused by the server. The owner area belongs to the owner alone. Departments and headship add nothing to this table.</p>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="text-ink/60"><tr><th className="py-2 pr-3">Area</th>{o.roles.groups.map((g) => <th key={g} className="pr-3">{groupName(g)}</th>)}</tr></thead>
      <tbody>{areas.map((a) => <tr key={a} className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">{a}</td>
        {o.roles.groups.map((g) => { const r = o.roles.grants[g].read.includes(a), w = o.roles.grants[g].write.includes(a); return <td key={g} className="pr-3">{w ? "Write" : r ? "Read" : <span className="text-ink/40">—</span>}</td>; })}</tr>)}</tbody>
    </table></div>
  </Card>;
}

function PoliciesView({ o, reload }: { o: Overview; reload: () => void }) {
  const { busy, msg, run } = useAction();
  const p = o.policies;
  const owner = o.you.owner;
  const [inst, setInst] = useState(p.institution);
  const rel = p.approvals.paymentRelease;
  return <div className="space-y-5">
    <Card title="Departments">
      <ul className="space-y-2 text-sm">{POLICY_LABELS.map(([k, l]) => <li key={k}><label className="flex items-center gap-2"><input type="checkbox" disabled={!owner} checked={!!inst[k]} onChange={(e) => setInst({ ...inst, [k]: e.target.checked })} />{l}</label></li>)}</ul>
      {owner ? <div className="mt-3"><Btn small disabled={busy} onClick={() => run(() => api("/api/app/owner/institution-policy", { method: "PUT", body: inst }), "Policy saved.", reload)}>Save</Btn></div> : <p className="mt-2 text-xs text-ink/55">Only the owner can change these.</p>}
    </Card>
    <Card title="Approval rules">
      <p className="text-sm text-ink/70">Every rule is off until the owner switches it on. Off means: the owner acts directly, and others act as their group allows today.</p>
      <ul className="mt-2 space-y-1 text-sm">{o.categories.executable.filter((c) => c !== "payment_attempt_release").map((c) => { const r = p.approvals.categories[c]; return <li key={c}><b>{CATEGORY[c]}</b>: {r?.enabled ? `on, approved by ${r.approver === "owner" ? "the owner" : "a Super Administrator"}, expires after ${r.expiresInHours} h` : "off"}</li>; })}</ul>
      <p className="mt-3 text-sm text-ink/70">Not available yet (need an owner policy and an executor): {o.categories.evaluatedOnly.map((c) => CATEGORY[c] ?? c).join(", ")}.</p>
    </Card>
    <Card title="Releasing Paystack checkout attempts">
      <p className="text-sm text-ink/70">{rel?.enabled ? `Authorised for: ${rel.allowedGroups.map(groupName).join(", ") || "nobody but the owner"}. ${rel.requiresApproval ? `Each release needs approval by ${rel.approver === "owner" ? "the owner" : "a Super Administrator"}.` : "No second approval."}`
        : "Disabled for everyone, the owner included, until the owner records who may release and whether a second person must approve. Finance can still check an attempt with Paystack."}</p>
    </Card>
    {owner && <ApprovalPolicyEditor o={o} reload={reload} />}
    <Msg text={msg.text} kind={msg.kind} />
  </div>;
}

// The owner's editor. Saving records exactly what is shown; nothing is switched on unless ticked here.
function ApprovalPolicyEditor({ o, reload }: { o: Overview; reload: () => void }) {
  const { busy, msg, run } = useAction();
  const cats = o.categories.executable.filter((c) => c !== "payment_attempt_release");
  const [rules, setRules] = useState<Record<string, Rule>>(() => Object.fromEntries(cats.map((c) => [c, o.policies.approvals.categories[c] ?? { enabled: false, approver: "owner", expiresInHours: 72 }])));
  const [rel, setRel] = useState<Release>(o.policies.approvals.paymentRelease ?? { enabled: false, approver: "owner", expiresInHours: 24, allowedGroups: [], requiresApproval: true });
  const set = (c: string, f: Partial<Rule>) => setRules({ ...rules, [c]: { ...rules[c], ...f } });
  return <Card title="Change approval rules (owner)">
    <ul className="space-y-3 text-sm">{cats.map((c) => <li key={c} className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2"><input type="checkbox" checked={rules[c].enabled} onChange={(e) => set(c, { enabled: e.target.checked })} /><b>{CATEGORY[c]}</b></label>
      <select aria-label="Approver" value={rules[c].approver} onChange={(e) => set(c, { approver: e.target.value as Rule["approver"] })} className="rounded border border-ink/25 px-2 py-1"><option value="owner">approved by the owner</option><option value="super">approved by a Super Administrator</option></select>
      <label>expires after <input type="number" min={1} max={720} value={rules[c].expiresInHours} onChange={(e) => set(c, { expiresInHours: Number(e.target.value) })} className="w-20 rounded border border-ink/25 px-2 py-1" /> h</label>
    </li>)}</ul>
    <div className="mt-4 border-t border-ink/10 pt-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={rel.enabled} onChange={(e) => setRel({ ...rel, enabled: e.target.checked })} /><b>Allow releasing Paystack checkout attempts</b></label>
      <p className="mt-2 text-ink/70">Groups allowed to release (the owner always can once this is on):</p>
      <div className="flex flex-wrap gap-3">{GROUPS.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={rel.allowedGroups.includes(k)} onChange={(e) => setRel({ ...rel, allowedGroups: e.target.checked ? [...rel.allowedGroups, k] : rel.allowedGroups.filter((g) => g !== k) })} />{l}</label>)}</div>
      <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={rel.requiresApproval} onChange={(e) => setRel({ ...rel, requiresApproval: e.target.checked })} />Each release needs a second person&apos;s approval</label>
      <div className="mt-2 flex flex-wrap gap-3"><select aria-label="Release approver" value={rel.approver} onChange={(e) => setRel({ ...rel, approver: e.target.value as Rule["approver"] })} className="rounded border border-ink/25 px-2 py-1"><option value="owner">approved by the owner</option><option value="super">approved by a Super Administrator</option></select>
        <label>expires after <input type="number" min={1} max={720} value={rel.expiresInHours} onChange={(e) => setRel({ ...rel, expiresInHours: Number(e.target.value) })} className="w-20 rounded border border-ink/25 px-2 py-1" /> h</label></div>
    </div>
    <div className="mt-4"><Btn small disabled={busy} onClick={() => { if (confirm("Save these approval rules? Each change is recorded in the audit log.")) run(() => api("/api/app/owner/approval-policy", { method: "PUT", body: { categories: rules, paymentRelease: rel.enabled || o.policies.approvals.paymentRelease ? rel : null } }), "Approval rules saved.", reload); }}>Save approval rules</Btn></div>
    <Msg text={msg.text} kind={msg.kind} />
  </Card>;
}

function History({ o }: { o: Overview }) {
  const people = useLoad<{ users: { id: string; fullName: string; role: string }[] }>("/api/app/admin/users?limit=100");
  const [id, setId] = useState("");
  const h = useLoad<{ user: { fullName: string; role: string; adminRole: string | null; status: string; removedAt: string | null }; assignments: { department_slug: string; position: string; created_at: string; ended_at: string | null; end_reason: string | null }[]; history: { at: string; action: string; actor_name: string | null; detail: Record<string, unknown> | null }[] }>(id ? `/api/app/admin/users/${id}/access-history` : null);
  return <Card title="Access history">
    <Field label="Staff member"><select value={id} onChange={(e) => setId(e.target.value)} className={inputCls}><option value="">Choose…</option>{(people.data?.users ?? []).filter((u) => u.role !== "student").map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
    {h.error && <Msg text={h.error} />}
    {h.data && <div className="mt-4 space-y-3 text-sm">
      <p><b>{h.data.user.fullName}</b> · {h.data.user.role === "admin" ? groupName(h.data.user.adminRole) : h.data.user.role} · <Badge s={h.data.user.removedAt ? "removed" : h.data.user.status} /></p>
      <div><b>Departments</b>{!h.data.assignments.length ? <Empty>None.</Empty> : <ul>{h.data.assignments.map((a, i) => <li key={i}>{o.departments.find((d) => d.slug === a.department_slug)?.name ?? a.department_slug} ({a.position}) from {when(a.created_at)}{a.ended_at ? ` to ${when(a.ended_at)}: ${a.end_reason ?? ""}` : ", current"}</li>)}</ul>}</div>
      <div><b>Changes</b>{!h.data.history.length ? <Empty>No access changes recorded.</Empty> : <ul>{h.data.history.map((e, i) => <li key={i}>{when(e.at)} · {e.action} · {e.actor_name ?? "system"}{e.detail && typeof e.detail.reason === "string" ? ` · ${e.detail.reason}` : ""}</li>)}</ul>}</div>
    </div>}
  </Card>;
}

function MyDepartment() {
  const { data, error } = useLoad<{ departments: { slug: string; name: string; purpose: string | null; position: string; since: string; roster?: { fullName: string; position: string; role: string; adminRole: string | null; status: string; since: string }[] }[] }>("/api/app/admin/department");
  if (error) return <Card><Msg text={error} /></Card>;
  if (!data) return <Card><Empty>Loading…</Empty></Card>;
  if (!data.departments.length) return <Card title="My department"><Empty>You are not assigned to a department.</Empty></Card>;
  return <div className="space-y-5">{data.departments.map((d) => <Card key={d.slug} title={d.name}>
    <p className="text-sm text-ink/70">{d.position === "head" ? "You head this department." : "You are a member of this department."} Since {when(d.since)}.{d.purpose ? ` ${d.purpose}` : ""}</p>
    {d.roster && <table className="mt-3 w-full text-left text-sm"><thead className="text-ink/60"><tr><th className="py-2 pr-3">Name</th><th className="pr-3">Position</th><th className="pr-3">Group</th><th>Status</th></tr></thead>
      <tbody>{d.roster.map((r, i) => <tr key={i} className="border-t border-ink/10"><td className="py-2 pr-3">{r.fullName}</td><td className="pr-3">{r.position === "head" ? "Head" : "Staff"}</td><td className="pr-3">{r.role === "instructor" ? "Instructor" : groupName(r.adminRole)}</td><td><Badge s={r.status} /></td></tr>)}</tbody></table>}
  </Card>)}</div>;
}

"use client";
// The owner console (Stage 2B, hardened in Stage 2C): only the verified owner sees this (the account fixed at set-up whose
// email is OWNER_EMAIL), only after signing in with the authenticator code, and the server refuses every action here to
// anyone else. Set-up, legacy administrator review, groups, permanent access revocation, removal approvals, audit log.
import { useState } from "react";
import { api, Btn, Card, Empty, inputCls, Msg, useAction, useLoad, when } from "./ui";

const GROUPS: [string, string][] = [["super", "Super Administrator"], ["admissions", "Admissions"], ["finance", "Finance"], ["academic", "Academic Administration"],
  ["faculty", "Faculty Management"], ["support", "Student Support"], ["reporting", "Read-only Reporting"]];
type Staff = { id: string; email: string; fullName: string; role: string; status: string; adminRole: string | null; staffNo: string | null; lastLoginAt: string | null;
  removedAt: string | null; removalReason: string | null; mfa: boolean; owner: boolean };
type Req = { id: string; user_id: string; user_name: string; user_email: string; user_role: string; requester_name: string; reason: string; status: string; decision_note: string | null; created_at: string; decided_at: string | null };

type Status = { ownerConfigured: boolean; isOwner: boolean; state: string; strongSession: boolean; bootstrapped: boolean; bootstrappedAt: string | null;
  pendingRemovals?: number; unassignedAdmins?: number; policy?: { restrictUnassigned: boolean } };
const STATE_PROBLEM: Record<string, string> = {
  mismatch: "The owner email in the server settings (OWNER_EMAIL) no longer matches the account fixed at owner set-up, so nobody is treated as the owner. Restore the setting, or follow the documented owner-transfer procedure.",
  record_missing: "The owner set-up record is missing although the audit log shows set-up was completed, so nobody is treated as the owner. Restore it from a database backup.",
  no_account: "The owner's account is missing, suspended or removed, so nobody is treated as the owner.",
  migration_required: "The database needs its latest update (migration 0010) before the owner console can be used.",
  unconfigured: "No owner is configured (OWNER_EMAIL is not set).",
};

export function OwnerConsole() {
  const st = useLoad<Status>("/api/app/owner/status");
  const { busy, msg, run } = useAction();
  if (!st.data) return <Empty>Loading…</Empty>;
  if (!st.data.isOwner) return <Card title="Owner console"><p className="text-sm">Only the platform owner can open this page.</p>{STATE_PROBLEM[st.data.state] && st.data.state !== "unconfigured" && <p className="mt-2 text-sm text-brand-red">{STATE_PROBLEM[st.data.state]}</p>}</Card>;
  if (!st.data.strongSession) return (
    <Card title="Owner console: two-step sign-in needed">
      <div className="space-y-2 text-sm">
        <p>The owner console, set-up, administrator groups, removals and the audit log only open after you sign in with your authenticator code. An email link alone is never enough.</p>
        <p>Open <b>Security</b> and turn on two-step sign-in (the authenticator app). If it is already on, sign out and sign in again, then enter the code.</p>
      </div>
    </Card>
  );
  return (
    <div className="space-y-6">
      <Card title="Owner set-up">
        {st.data.bootstrapped ? (
          <p className="text-sm">Complete since {when(st.data.bootstrappedAt!)}. Your account is fixed as the owner and you are the Super Administrator. You can appoint other Super Administrators; they can assign every other group, but only you can appoint or change a Super Administrator, and only you can revoke staff access permanently.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Until set-up is complete, nobody can assign administrator groups. Existing administrators keep their current day-to-day access, but cannot manage administrators.</p>
            <p>Complete set-up to fix your account as the owner and become the Super Administrator. This can be done once, and only by you.</p>
            <Btn disabled={busy} onClick={() => run(() => api("/api/app/owner/bootstrap", { method: "POST" }), "Set-up complete. You are now the Super Administrator.", st.reload)}>Complete owner set-up</Btn>
          </div>
        )}
        <Msg text={msg.text} kind={msg.kind} />
      </Card>
      <LegacyReview bootstrapped={st.data.bootstrapped} onChange={st.reload} />
      <StaffPanel bootstrapped={st.data.bootstrapped} />
      <Requests onChange={st.reload} />
      <AuditSearch />
    </div>
  );
}

// Administrators created before groups existed have no group. The owner reviews each one and assigns a group explicitly;
// nothing is assigned automatically. Optionally, the owner can make unassigned administrators read-only meanwhile.
function LegacyReview({ bootstrapped, onChange }: { bootstrapped: boolean; onChange: () => void }) {
  const d = useLoad<{ admins: { id: string; email: string; fullName: string; lastLoginAt: string | null; status: string }[]; policy: { restrictUnassigned: boolean } }>("/api/app/owner/legacy-admins");
  const { busy, msg, run } = useAction();
  if (!d.data) return null;
  const restricted = d.data.policy.restrictUnassigned;
  return (
    <Card title={d.data.admins.length ? `Review needed: ${d.data.admins.length} administrator${d.data.admins.length === 1 ? "" : "s"} without a group` : "Administrator groups: all assigned"}>
      {d.data.admins.length ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-xl border border-brand-orange/40 bg-white px-4 py-3">These administrators were created before permission groups existed. {restricted
            ? "They are currently limited to read-only access until you assign them a group."
            : "They still have broad day-to-day access (students, instructors, payments, timetables, settings), although they cannot manage other administrators. Review each one and assign the group that matches their job."}</p>
          <ul className="divide-y divide-ink/[0.07]">{d.data.admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span><b className="font-semibold">{a.fullName}</b> <span className="text-ink/65">{a.email} · last sign-in {a.lastLoginAt ? when(a.lastLoginAt) : "never"}</span></span>
              <select aria-label={`Group for ${a.fullName}`} defaultValue="" disabled={busy || !bootstrapped} className={`${inputCls} mt-0 w-auto py-1`}
                onChange={(e) => e.target.value && run(() => api(`/api/app/admin/users/${a.id}`, { method: "PATCH", body: { adminRole: e.target.value } }), "Group assigned; that person was signed out so it applies at once.", () => { d.reload(); onChange(); })}>
                <option value="">Choose a group…</option>
                {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </li>))}</ul>
          {!bootstrapped && <p className="text-ink/70">Complete the owner set-up first.</p>}
        </div>
      ) : <p className="text-sm">Every administrator has a group.</p>}
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={restricted} disabled={busy} className="mt-0.5 h-4 w-4 accent-indigo"
          onChange={(e) => run(() => api("/api/app/owner/policy", { method: "PUT", body: { restrictUnassigned: e.target.checked } }), e.target.checked ? "Unassigned administrators are now read-only." : "Restriction removed.", () => { d.reload(); onChange(); })} />
        <span>Make administrators without a group read-only until a group is assigned (recommended once you have reviewed the list).</span>
      </label>
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

type Reassign = { enrolmentId: string; programme: string; student: string; futureClasses: number };
const REVOKE_TEXT = "This permanently REVOKES ACCESS: the person can never sign in again, every session and sign-in link ends, and two-step sign-in is removed. It does NOT delete data: their students, classes, attendance, assignments, grades, payments, messages and the audit log are all kept.";
const afterRevoke = (r: { reassign?: Reassign[] }) => {
  if (r.reassign?.length) alert(`Access revoked. This instructor still teaches ${r.reassign.length} enrolment(s); assign a new instructor in Academics > Enrolments:\n\n${r.reassign.map((x) => `• ${x.student} (${x.programme}), ${x.futureClasses} upcoming class(es)`).join("\n")}\n\nUntil then they receive no emails about these classes.`);
};

function StaffPanel({ bootstrapped }: { bootstrapped: boolean }) {
  const d = useLoad<{ staff: Staff[] }>("/api/app/owner/staff");
  const { busy, msg, run } = useAction();
  const [showRemoved, setShowRemoved] = useState(false);
  if (d.error) return <Msg text={d.error} />;
  const rows = (d.data?.staff ?? []).filter((s) => showRemoved || !s.removedAt);
  const remove = (s: Staff) => {
    const reason = prompt(`Revoke access permanently for ${s.fullName} (${s.email})?\n\n${REVOKE_TEXT}\n\nReason (required, recorded in the audit log):`);
    if (reason && reason.trim()) run(async () => afterRevoke(await api<{ reassign?: Reassign[] }>(`/api/app/owner/users/${s.id}/remove`, { method: "POST", body: { reason } })), "Access revoked permanently. Records kept.", d.reload);
  };
  return (
    <Card title="Staff, groups and permissions" action={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} className="h-4 w-4 accent-indigo" />Show removed</label>}>
      {!d.data ? <Empty>Loading…</Empty> : (
        <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[52rem] text-left text-sm">
          <thead><tr className="border-b border-ink/10 text-ink/70">{["Name", "Role", "Group", "Two-step", "Last sign-in", "Status", ""].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id} className="border-b border-ink/[0.06] align-top last:border-0">
              <td className="px-2 py-2.5"><b className="font-semibold">{s.fullName}</b>{s.owner && <span className="ml-2 rounded bg-indigo px-1.5 py-0.5 text-[11px] font-semibold text-white">Owner</span>}<span className="block text-ink/65">{s.email}</span></td>
              <td className="px-2 py-2.5 capitalize">{s.role}</td>
              <td className="px-2 py-2.5">{s.role !== "admin" ? "–" : s.owner ? "Super Administrator (owner)" : s.removedAt ? (s.adminRole ?? "–") : (
                <select aria-label={`Group for ${s.fullName}`} value={s.adminRole ?? ""} disabled={busy || !bootstrapped} className={`${inputCls} mt-0 w-auto py-1`}
                  onChange={(e) => e.target.value && run(() => api(`/api/app/admin/users/${s.id}`, { method: "PATCH", body: { adminRole: e.target.value } }), "Group saved; that person was signed out so it applies at once.", d.reload)}>
                  {!s.adminRole && <option value="">Not assigned</option>}
                  {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>)}</td>
              <td className="px-2 py-2.5">{s.role === "admin" ? (s.mfa ? "On" : "Off") : "–"}</td>
              <td className="px-2 py-2.5 text-ink/70">{s.lastLoginAt ? when(s.lastLoginAt) : "Never"}</td>
              <td className="px-2 py-2.5">{s.removedAt ? <span className="text-brand-red">Removed {when(s.removedAt)}<span className="block text-ink/65">{s.removalReason}</span></span> : s.status}</td>
              <td className="space-y-1 px-2 py-2.5 text-right">{!s.owner && !s.removedAt && <>
                {s.status === "active"
                  ? <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/users/${s.id}`, { method: "PATCH", body: { status: "suspended" } }), "Suspended.", d.reload)}>Suspend</Btn>
                  : <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/users/${s.id}`, { method: "PATCH", body: { status: "active" } }), "Reactivated.", d.reload)}>Reactivate</Btn>}
                <Btn small kind="ghost" disabled={busy} onClick={() => remove(s)}>Revoke access permanently</Btn>
                {s.role === "admin" && <Btn small kind="ghost" disabled={busy} onClick={() => { if (confirm(`Reset two-step sign-in for ${s.fullName}? They will be signed out and must set it up again.`)) run(() => api(`/api/app/admin/users/${s.id}/mfa-reset`, { method: "POST" }), "Two-step sign-in reset.", d.reload); }}>Reset two-step</Btn>}
              </>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {!bootstrapped && <p className="mt-3 text-sm text-ink/70">Groups can be assigned after the owner set-up above.</p>}
      <p className="mt-3 text-sm text-ink/70">“Revoke access permanently” closes the account; it never deletes records. Physical deletion of personal data happens only on a verified request, by hand, and is not available here.</p>
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

function Requests({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState("pending");
  const d = useLoad<{ requests: Req[] }>(`/api/app/owner/removal-requests?status=${status}`);
  const { busy, msg, run } = useAction();
  const decide = (r: Req, decision: "approve" | "reject") => {
    const note = prompt(decision === "approve" ? `Approve the permanent revocation of access for ${r.user_name}?\n\n${REVOKE_TEXT}\n\nOptional note:` : `Reject the request to remove ${r.user_name}? Optional note:`);
    if (note !== null) run(async () => afterRevoke(await api<{ reassign?: Reassign[] }>(`/api/app/owner/removal-requests/${r.id}`, { method: "POST", body: { decision, note } })), decision === "approve" ? "Approved: access revoked permanently. Records kept." : "Rejected.", () => { d.reload(); onChange(); });
  };
  return (
    <Card title="Permanent access revocation requests" action={<select aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} mt-0 w-auto py-1`}><option value="pending">Waiting for you</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>}>
      {!d.data ? <Empty>Loading…</Empty> : !d.data.requests.length ? <Empty>No requests.</Empty> : (
        <ul className="divide-y divide-ink/[0.07] text-sm">{d.data.requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div><b className="font-semibold">{r.user_name}</b> <span className="text-ink/65">({r.user_role}, {r.user_email})</span>
              <p className="text-ink/75">Requested by {r.requester_name} on {when(r.created_at)}: “{r.reason}”</p>
              {r.decision_note && <p className="text-ink/65">Your note: {r.decision_note}</p>}</div>
            {r.status === "pending" && <div className="flex gap-2"><Btn small disabled={busy} onClick={() => decide(r, "approve")}>Approve removal</Btn><Btn small kind="ghost" disabled={busy} onClick={() => decide(r, "reject")}>Reject</Btn></div>}
          </li>))}</ul>
      )}
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

function AuditSearch() {
  const [f, setF] = useState({ actor: "", action: "", target: "" });
  const [q, setQ] = useState("");
  const d = useLoad<{ entries: Record<string, string>[] }>(`/api/app/owner/audit?limit=200${q}`);
  return (
    <Card title="Audit log">
      <form className="mb-4 grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); setQ(Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => `&${k}=${encodeURIComponent(v.trim())}`).join("")); }}>
        <input aria-label="Person (email or ID)" placeholder="Person: email or ID" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} className={`${inputCls} mt-0`} />
        <input aria-label="Action starts with" placeholder="Action, e.g. admin. or mfa." value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} className={`${inputCls} mt-0`} />
        <input aria-label="Affected record ID" placeholder="Affected record ID" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} className={`${inputCls} mt-0`} />
        <Btn small type="submit">Search</Btn>
      </form>
      {!d.data ? <Empty>Loading…</Empty> : !d.data.entries.length ? <Empty>No matching entries.</Empty> : (
        <div className="relative -mx-2 max-h-[32rem] overflow-auto"><table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="sticky top-0 bg-white"><tr className="border-b border-ink/10 text-ink/70">{["When", "Who", "Action", "Record", "Details"].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{d.data.entries.map((a) => (
            <tr key={a.id} className="border-b border-ink/[0.06] align-top last:border-0">
              <td className="whitespace-nowrap px-2 py-2">{when(a.at)}</td>
              <td className="px-2 py-2">{a.actor_name ?? "System"}<span className="block text-ink/60">{a.actor_email ?? ""}</span></td>
              <td className="px-2 py-2 font-mono text-xs">{a.action}</td>
              <td className="px-2 py-2 font-mono text-xs">{a.target_type ? `${a.target_type} ${a.target_id ?? ""}` : ""}</td>
              <td className="max-w-[22rem] break-words px-2 py-2 font-mono text-xs text-ink/70">{a.detail ?? ""}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

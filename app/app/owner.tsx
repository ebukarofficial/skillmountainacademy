"use client";
// The owner console (Stage 2B): only the account set as OWNER_EMAIL sees this, and the server refuses every action here
// to anyone else. Set-up, administrator groups, permanent removals, removal approvals and the full audit log.
import { useState } from "react";
import { api, Btn, Card, Empty, inputCls, Msg, useAction, useLoad, when } from "./ui";

const GROUPS: [string, string][] = [["super", "Super Administrator"], ["admissions", "Admissions"], ["finance", "Finance"], ["academic", "Academic Administration"],
  ["faculty", "Faculty Management"], ["support", "Student Support"], ["reporting", "Read-only Reporting"]];
type Staff = { id: string; email: string; fullName: string; role: string; status: string; adminRole: string | null; staffNo: string | null; lastLoginAt: string | null;
  removedAt: string | null; removalReason: string | null; mfa: boolean; owner: boolean };
type Req = { id: string; user_id: string; user_name: string; user_email: string; user_role: string; requester_name: string; reason: string; status: string; decision_note: string | null; created_at: string; decided_at: string | null };

export function OwnerConsole() {
  const st = useLoad<{ ownerConfigured: boolean; isOwner: boolean; bootstrapped: boolean; bootstrappedAt: string | null; pendingRemovals?: number }>("/api/app/owner/status");
  const { busy, msg, run } = useAction();
  if (!st.data) return <Empty>Loading…</Empty>;
  if (!st.data.isOwner) return <Card title="Owner console"><p className="text-sm">Only the platform owner can open this page.</p></Card>;
  return (
    <div className="space-y-6">
      <Card title="Owner set-up">
        {st.data.bootstrapped ? (
          <p className="text-sm">Complete since {when(st.data.bootstrappedAt!)}. You are the Super Administrator. You can appoint other Super Administrators; they can assign every other group, but only you can appoint or change a Super Administrator, and only you can remove staff permanently.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Until set-up is complete, nobody can assign administrator groups. Existing administrators keep their current day-to-day access, but cannot manage administrators.</p>
            <p>Complete set-up to become the Super Administrator. This can be done once, and only by you.</p>
            <Btn disabled={busy} onClick={() => run(() => api("/api/app/owner/bootstrap", { method: "POST" }), "Set-up complete. You are now the Super Administrator.", st.reload)}>Complete owner set-up</Btn>
          </div>
        )}
        <Msg text={msg.text} kind={msg.kind} />
      </Card>
      <StaffPanel bootstrapped={st.data.bootstrapped} />
      <Requests onChange={st.reload} />
      <AuditSearch />
    </div>
  );
}

function StaffPanel({ bootstrapped }: { bootstrapped: boolean }) {
  const d = useLoad<{ staff: Staff[] }>("/api/app/owner/staff");
  const { busy, msg, run } = useAction();
  const [showRemoved, setShowRemoved] = useState(false);
  if (d.error) return <Msg text={d.error} />;
  const rows = (d.data?.staff ?? []).filter((s) => showRemoved || !s.removedAt);
  const remove = (s: Staff) => {
    const reason = prompt(`Permanently remove ${s.fullName} (${s.email})? Their sign-in is closed for good; their records are kept. Reason:`);
    if (reason && reason.trim()) run(async () => { const r = await api<{ activeEnrolmentsToReassign: number }>(`/api/app/owner/users/${s.id}/remove`, { method: "POST", body: { reason } }); if (r.activeEnrolmentsToReassign) alert(`${r.activeEnrolmentsToReassign} active enrolment(s) still name this instructor. Reassign them in Instructor allocation.`); }, "Account removed.", d.reload);
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
                <Btn small kind="ghost" disabled={busy} onClick={() => remove(s)}>Remove permanently</Btn>
                {s.role === "admin" && <Btn small kind="ghost" disabled={busy} onClick={() => { if (confirm(`Reset two-step sign-in for ${s.fullName}? They will be signed out and must set it up again.`)) run(() => api(`/api/app/admin/users/${s.id}/mfa-reset`, { method: "POST" }), "Two-step sign-in reset.", d.reload); }}>Reset two-step</Btn>}
              </>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {!bootstrapped && <p className="mt-3 text-sm text-ink/70">Groups can be assigned after the owner set-up above.</p>}
      <p className="mt-3 text-sm text-ink/70">Students can also be removed: find them under Students and use Remove there, or search the audit log by their ID.</p>
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

function Requests({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState("pending");
  const d = useLoad<{ requests: Req[] }>(`/api/app/owner/removal-requests?status=${status}`);
  const { busy, msg, run } = useAction();
  const decide = (r: Req, decision: "approve" | "reject") => {
    const note = prompt(decision === "approve" ? `Approve permanent removal of ${r.user_name}? Optional note:` : `Reject the request to remove ${r.user_name}? Optional note:`);
    if (note !== null) run(() => api(`/api/app/owner/removal-requests/${r.id}`, { method: "POST", body: { decision, note } }), decision === "approve" ? "Approved; the account is removed." : "Rejected.", () => { d.reload(); onChange(); });
  };
  return (
    <Card title="Permanent removal requests" action={<select aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} mt-0 w-auto py-1`}><option value="pending">Waiting for you</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>}>
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

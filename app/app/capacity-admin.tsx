"use client";
// Instructor allocation (Expansion Stage C): the capacity report with the read-only exception analysis, and the
// one-on-one instructor picker that shows the server's verdict (eligible / blocked with reasons / warnings) before an
// assignment is confirmed. Every assignment is checked again by the server when it is submitted.
import { useState } from "react";
import { api, Badge, Btn, Card, Empty, Field, inputCls, Msg, useAction, useLoad } from "./ui";

type Issue = { code: string; message: string };
type Option = { id: string; name: string; current: boolean; ok: boolean; blocks: Issue[]; warnings: Issue[];
  capacity: { programmeLoad: number; programmeLimit: number; limitSource: string; totalLoad: number; available: number } | null };
type Policy = { status: string; standardPerInstructor: number | null; maximumPerInstructor: number | null; enforce: boolean };
type Prog = { slug: string; name: string; lifecycle: string; eligible: boolean; maxStudents: number | null; limit: number | null; active: number; utilisation: number | null; available: number; atCapacity: boolean; overLimit: boolean };
type Row = { id: string; name: string; status: string; verification: string; approvedActive: boolean; programmes: Prog[]; activeStudents: number; historicalStudents: number;
  flags: { atCapacity: boolean; overConfigured: boolean; overProposedStandard: boolean; overPolicyStandard: boolean; inactiveWithStudents: boolean } };
type Section = { count: number; items: Record<string, unknown>[] };
type Report = { policy: Policy; proposal: { standardPerInstructor: number; maximumPerInstructor: number; status: string }; instructors: Row[]; exceptions: Record<string, Section | string | boolean> };

const policyText = (p: Policy) => p.status === "not_set"
  ? "No capacity policy has been approved yet (owner decision D-11). Each instructor's limit is their own figure for a programme, or the programme's default; going over it is a warning, not a block."
  : `${p.status === "approved" ? "Approved" : "Pending approval"} policy: standard ${p.standardPerInstructor ?? "not set"}, maximum ${p.maximumPerInstructor ?? "not set"} students per instructor. ${p.enforce ? "Limits are enforced." : "Not enforced: warnings only."}`;

const EXCEPTIONS: [string, string][] = [
  ["aboveProposedStandard", "Instructors above the proposed 20-student standard (proposal only)"],
  ["aboveConfiguredMaximum", "Instructors above their configured limit for a programme"],
  ["assignedWithoutEligibility", "Students assigned to an instructor not approved for that programme"],
  ["assignedToUnapprovedOrInactive", "Instructors not approved or not active who still have students"],
  ["multipleCurrentEnrolmentsSameProgramme", "Students with more than one current enrolment on the same programme"],
  ["awaitingInstructor", "Active enrolments without an instructor"],
];

export function CapacityReport() {
  const { data, error } = useLoad<Report>("/api/app/admin/capacity");
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <Card title="Instructor capacity"><Msg text={error} /></Card>;
  if (!data) return <Card title="Instructor capacity"><Empty>Loading…</Empty></Card>;
  return (
    <div className="space-y-5">
      <Card title="Instructor capacity">
        <p className="text-sm text-ink/70">{policyText(data.policy)} The proposal of {data.proposal.standardPerInstructor} standard and {data.proposal.maximumPerInstructor} maximum is shown for review only ({data.proposal.status}).</p>
        {!data.instructors.length ? <Empty>No instructors yet.</Empty> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink/60"><tr><th className="py-2 pr-3">Instructor</th><th className="pr-3">Programme</th><th className="pr-3">Students</th><th className="pr-3">Limit</th><th className="pr-3">Used</th><th className="pr-3">Places left</th><th>Notes</th></tr></thead>
              <tbody>
                {data.instructors.flatMap((r) => (r.programmes.length ? r.programmes : [null]).map((p, i) => (
                  <tr key={`${r.id}-${p?.slug ?? "none"}`} className="border-t border-ink/10 align-top">
                    <td className="py-2 pr-3">{i === 0 && <><b>{r.name}</b>{!r.approvedActive && <span className="ml-2"><Badge s={r.status !== "active" ? r.status : r.verification} /></span>}
                      <span className="block text-xs text-ink/55">{r.activeStudents} current · {r.historicalStudents} past</span></>}</td>
                    <td className="pr-3">{p ? p.name : <span className="text-ink/50">no programmes</span>}{p && p.lifecycle !== "published" && <span className="ml-1 text-xs text-ink/55">({p.lifecycle})</span>}</td>
                    <td className="pr-3">{p?.active ?? 0}</td>
                    <td className="pr-3">{p?.limit ?? "—"}{p && p.maxStudents === null && p.limit !== null && <span className="block text-xs text-ink/50">default</span>}</td>
                    <td className="pr-3">{p?.utilisation != null ? `${p.utilisation}%` : "—"}</td>
                    <td className="pr-3">{p && p.limit !== null ? p.available : "—"}</td>
                    <td className="text-xs">{p && !p.eligible && <span className="text-brand-red">not approved for this programme</span>}{p?.overLimit ? <span className="text-brand-red">over limit</span> : p?.atCapacity ? "at capacity" : ""}
                      {i === 0 && r.flags.overProposedStandard && <span className="block text-ink/60">above proposed standard</span>}{i === 0 && r.flags.inactiveWithStudents && <span className="block text-brand-red">has students but is not approved and active</span>}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Capacity exceptions (read-only)">
        <p className="mb-3 text-sm text-ink/70">Nothing here is changed automatically. Records stay as they are until the owner approves a correction.</p>
        <ul className="divide-y divide-ink/10">
          {EXCEPTIONS.map(([k, label]) => {
            const s = data.exceptions[k] as Section;
            return (
              <li key={k} className="py-2 text-sm">
                <button type="button" className="flex w-full justify-between text-left" onClick={() => setOpen(open === k ? null : k)} disabled={!s.count}>
                  <span>{label}</span><b className={s.count ? "text-brand-red" : "text-ink/50"}>{s.count}</b>
                </button>
                {open === k && <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink/[0.04] p-3 text-xs">{JSON.stringify(s.items, null, 2)}</pre>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

// The instructor picker for one enrolment (or for a new enrolment: programme + student).
export function AssignInstructor({ enrolmentId, currentInstructorId, onDone }: { enrolmentId: string; currentInstructorId: string | null; onDone: () => void }) {
  const { data, error } = useLoad<{ options: Option[]; policy: Policy }>(`/api/app/admin/assignment-options?enrolmentId=${encodeURIComponent(enrolmentId)}`);
  const [pick, setPick] = useState<string>(currentInstructorId ?? "");
  const [reason, setReason] = useState("");
  const act = useAction();
  if (error) return <Msg text={error} />;
  if (!data) return <Empty>Checking instructors…</Empty>;
  const chosen = data.options.find((o) => o.id === pick);
  const changing = pick !== (currentInstructorId ?? "");
  const needsReason = changing && !!currentInstructorId;
  return (
    <div className="space-y-2">
      <Field label="Instructor">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={inputCls}>
          <option value="">Not assigned</option>
          {data.options.map((o) => <option key={o.id} value={o.id} disabled={!o.ok && !o.current}>
            {o.name}{o.current ? " (current)" : ""} · {o.capacity ? `${o.capacity.programmeLoad}/${o.capacity.programmeLimit}` : ""}{!o.ok ? " · not available" : o.warnings.length ? " · check warnings" : ""}
          </option>)}
        </select>
      </Field>
      {chosen && (chosen.blocks.length > 0 || chosen.warnings.length > 0) && (
        <ul className="space-y-1 text-xs">
          {chosen.blocks.map((b) => <li key={b.code} className="text-brand-red">Blocked: {b.message}</li>)}
          {chosen.warnings.map((w) => <li key={w.code} className="text-ink/70">Warning: {w.message}</li>)}
        </ul>
      )}
      {needsReason && <Field label="Reason for the change (recorded)"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>}
      <Btn small disabled={act.busy || !changing || (needsReason && !reason.trim()) || (!!chosen && !chosen.ok)}
        onClick={() => act.run(() => api(`/api/app/admin/enrolments/${enrolmentId}`, { method: "PATCH", body: { instructorId: pick || null, ...(needsReason ? { reason } : {}) } }), "Instructor saved. Classes, coursework and records stay with the student.", onDone)}>
        Save instructor
      </Btn>
      <Msg text={act.msg.text} kind={act.msg.kind} />
    </div>
  );
}

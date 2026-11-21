"use client";
// Admissions desk for administrators: call requests from "Book a call", and the admissions assistant's questions.
import { useState } from "react";
import { api, Badge, Btn, Card, Empty, inputCls, Msg, useAction, useLoad, when } from "./ui";

type Booking = { id: string; name: string; email: string; phone: string; programme: string | null; preferredDate: string; preferredTime: string; timezone: string; reason: string;
  status: "new" | "assigned" | "contacted" | "closed"; assignedTo: string | null; assigneeName: string | null; notes: string | null; createdAt: string };

export function CallRequests() {
  const [filter, setFilter] = useState("");
  const d = useLoad<{ bookings: Booking[]; staff: { id: string; name: string }[] }>(`/api/app/admin/bookings${filter ? `?status=${filter}` : ""}`);
  const { busy, msg, run } = useAction();
  const save = (id: string, body: Record<string, unknown>, text: string) => run(() => api(`/api/app/admin/bookings/${id}`, { method: "PATCH", body }), text, d.reload);
  return (
    <Card title="Call requests" action={
      <label className="text-sm"><span className="sr-only">Show</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm">
          <option value="">All requests</option><option value="new">New</option><option value="assigned">Assigned</option><option value="contacted">Contacted</option><option value="closed">Closed</option>
        </select></label>}>
      <Msg text={msg.text} kind={msg.kind} />
      {d.data && !d.data.bookings.length && <Empty>No call requests yet. Requests made with &ldquo;Book a call&rdquo; on the website appear here.</Empty>}
      <ul className="divide-y divide-ink/10">
        {d.data?.bookings.map((b) => (
          <li key={b.id} className="grid gap-3 py-4 lg:grid-cols-[1.4fr_1fr_1fr]">
            <div className="min-w-0 text-sm">
              <p className="flex flex-wrap items-center gap-2"><b className="text-base">{b.name}</b><Badge s={b.status} /></p>
              <p className="text-ink/70"><a href={`mailto:${b.email}`} className="underline">{b.email}</a> · <a href={`tel:${b.phone}`} className="underline">{b.phone}</a></p>
              <p className="mt-1"><b>{b.preferredDate}</b> at <b>{b.preferredTime}</b> <span className="text-ink/60">({b.timezone.replace(/_/g, " ")})</span></p>
              <p className="text-ink/70">{b.programme ?? "Programme not decided"} · requested {when(b.createdAt)}</p>
              <p className="mt-1 whitespace-pre-line text-ink/85">{b.reason}</p>
            </div>
            <div className="space-y-2 text-sm">
              <label className="block font-semibold">Assigned to
                <select value={b.assignedTo ?? ""} disabled={busy} onChange={(e) => save(b.id, { assignedTo: e.target.value || null }, "Assignment saved.")} className={inputCls}>
                  <option value="">Not assigned</option>
                  {d.data?.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="block font-semibold">Status
                <select value={b.status} disabled={busy} onChange={(e) => save(b.id, { status: e.target.value }, "Status saved.")} className={inputCls}>
                  <option value="new">New</option><option value="assigned">Assigned</option><option value="contacted">Contacted</option><option value="closed">Closed</option>
                </select>
              </label>
            </div>
            <form className="text-sm" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("notes") ?? ""); save(b.id, { notes: v }, "Notes saved."); }}>
              <label className="block font-semibold">Contact notes<textarea name="notes" rows={3} defaultValue={b.notes ?? ""} maxLength={2000} className={inputCls} placeholder="e.g. Called 14:05, discussed Cloud Engineering" /></label>
              <Btn small kind="ghost" type="submit" disabled={busy}>Save notes</Btn>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type Enquiry = { id: string; conversation: string; question: string; answer: string | null; programme: string | null; answered: boolean; needsFollowup: boolean; handledAt: string | null; createdAt: string };
export function AssistantEnquiries() {
  const [only, setOnly] = useState(false);
  const d = useLoad<{ enquiries: Enquiry[]; last30Days: { total: number; unanswered: number; followups_open: number; conversations: number } | null; retentionDays: number }>(`/api/app/admin/enquiries${only ? "?followup=1" : ""}`);
  const { busy, msg, run } = useAction();
  const s = d.data?.last30Days;
  return (
    <Card title="Admissions assistant: questions" action={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="accent-indigo" />Follow-ups only</label>}>
      {s && <p className="mb-4 text-sm text-ink/70">Last 30 days: <b>{s.total ?? 0}</b> questions in <b>{s.conversations ?? 0}</b> conversations · <b>{s.unanswered ?? 0}</b> not answered by the assistant · <b>{s.followups_open ?? 0}</b> follow-ups open. Questions are deleted after {d.data?.retentionDays} days.</p>}
      <Msg text={msg.text} kind={msg.kind} />
      {d.data && !d.data.enquiries.length && <Empty>No questions recorded.</Empty>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead><tr className="border-b border-ink/10 text-left text-ink/60"><th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">Question</th><th className="py-2 pr-3 font-medium">Programme</th><th className="py-2 pr-3 font-medium">Answered</th><th className="py-2 font-medium">Follow-up</th></tr></thead>
          <tbody className="divide-y divide-ink/10">
            {d.data?.enquiries.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="py-3 pr-3 text-ink/65">{when(e.createdAt)}<span className="block text-xs">Ref {e.conversation}</span></td>
                <td className="py-3 pr-3"><p className="font-semibold">{e.question}</p>{e.answer && <details className="mt-1 text-ink/70"><summary className="cursor-pointer text-xs font-semibold text-indigo">Assistant&apos;s reply</summary><p className="mt-1 whitespace-pre-line">{e.answer}</p></details>}</td>
                <td className="py-3 pr-3">{e.programme ?? "–"}</td>
                <td className="py-3 pr-3">{e.answered ? "Yes" : <span className="font-semibold text-brand-red">No</span>}</td>
                <td className="py-3">{e.needsFollowup ? (e.handledAt ? <span className="text-ink/60">Handled {when(e.handledAt)}</span> : <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/enquiries/${e.id}/handled`, { method: "POST" }), "Marked as handled.", d.reload)}>Mark handled</Btn>) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

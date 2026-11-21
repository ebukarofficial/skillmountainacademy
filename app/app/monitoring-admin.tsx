"use client";
// Admin: student monitoring (records, alerts, weekly checklist, internship phase), contact with students and authorised
// guardians (email from an editable template, call and attempt records), alert thresholds, and programme investment
// with the exchange rates the website uses.
import { useMemo, useState } from "react";
import { approx, money, type Currency } from "../../lib/pricing";
import { api, Avatar, Btn, Card, Empty, Field, inputCls, Msg, Stat, useAction, useLoad, when } from "./ui";
import { StaffWeekly } from "./weekly";

type Rec = {
  enrolmentId: string; studentId: string; fullName: string; studentNo: string | null; photo: string | null; programmeName: string; enrolmentStatus: string; progress: number; email: string; instructorName: string | null;
  sessions: { attended: number; missed: number; attendancePct: number | null }; marks: { average: number | null }; status: string; needsAttention: string[];
  phase: { phase: string; monthOf: string | null } | null; lastContactAt: string | null; weekly: { done: number; total: number } | null;
};
type Rules = { missedClasses: number; overdueAssignments: number; missedAssessments: number; averageBelow: number; inactiveDays: number };
const pct = (v: number | null) => (v === null ? "–" : `${v}%`);

export function Monitoring() {
  const d = useLoad<{ records: Rec[]; rules: Rules; weekStart: string }>("/api/app/admin/monitoring");
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Rec | null>(null);
  const rows = useMemo(() => (d.data?.records ?? []).filter((r) => (filter === "all" || r.needsAttention.length > 0) && (!q || `${r.fullName} ${r.studentNo ?? ""} ${r.programmeName}`.toLowerCase().includes(q.toLowerCase()))), [d.data, filter, q]);
  if (d.error) return <Msg text={d.error} />;
  if (!d.data) return <Empty>Loading student records…</Empty>;
  const all = d.data.records;
  const flagged = all.filter((r) => r.needsAttention.length).length;
  const avgAtt = all.filter((r) => r.sessions.attendancePct !== null);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active enrolments" value={all.length} />
        <Stat label="Need attention" value={flagged} tone={flagged ? "alert" : "plain"} />
        <Stat label="Average attendance" value={avgAtt.length ? `${Math.round(avgAtt.reduce((a, r) => a + (r.sessions.attendancePct ?? 0), 0) / avgAtt.length)}%` : "–"} />
        <Stat label="In internship" value={all.filter((r) => r.phase?.phase === "Internship").length} />
      </div>

      <Card title="Students" action={<div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or programme" aria-label="Search students" className="w-56 rounded-lg border border-ink/25 bg-white px-3 py-1.5 text-sm" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as "attention" | "all")} aria-label="Show" className="rounded-lg border border-ink/25 bg-white px-2 py-1.5 text-sm"><option value="attention">Needing attention</option><option value="all">All students</option></select>
      </div>}>
        {rows.length ? (
          <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[60rem] text-left text-[0.95rem]">
            <thead><tr className="border-b border-ink/10 text-sm text-ink/70">{["Student", "Programme and phase", "Progress", "Attendance", "Average", "This week", "Alerts", "Last contact", ""].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.enrolmentId} className="border-b border-ink/[0.06] align-top last:border-0">
                <td className="px-2 py-3"><div className="flex items-center gap-2.5"><Avatar src={r.photo} name={r.fullName} size={34} /><div><p className="font-semibold">{r.fullName}</p><p className="text-sm text-ink/65">{r.studentNo ?? "No number"}</p></div></div></td>
                <td className="px-2 py-3">{r.programmeName}<p className="text-sm text-ink/65">{r.phase ? `${r.phase.phase}${r.phase.monthOf ? `, ${r.phase.monthOf.toLowerCase()}` : ""}` : ""}{r.instructorName ? ` · ${r.instructorName}` : " · No instructor"}</p></td>
                <td className="px-2 py-3 font-semibold">{r.progress}%</td>
                <td className="px-2 py-3">{pct(r.sessions.attendancePct)}<p className="text-sm text-ink/65">{r.sessions.attended} attended, {r.sessions.missed} missed</p></td>
                <td className="px-2 py-3 font-semibold">{pct(r.marks.average)}</td>
                <td className="px-2 py-3">{r.weekly ? `${r.weekly.done}/${r.weekly.total}` : "–"}</td>
                <td className="px-2 py-3 text-sm">{r.needsAttention.length ? <ul className="space-y-0.5">{r.needsAttention.map((a) => <li key={a} className="flex gap-1.5"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-orange" aria-hidden="true" />{a}</li>)}</ul> : <span className="text-ink/60">None</span>}</td>
                <td className="px-2 py-3 text-sm text-ink/70">{r.lastContactAt ? when(r.lastContactAt) : "None recorded"}</td>
                <td className="px-2 py-3 text-right"><Btn small kind="ghost" onClick={() => setOpen(r)}>Open</Btn></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{filter === "attention" ? "No student currently meets an alert threshold." : "No students match."}</Empty>}
      </Card>

      {open && <StudentContact key={open.studentId} rec={open} onClose={() => { setOpen(null); d.reload(); }} />}
      <AlertSettings onSaved={d.reload} />
    </div>
  );
}

type Guardian = { name: string | null; relationship: string | null; email: string | null; phone: string | null; contactAuthorised: boolean; authorisationNote: string | null };
type LogRow = { id: string; target: string; channel: string; outcome: string; subject: string | null; summary: string | null; by_name: string | null; created_at: string };
const LABEL: Record<string, string> = { call: "Phone call", sms: "Text message", whatsapp: "WhatsApp", in_person: "In person", email: "Email", reached: "Reached", no_answer: "No answer", left_message: "Left a message", wrong_number: "Wrong number", sent: "Sent", failed: "Failed" };

function StudentContact({ rec, onClose }: { rec: Rec; onClose: () => void }) {
  const d = useLoad<{ student: { id: string; fullName: string; email: string; phone: string | null; studentNo: string | null }; guardian: Guardian; template: { subject: string; body: string }; log: LogRow[] }>(`/api/app/admin/students/${rec.studentId}/contact`);
  const mail = useAction(), call = useAction(), g = useAction();
  const [to, setTo] = useState<"student" | "guardian">("student");
  const [subject, setSubject] = useState<string | null>(null), [body, setBody] = useState<string | null>(null);
  const [auth, setAuth] = useState<boolean | null>(null);
  if (d.error) return <Msg text={d.error} />;
  if (!d.data) return <Card><Empty>Loading…</Empty></Card>;
  const { student, guardian, template, log } = d.data;
  const authorised = auth ?? guardian.contactAuthorised;
  const canGuardian = guardian.contactAuthorised && !!guardian.email;
  return (
    <section aria-label={`Contact ${student.fullName}`} className="rounded-xl border border-indigo/30 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3"><Avatar src={rec.photo} name={student.fullName} size={48} /><div><h2 className="font-display text-xl font-semibold">{student.fullName}</h2><p className="text-sm text-ink/70">{student.studentNo ?? ""} · {student.email}{student.phone ? ` · ${student.phone}` : ""}</p></div></div>
        <Btn small kind="ghost" onClick={onClose}>Close</Btn>
      </div>

      <div className="mt-6 grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
        <Card title="Email">
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); mail.run(() => api(`/api/app/admin/students/${student.id}/email`, { method: "POST", body: { to, subject: subject ?? template.subject, body: body ?? template.body } }), "Email sent and recorded.", d.reload); }}>
            <Field label="Send to"><select value={to} onChange={(e) => setTo(e.target.value as "student" | "guardian")} className={inputCls}><option value="student">Student ({student.email})</option>{canGuardian && <option value="guardian">Parent or guardian ({guardian.email})</option>}</select></Field>
            <Field label="Subject"><input value={subject ?? template.subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} required className={inputCls} /></Field>
            <Field label="Message"><textarea value={body ?? template.body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={5000} required className={inputCls} /></Field>
            <p className="text-sm text-ink/65">A supportive draft based on the student’s record. Edit it before sending; keep the tone respectful and specific.</p>
            <div><Btn type="submit" small disabled={mail.busy}>Send email</Btn></div>
            <Msg text={mail.msg.text} kind={mail.msg.kind} />
          </form>
        </Card>

        <Card title="Record a call or contact attempt">
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => {
            e.preventDefault(); const form = e.currentTarget; const f = Object.fromEntries(new FormData(form));
            call.run(() => api(`/api/app/admin/students/${student.id}/contacts`, { method: "POST", body: f }), "Recorded.", () => { form.reset(); d.reload(); });
          }}>
            <Field label="Who"><select name="target" className={inputCls}><option value="student">Student</option>{guardian.contactAuthorised && <option value="guardian">Parent or guardian</option>}</select></Field>
            <Field label="How"><select name="channel" className={inputCls}>{["call", "sms", "whatsapp", "in_person"].map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}</select></Field>
            <Field label="Outcome"><select name="outcome" className={inputCls}>{["reached", "no_answer", "left_message", "wrong_number"].map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}</select></Field>
            <div className="sm:col-span-3"><Field label="Summary"><textarea name="summary" rows={3} maxLength={1000} className={inputCls} placeholder="What was discussed and any agreed next step" /></Field></div>
            <div className="sm:col-span-3"><Btn type="submit" small kind="ghost" disabled={call.busy}>Save record</Btn><Msg text={call.msg.text} kind={call.msg.kind} /></div>
          </form>
          <h3 className="mt-6 text-sm font-semibold">Contact history</h3>
          {log.length ? <ul className="mt-2 divide-y divide-ink/[0.07] text-sm">{log.map((l) => (
            <li key={l.id} className="py-2"><p><b className="font-semibold">{LABEL[l.channel] ?? l.channel}</b> to the {l.target === "guardian" ? "parent or guardian" : "student"} · {LABEL[l.outcome] ?? l.outcome}</p>
              <p className="text-ink/65">{when(l.created_at)}{l.by_name ? ` · ${l.by_name}` : ""}{l.subject ? ` · “${l.subject}”` : ""}</p>{l.summary && l.channel !== "email" && <p className="mt-0.5 text-ink/80">{l.summary}</p>}</li>
          ))}</ul> : <Empty>No contact recorded yet.</Empty>}
        </Card>

        <Card title="Parent or guardian">
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
            e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            g.run(() => api(`/api/app/admin/students/${student.id}/guardian`, { method: "PUT", body: { ...f, contactAuthorised: authorised } }), "Guardian details saved.", d.reload);
          }}>
            <Field label="Name"><input name="name" defaultValue={guardian.name ?? ""} maxLength={120} className={inputCls} /></Field>
            <Field label="Relationship"><input name="relationship" defaultValue={guardian.relationship ?? ""} maxLength={60} placeholder="e.g. Mother" className={inputCls} /></Field>
            <Field label="Email"><input name="email" type="email" defaultValue={guardian.email ?? ""} className={inputCls} /></Field>
            <Field label="Phone"><input name="phone" defaultValue={guardian.phone ?? ""} className={inputCls} /></Field>
            <label className="flex items-start gap-2 sm:col-span-2"><input type="checkbox" checked={authorised} onChange={(e) => setAuth(e.target.checked)} className="mt-1 h-4 w-4 accent-indigo" /><span className="text-sm"><b className="font-semibold">Contact with the guardian is authorised.</b> Only tick this where the student (or, for a minor, the admission record) has authorised the Academy to contact this person.</span></label>
            {authorised && <div className="sm:col-span-2"><Field label="How it was authorised"><input name="authorisationNote" defaultValue={guardian.authorisationNote ?? ""} maxLength={300} required placeholder="e.g. Written consent on the admission form, 3 Oct 2026" className={inputCls} /></Field></div>}
            <div className="sm:col-span-2"><Btn type="submit" small kind="ghost" disabled={g.busy}>Save guardian details</Btn><Msg text={g.msg.text} kind={g.msg.kind} /></div>
          </form>
          {!guardian.contactAuthorised && <p className="mt-3 text-sm text-ink/65">“Contact parent or guardian” becomes available once contact is authorised and recorded here.</p>}
        </Card>

        <StaffWeekly enrolmentId={rec.enrolmentId} />
      </div>
    </section>
  );
}

const RULE_TEXT: [keyof Rules, string, string][] = [
  ["missedClasses", "Missed classes", "Alert at this many missed classes"],
  ["overdueAssignments", "Overdue assignments", "Alert at this many overdue, unsubmitted assignments"],
  ["missedAssessments", "Missed assessments", "Alert at this many assessments past due without an attempt"],
  ["averageBelow", "Low average (%)", "Alert when the assignment or assessment average falls below this"],
  ["inactiveDays", "Days without a class", "Alert when an active student has had no completed class for this long"],
];

function AlertSettings({ onSaved }: { onSaved: () => void }) {
  const d = useLoad<{ rules: Rules; defaults: Rules; limits: Record<keyof Rules, [number, number]> }>("/api/app/admin/settings/engagement");
  const { busy, msg, run } = useAction();
  if (!d.data) return null;
  return (
    <Card title="Engagement alert thresholds">
      <p className="-mt-1 mb-4 text-sm text-ink/70">These decide when a student is flagged to instructors and administrators. Alerts are worded neutrally; they prompt support, not sanctions.</p>
      <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" onSubmit={(e) => {
        e.preventDefault(); const f = Object.fromEntries(Object.entries(Object.fromEntries(new FormData(e.currentTarget))).map(([k, v]) => [k, Number(v)]));
        run(() => api("/api/app/admin/settings/engagement", { method: "PUT", body: f }), "Thresholds saved.", () => { d.reload(); onSaved(); });
      }}>
        {RULE_TEXT.map(([k, label, help]) => (
          <label key={k} className="text-sm font-semibold">{label}
            <input name={k} type="number" min={d.data!.limits[k][0]} max={d.data!.limits[k][1]} defaultValue={d.data!.rules[k]} required className={inputCls} />
            <span className="mt-1 block font-normal text-ink/60">{help}. Default {d.data!.defaults[k]}.</span>
          </label>
        ))}
        <div className="sm:col-span-2 xl:col-span-5"><Btn type="submit" small disabled={busy}>Save thresholds</Btn><Msg text={msg.text} kind={msg.kind} /></div>
      </form>
    </Card>
  );
}

type CurrencyData = { rates: Record<"USD" | "GBP" | "EUR", number> | null; fetchedAt: string | null; source: string | null; chargeCurrency: string; schedule: string;
  programmes: { slug: string; name: string; trainingMonths: number; internshipMonths: number; fullPaymentOnly: boolean; prices: Record<Currency, number | null> }[] };

export function CurrencySettings() {
  const d = useLoad<CurrencyData>("/api/app/admin/currency");
  const { busy, msg, run } = useAction();
  const [fresh, setFresh] = useState<CurrencyData | null>(null);
  const v = fresh ?? d.data;
  if (d.error) return <Msg text={d.error} />;
  if (!v) return <Empty>Loading…</Empty>;
  const CUR: Currency[] = ["NGN", "USD", "GBP", "EUR"];
  return (
    <div className="space-y-6">
      <Card title="Exchange rates" action={<Btn small kind="ghost" disabled={busy} onClick={() => run(async () => setFresh(await api<CurrencyData>("/api/app/admin/currency/refresh", { method: "POST" })), "Rates refreshed.")}>Refresh now</Btn>}>
        {v.rates ? (
          <dl className="grid gap-4 sm:grid-cols-3">{(["USD", "GBP", "EUR"] as const).map((c) => <div key={c}><dt className="text-sm text-ink/65">₦1,000 in {c}</dt><dd className="text-lg font-semibold">{money(v.rates![c] * 1000, c)}</dd><dd className="text-sm text-ink/60">1 {c} is about ₦{Math.round(1 / v.rates![c]).toLocaleString("en-NG")}</dd></div>)}</dl>
        ) : <Empty>No rates stored yet. Every visitor sees naira until the first refresh succeeds.</Empty>}
        <p className="mt-4 text-sm text-ink/70">{v.fetchedAt ? `Last updated ${when(v.fetchedAt)} from ${v.source}. ` : ""}{v.schedule}</p>
        <p className="mt-2 text-sm text-ink/70">Visitors see prices in the currency of the country they select: naira where the naira is the local currency, pounds for the United Kingdom, euros for the euro area and US dollars elsewhere. Paystack charges every payment in naira ({v.chargeCurrency}); the website states the naira amount before payment.</p>
        <Msg text={msg.text} kind={msg.kind} />
      </Card>
      <Card title="Programme investment">
        <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-[0.95rem]">
          <thead><tr className="border-b border-ink/10 text-sm text-ink/70"><th className="px-2 py-2 font-semibold">Programme</th><th className="px-2 py-2 font-semibold">Duration</th>{CUR.map((c) => <th key={c} className="px-2 py-2 text-right font-semibold">{c}</th>)}<th className="px-2 py-2 font-semibold">Payment</th></tr></thead>
          <tbody>{v.programmes.map((p) => (
            <tr key={p.slug} className="border-b border-ink/[0.06] last:border-0">
              <td className="px-2 py-2.5 font-semibold">{p.name}</td>
              <td className="px-2 py-2.5 text-sm">{p.trainingMonths} mo{p.internshipMonths ? ` + ${p.internshipMonths} mo internship` : ""}</td>
              {CUR.map((c) => <td key={c} className="px-2 py-2.5 text-right tabular-nums">{p.prices[c] === null ? "–" : c === "NGN" ? money(p.prices[c]!, c) : approx(p.prices[c]!, c)}</td>)}
              <td className="px-2 py-2.5 text-sm">{p.fullPaymentOnly ? "Full payment only" : "Full or 3 parts"}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="mt-3 text-sm text-ink/65">Prices and durations are set in the programme configuration (lib/config.ts) and change only with the owner’s approval. Foreign-currency figures are approximate.</p>
      </Card>
    </div>
  );
}

"use client";
// Instructor records (owner brief, 21 Nov 2026): student summary cards, the Class Sessions workspace (schedule beside a
// teaching screen), attendance summaries and the instructor's own Google Meet room. Every figure comes from the server.
import { useMemo, useState } from "react";
import { api, Avatar, Badge, Btn, Card, Empty, inputCls, Msg, useAction, useLoad, useNow, when } from "./ui";
import { SessionRow, type S } from "./instructor";
import { ProgressView, type Progress } from "./shared";

type Rec = {
  enrolmentId: string; studentId: string; fullName: string; studentNo: string | null; photo: string | null; programme: string; programmeName: string; enrolmentStatus: string; progress: number;
  sessions: { scheduled: number; upcoming: number; attended: number; missed: number; cancelled: number; rescheduled: number; late: number | null; excused: number | null; attendancePct: number | null };
  marks: { assignments: number | null; tests: number | null; assessments: number | null; average: number | null }; status: string; needsAttention: string[];
};
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v}%`);

export function StudentCards({ onOpen, selected }: { onOpen: (studentId: string) => void; selected: string | null }) {
  const d = useLoad<{ records: Rec[]; averageMethod: string }>("/api/app/instructor/records");
  if (d.error) return <Msg text={d.error} />;
  if (!d.data) return <Empty>Loading student records…</Empty>;
  if (!d.data.records.length) return <Card><Empty>No students are assigned to you yet.</Empty></Card>;
  return (
    <>
      <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {d.data.records.map((r) => (
          <li key={r.enrolmentId} className={`flex flex-col rounded-xl border bg-white p-5 ${selected === r.studentId ? "border-indigo ring-1 ring-indigo" : "border-ink/10"}`}>
            <div className="flex items-start gap-3">
              <Avatar src={r.photo} name={r.fullName} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.fullName}</p>
                <p className="text-sm text-ink/70">{r.studentNo ?? "No registration number yet"}</p>
                <p className="text-sm text-ink/70">{r.programmeName}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${r.status === "On track" ? "bg-indigo/[0.08] text-indigo" : r.status === "Needs attention" ? "bg-brand-orange/15 text-ink" : "bg-ink/[0.06] text-ink/75"}`}>{r.status}</span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm"><span className="text-ink/70">Programme progress</span><b>{r.progress}%</b></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={r.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.fullName} programme progress`}><div className="h-full rounded-full bg-indigo" style={{ width: `${r.progress}%` }} /></div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink/70">Sessions scheduled</dt><dd className="text-right font-semibold">{r.sessions.scheduled}</dd>
              <dt className="text-ink/70">Attended</dt><dd className="text-right font-semibold">{r.sessions.attended}{r.sessions.late ? <span className="font-normal text-ink/60"> ({r.sessions.late} late)</span> : null}</dd>
              <dt className="text-ink/70">Missed</dt><dd className="text-right font-semibold">{r.sessions.missed}{r.sessions.excused ? <span className="font-normal text-ink/60"> ({r.sessions.excused} excused)</span> : null}</dd>
              <dt className="text-ink/70">Attendance</dt><dd className="text-right font-semibold">{pct(r.sessions.attendancePct)}</dd>
            </dl>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-ink/10 pt-2 text-sm">
              <dt className="text-ink/70">Assignments</dt><dd className="text-right font-semibold">{pct(r.marks.assignments)}</dd>
              <dt className="text-ink/70">Tests</dt><dd className="text-right font-semibold">{pct(r.marks.tests)}</dd>
              <dt className="text-ink/70">Assessments</dt><dd className="text-right font-semibold">{pct(r.marks.assessments)}</dd>
              <dt className="font-semibold">Academic average</dt><dd className="text-right font-bold">{pct(r.marks.average)}</dd>
            </dl>
            {r.needsAttention.length > 0 && <p className="mt-3 rounded-lg bg-brand-orange/10 px-3 py-2 text-sm text-ink/85">{r.needsAttention.join("; ")}.</p>}
            <div className="mt-auto pt-4"><Btn small kind="ghost" onClick={() => onOpen(r.studentId)}>Open record</Btn></div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink/60">Academic average: {d.data.averageMethod}</p>
    </>
  );
}

type StudentLite = { programme: string; student: { id: string; studentNo: string | null } };
const lagosDay = (iso: string) => new Date(Date.parse(iso) + 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

// Class Sessions: "My schedule" on one side, the teaching screen for the chosen class on the other.
// Google Meet cannot be embedded in another website, so the teaching screen opens the class in Meet in a new tab.
export function ClassSessions({ students }: { students: StudentLite[] }) {
  const now = useNow();
  const today = lagosDay(new Date().toISOString());
  const d = useLoad<{ sessions: S[]; pendingOutcomes: S[] }>(`/api/app/instructor/sessions?from=${addDays(today, -7)}&to=${addDays(today, 21)}`);
  const regNo = useMemo(() => Object.fromEntries(students.map((s) => [s.student.id, s.student.studentNo])), [students]);
  const list = useMemo(() => (d.data?.sessions ?? []).filter((x) => x.status !== "rescheduled"), [d.data]);
  const next = list.find((x) => x.status === "scheduled" && now && Date.parse(x.endsAt) > now) ?? null;
  const [pickId, setPickId] = useState<string | null>(null);
  const sel = list.find((x) => x.id === pickId) ?? next ?? list[list.length - 1] ?? null;
  const byDay = list.reduce<Record<string, S[]>>((m, s) => { (m[lagosDay(s.startsAt)] ??= []).push(s); return m; }, {});
  return (
    <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <Card title="My schedule">
        {d.error && <Msg text={d.error} />}
        {d.data && !list.length && <Empty>No classes in the past week or the next three weeks.</Empty>}
        <div className="max-h-[40rem] space-y-4 overflow-y-auto pr-1">
          {Object.entries(byDay).map(([day, ss]) => (
            <div key={day}>
              <p className="mb-1.5 text-sm font-semibold text-ink/70">{day === today ? "Today" : new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</p>
              <ul className="space-y-2">
                {ss.map((x) => (
                  <li key={x.id}>
                    <button onClick={() => setPickId(x.id)} aria-pressed={sel?.id === x.id} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${sel?.id === x.id ? "border-indigo bg-indigo/[0.05]" : "border-ink/10 bg-white hover:border-indigo/40"}`}>
                      <Avatar src={x.student.photo} name={x.student.fullName} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{x.student.fullName}</span>
                        <span className="block truncate text-xs text-ink/65">{x.programmeName} · {regNo[x.student.id] ?? ""}</span>
                        <span className="block text-xs text-ink/65">{new Date(x.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} · {x.durationMin} min</span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <Badge s={x.needsOutcome ? "to record" : x.status} />
                        {next?.id === x.id && <span className="text-[11px] font-semibold text-brand-red">Next</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
      {sel ? <TeachingScreen key={sel.id} s={sel} regNo={regNo[sel.student.id] ?? null} programme={students.find((x) => x.student.id === sel.student.id)?.programme ?? null} isNext={next?.id === sel.id} reload={d.reload} /> : <Card><Empty>Choose a class to open its teaching screen.</Empty></Card>}
    </div>
  );
}

type G = { id: string; title: string; score: number | null; maxScore: number; gradedAt: string | null };

function TeachingScreen({ s, regNo, programme, isNext, reload }: { s: S; regNo: string | null; programme: string | null; isNext: boolean; reload: () => void }) {
  const now = useNow();
  const rec = useLoad<{ progress: Progress[] }>(`/api/app/instructor/students/${s.student.id}`);
  const gradeData = useLoad<{ assignments: G[]; quizzes: (G & { kind: string })[] }>(`/api/app/students/${s.student.id}/grades`);
  const grades = [...(gradeData.data?.assignments ?? []).map((g) => ({ ...g, kind: "assignment" })), ...(gradeData.data?.quizzes ?? [])].sort((a, b) => (b.gradedAt ?? "").localeCompare(a.gradedAt ?? ""));
  const res = useLoad<{ resources: { id: string; title: string; kind: string; url: string | null; file: string | null; programme?: string }[] }>("/api/app/resources");
  const mins = now ? Math.round((Date.parse(s.startsAt) - now) / 60000) : null;
  const live = now && Date.parse(s.startsAt) - 15 * 60000 <= now && now <= Date.parse(s.endsAt);
  const mats = (res.data?.resources ?? []).filter((r) => !programme || !r.programme || r.programme === programme).slice(0, 6);
  const prog = rec.data?.progress[0];
  return (
    <div className="space-y-6">
      <section aria-label="Live teaching screen" className="rounded-xl border border-ink/10 border-t-4 border-t-indigo bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar src={s.student.photo} name={s.student.fullName} size={64} />
            <div>
              <p className="text-sm font-semibold text-brand-red">{isNext ? "Next class" : s.status === "scheduled" ? "Scheduled class" : "Class"}</p>
              <h2 className="font-display text-2xl font-semibold">{s.student.fullName}</h2>
              <p className="text-ink/70">{s.programmeName}{regNo ? ` · ${regNo}` : ""}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold">{s.lagosTime}</p>
            <p className="text-sm text-ink/70">{s.durationMin} minutes</p>
            <div className="mt-1"><Badge s={s.needsOutcome ? "to record" : s.status} /></div>
          </div>
        </div>
        {s.status === "scheduled" && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-paper p-4">
            {s.meetUrl
              ? <a href={s.meetUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-2 rounded-lg px-5 py-3 font-display font-semibold text-white ${live ? "bg-indigo hover:bg-navy" : "bg-indigo/80 hover:bg-indigo"}`}>Open the class in Google Meet <span aria-hidden="true">↗</span></a>
              : <p className="font-semibold text-brand-red">No Meet link yet: add one below so the student can join.</p>}
            <p className="text-sm text-ink/70">{mins !== null && mins > 0 ? `Starts in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}.` : live ? "In session now." : ""} Google Meet opens in a new tab; screen sharing and the whiteboard are inside Meet.</p>
          </div>
        )}
        <ul className="mt-4"><SessionRow s={s} reload={reload} /></ul>
      </section>

      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
        <Card title="Academic record">
          {prog ? <ProgressView p={prog} /> : rec.data ? <Empty>No progress recorded yet.</Empty> : <Empty>Loading…</Empty>}
          {!!grades.length && (
            <ul className="mt-4 divide-y divide-ink/10 text-sm">{grades.slice(0, 6).map((g) => <li key={g.kind + g.id} className="flex justify-between gap-3 py-2"><span><b className="font-semibold">{g.title}</b> <span className="text-ink/60">({g.kind})</span></span><span className="font-semibold">{g.score === null ? "Not marked" : `${g.score}/${g.maxScore}`}</span></li>)}</ul>
          )}
        </Card>
        <Card title="Materials for this programme">
          {mats.length ? <ul className="space-y-2 text-sm">{mats.map((m) => <li key={m.id}><a href={m.url ?? m.file ?? "#"} target={m.url ? "_blank" : undefined} rel="noopener noreferrer" className="font-semibold text-indigo underline">{m.title}</a> <span className="text-ink/60">({m.kind})</span></li>)}</ul> : <Empty>No approved materials yet. Add them under Academic Resources.</Empty>}
        </Card>
      </div>
    </div>
  );
}

type Sum = { from: string; scheduled: number; attended: number; missed: number; cancelled: number; rescheduled: number; pending: number; late: number | null; excused: number | null; attendancePct: number | null };
type AttSession = S & { attendanceDetail?: string | null; outcomeAt?: string | null };

export function AttendancePanel() {
  const d = useLoad<{ week: Sum; month: Sum; sessions: AttSession[] }>("/api/app/instructor/attendance");
  const block = (title: string, x: Sum) => (
    <Card title={title}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[0.95rem] sm:grid-cols-4">
        {([["Scheduled", x.scheduled], ["Attended", x.attended], ["Missed", x.missed], ["Attendance", x.attendancePct === null ? "–" : `${x.attendancePct}%`], ["Late arrivals", x.late ?? "–"], ["Excused absences", x.excused ?? "–"], ["Rescheduled", x.rescheduled], ["Cancelled", x.cancelled]] as [string, string | number][]).map(([k, v]) => (
          <div key={k}><dt className="text-sm text-ink/65">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
        ))}
      </dl>
      {x.pending > 0 && <p className="mt-3 text-sm font-semibold text-brand-red">{x.pending} finished class{x.pending > 1 ? "es" : ""} still to record.</p>}
    </Card>
  );
  if (d.error) return <Msg text={d.error} />;
  if (!d.data) return <Empty>Loading attendance…</Empty>;
  const detail = (x: AttSession) => x.status === "completed" ? (x.attendanceDetail === "late" ? "Attended (late)" : "Attended") : x.status === "missed" ? (x.attendanceDetail === "excused" ? "Excused absence" : "Missed") : x.needsOutcome ? "To record" : x.status.charAt(0).toUpperCase() + x.status.slice(1);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">{block("This week", d.data.week)}{block("This month", d.data.month)}</div>
      <Card title="By session (last 30 days)">
        {d.data.sessions.length ? (
          <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-[0.95rem]">
            <thead><tr className="border-b border-ink/10 text-sm text-ink/70"><th className="px-2 py-2 font-semibold">Date</th><th className="px-2 py-2 font-semibold">Student</th><th className="px-2 py-2 font-semibold">Programme</th><th className="px-2 py-2 font-semibold">Attendance</th><th className="px-2 py-2 font-semibold">Recorded</th></tr></thead>
            <tbody>{d.data.sessions.map((x) => <tr key={x.id} className="border-b border-ink/[0.06] last:border-0"><td className="px-2 py-2.5">{x.lagosTime}</td><td className="px-2 py-2.5 font-semibold">{x.student.fullName}</td><td className="px-2 py-2.5">{x.programmeName}</td><td className="px-2 py-2.5">{detail(x)}</td><td className="px-2 py-2.5 text-sm text-ink/65">{x.outcomeAt ? when(x.outcomeAt) : "–"}</td></tr>)}</tbody>
          </table></div>) : <Empty>No classes in the last 30 days.</Empty>}
      </Card>
    </div>
  );
}

export function MeetSettings() {
  const d = useLoad<{ meetLink: string | null; sessions: S[] }>("/api/app/instructor/meet-link");
  const { busy, msg, run } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  const value = url ?? d.data?.meetLink ?? "";
  const valid = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?[\w=&-]{0,60})?$/.test(value.trim());
  const save = (apply: "none" | "empty" | "all") => run(async () => {
    const r = await api<{ applied: number }>("/api/app/instructor/meet-link", { method: "PUT", body: { url: value.trim(), apply } });
    return r;
  }, apply === "none" ? "Your Meet link is saved." : "Saved and applied to your scheduled classes.", d.reload);
  return (
    <Card title="Google Meet settings">
      <p className="text-sm text-ink/70">If you teach from your own Google Meet room, save it here and apply it to your scheduled classes. Students see it only in their own learning space, never publicly. You can still set a different link for any single class.</p>
      <label className="mt-4 block text-sm font-semibold">Your Google Meet link
        <input value={value} onChange={(e) => setUrl(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" className={inputCls} />
      </label>
      {value && !valid && <p className="mt-1 text-sm text-brand-red">Use the format https://meet.google.com/abc-defg-hij</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn small disabled={busy || (!!value && !valid)} onClick={() => save("none")}>Save link</Btn>
        <Btn small kind="ghost" disabled={busy || !valid} onClick={() => save("empty")}>Apply to classes without a link</Btn>
        <Btn small kind="ghost" disabled={busy || !valid} onClick={() => { if (confirm("Replace the link on all your scheduled classes?")) save("all"); }}>Apply to all scheduled classes</Btn>
      </div>
      <Msg text={msg.text} kind={msg.kind} />
      {!!d.data?.sessions.length && (
        <div className="mt-4"><p className="text-sm font-semibold">Scheduled classes using this link ({d.data.sessions.length})</p>
          <ul className="mt-1 divide-y divide-ink/10 text-sm">{d.data.sessions.slice(0, 8).map((x) => <li key={x.id} className="flex justify-between gap-3 py-2"><span>{x.student.fullName}</span><span className="text-ink/65">{x.lagosTime}</span></li>)}</ul></div>
      )}
    </Card>
  );
}

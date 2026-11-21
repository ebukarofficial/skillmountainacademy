"use client";
// Instructor dashboard. Left: programmes and students. Centre: schedule (day/week) with Meet links and attendance,
// attendance still to record, set work, marking queue, messages. Right: profile and performance.
import { useMemo, useState } from "react";
import type { Me } from "./page";
import { MaterialsManager, Messages, ProfileEditor, ProgressView, type Progress } from "./shared";
import { api, Avatar, Badge, Btn, Card, Empty, Field, inputCls, Msg, PageTitle, Stat, useAction, useLoad, useNow, useTab, when } from "./ui";
import { AppShell, type NavItem } from "./shell";

type S = { id: string; programmeName: string; startsAt: string; endsAt: string; lagosTime: string; durationMin: number; status: string; meetUrl: string | null; meetNotifiedAt: string | null; needsOutcome: boolean; student: { id: string; fullName: string; photo: string | null } };
type Student = { enrolmentId: string; programme: string; programmeName: string; status: string; student: { id: string; fullName: string; email: string; studentNo: string | null; photo: string | null } };
const lagosDay = (iso: string) => new Date(Date.parse(iso) + 3600_000).toISOString().slice(0, 10);

function SessionRow({ s, reload }: { s: S; reload: () => void }) {
  const [url, setUrl] = useState(s.meetUrl ?? "");
  const { busy, msg, run } = useAction();
  const now = useNow();
  const started = now > 0 && Date.parse(s.startsAt) <= now;
  return (
    <li className="rounded-xl bg-ink/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar src={s.student.photo} name={s.student.fullName} size={36} />
          <span className="text-sm"><b>{s.student.fullName}</b><span className="block text-xs text-ink/60">{s.programmeName} · {s.lagosTime} · {s.durationMin} min</span></span>
        </div>
        <div className="flex items-center gap-2"><Badge s={s.status} />{s.status === "scheduled" && <Badge s={s.meetUrl ? "added" : "pending"} />}</div>
      </div>
      {s.status === "scheduled" && !s.needsOutcome && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/app/instructor/sessions/${s.id}/meet`, { method: "PUT", body: { url } }), s.meetUrl ? "Link replaced; the student was told." : "Link added; the student was told.", reload); }}>
          <label className="sr-only" htmlFor={`m-${s.id}`}>Google Meet link</label>
          <input id={`m-${s.id}`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" className={`${inputCls} mt-0`} />
          <Btn small type="submit" disabled={busy}>{s.meetUrl ? "Replace" : "Add link"}</Btn>
        </form>
      )}
      {s.meetUrl && s.status === "scheduled" && <p className="mt-1 text-xs text-ink/60">{s.meetNotifiedAt ? `Student notified ${when(s.meetNotifiedAt)}` : "Notifying the student…"} · <a href={s.meetUrl} target="_blank" rel="noopener noreferrer" className="underline">Open Meet</a></p>}
      {s.status === "scheduled" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {started && <Btn small kind="dark" disabled={busy} onClick={() => run(() => api(`/api/app/instructor/sessions/${s.id}/outcome`, { method: "POST", body: { status: "completed" } }), "Marked completed.", reload)}>Completed</Btn>}
          {started && <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/instructor/sessions/${s.id}/outcome`, { method: "POST", body: { status: "missed" } }), "Marked missed.", reload)}>Student missed</Btn>}
          <Btn small kind="ghost" disabled={busy} onClick={() => { if (confirm("Cancel this class? The student will be told.")) run(() => api(`/api/app/instructor/sessions/${s.id}/outcome`, { method: "POST", body: { status: "cancelled" } }), "Cancelled.", reload); }}>Cancel</Btn>
        </div>
      )}
      <Msg text={msg.text} kind={msg.kind} />
    </li>
  );
}

function Schedule() {
  const [view, setView] = useState<"day" | "week">("day");
  const today = lagosDay(new Date().toISOString());
  const { data, error, reload } = useLoad<{ sessions: S[]; pendingOutcomes: S[] }>(`/api/app/instructor/sessions?from=${today}&to=${new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86400_000).toISOString().slice(0, 10)}`);
  // Ended classes without an outcome are listed under "Attendance to record" instead.
  const list = (data?.sessions ?? []).filter((s) => !s.needsOutcome && (view === "week" || lagosDay(s.startsAt) === today));
  const byDay = useMemo(() => list.reduce<Record<string, S[]>>((m, s) => { (m[lagosDay(s.startsAt)] ??= []).push(s); return m; }, {}), [list]);
  return (
    <>
      {!!data?.pendingOutcomes.length && <Card title={`Attendance to record (${data.pendingOutcomes.length})`}><ul className="space-y-2">{data.pendingOutcomes.map((s) => <SessionRow key={s.id} s={s} reload={reload} />)}</ul></Card>}
      <Card title="My schedule" action={<div className="flex gap-1">{(["day", "week"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 text-xs font-semibold ${view === v ? "bg-indigo text-white" : "bg-ink/[0.03]"}`}>{v === "day" ? "Today" : "Next 7 days"}</button>)}</div>}>
        {error && <Msg text={error} />}
        {Object.entries(byDay).map(([d, ss]) => (
          <div key={d} className="mb-3"><p className="mb-1 text-xs font-bold uppercase text-ink/60">{new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</p>
            <ul className="space-y-2">{ss.map((s) => <SessionRow key={s.id} s={s} reload={reload} />)}</ul></div>
        ))}
        {data && !list.length && <Empty>{view === "day" ? "No classes today." : "No classes in the next 7 days."}</Empty>}
        <p className="mt-2 text-xs text-ink/60">Create each Meet link in Google Meet, then paste it here. Screen sharing and the whiteboard are inside Meet.</p>
      </Card>
    </>
  );
}

function SetWork({ students }: { students: Student[] }) {
  const [kind, setKind] = useState<"assignment" | "quiz" | "assessment">("assignment");
  const [qs, setQs] = useState([{ prompt: "", options: "", answer: 0, type: "mcq" as "mcq" | "text" }]);
  const { busy, msg, run } = useAction();
  return (
    <Card title="Set work">
      <div className="mb-3 flex gap-1">{(["assignment", "quiz", "assessment"] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${kind === k ? "bg-indigo text-white" : "bg-ink/[0.03]"}`}>{k}</button>)}</div>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        const [studentId, programme] = f.who.split("|");
        const base = { studentId, programme, title: f.title, dueDate: f.dueDate, dueTime: f.dueTime || "23:59" };
        if (kind === "assignment") return run(() => api("/api/app/instructor/assignments", { method: "POST", body: { ...base, description: f.description, maxScore: Number(f.maxScore) || 100 } }), "Assignment sent to the student.");
        const questions = qs.map((q) => q.type === "text" ? { type: "text", prompt: q.prompt, points: 5 } : { type: "mcq", prompt: q.prompt, options: q.options.split("\n").map((s) => s.trim()).filter(Boolean), answer: q.answer, points: 1 });
        run(() => api("/api/app/instructor/quizzes", { method: "POST", body: { ...base, kind, instructions: f.description, durationMin: f.duration ? Number(f.duration) : null, questions } }), `${kind === "quiz" ? "Quiz" : "Assessment"} sent to the student.`);
      }}>
        <Field label="Student"><select name="who" required className={inputCls}>{students.map((s) => <option key={s.enrolmentId} value={`${s.student.id}|${s.programme}`}>{s.student.fullName} · {s.programmeName}</option>)}</select></Field>
        <Field label="Title"><input name="title" required maxLength={200} className={inputCls} /></Field>
        <Field label={kind === "assignment" ? "Instructions" : "Instructions (optional)"}><textarea name="description" rows={3} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Due date"><input name="dueDate" type="date" required className={inputCls} /></Field>
          <Field label="Due time (Lagos)"><input name="dueTime" type="time" className={inputCls} /></Field>
        </div>
        {kind === "assignment" ? <Field label="Maximum score"><input name="maxScore" type="number" min={1} max={1000} defaultValue={100} className={inputCls} /></Field>
          : <Field label="Time limit in minutes (optional)"><input name="duration" type="number" min={1} max={300} className={inputCls} /></Field>}
        {kind !== "assignment" && <div className="space-y-2">
          {qs.map((q, i) => (
            <fieldset key={i} className="rounded-xl bg-ink/[0.03] p-2">
              <legend className="text-xs font-bold">Question {i + 1}</legend>
              {kind === "assessment" && <select aria-label="Question type" value={q.type} onChange={(e) => setQs(qs.map((x, k) => k === i ? { ...x, type: e.target.value as "mcq" | "text" } : x))} className={inputCls}><option value="mcq">Multiple choice</option><option value="text">Written answer</option></select>}
              <input aria-label="Question" required value={q.prompt} onChange={(e) => setQs(qs.map((x, k) => k === i ? { ...x, prompt: e.target.value } : x))} placeholder="Question" className={inputCls} />
              {q.type === "mcq" && <>
                <textarea aria-label="Options, one per line" required rows={3} value={q.options} onChange={(e) => setQs(qs.map((x, k) => k === i ? { ...x, options: e.target.value } : x))} placeholder="Options, one per line" className={inputCls} />
                <label className="text-xs">Correct option number <input type="number" min={1} max={6} value={q.answer + 1} onChange={(e) => setQs(qs.map((x, k) => k === i ? { ...x, answer: Math.max(0, Number(e.target.value) - 1) } : x))} className="w-16 rounded border border-ink/15 px-2" /></label>
              </>}
            </fieldset>
          ))}
          <Btn small kind="ghost" onClick={() => setQs([...qs, { prompt: "", options: "", answer: 0, type: "mcq" }])}>Add question</Btn>
        </div>}
        <Btn type="submit" disabled={busy || !students.length}>Send to student</Btn>
        <Msg text={msg.text} kind={msg.kind} />
      </form>
    </Card>
  );
}

function Marking() {
  const a = useLoad<{ assignments: { id: string; title: string; studentName: string; status: string; maxScore: number; submission: { text: string | null; fileName: string | null; file: string | null } | null }[] }>("/api/app/instructor/assignments");
  const q = useLoad<{ quizzes: { id: string; title: string; kind: string; studentName: string; status: string; maxScore: number; questions: { prompt: string; type: string }[]; answers: (string | number | null)[] | null }[] }>("/api/app/instructor/quizzes");
  const { busy, msg, run } = useAction();
  const toMark = (a.data?.assignments ?? []).filter((x) => x.status === "submitted" || x.status === "submitted_late");
  const qToMark = (q.data?.quizzes ?? []).filter((x) => x.status === "submitted");
  const grade = (path: string, max: number, reload: () => void) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    run(() => api(path, { method: "POST", body: { score: Math.min(max, Number(f.score)), feedback: f.feedback } }), "Marked; the student was told.", reload);
  };
  return (
    <Card title={`To mark (${toMark.length + qToMark.length})`}>
      <ul className="space-y-3">
        {toMark.map((x) => (
          <li key={x.id} className="rounded-xl bg-ink/[0.03] p-3 text-sm">
            <b>{x.title}</b> · {x.studentName} <Badge s={x.status} />
            {x.submission?.text && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-white p-2">{x.submission.text}</p>}
            {x.submission?.file && <a href={x.submission.file} className="mt-1 inline-block font-semibold text-brand-red underline">Download {x.submission.fileName}</a>}
            <form className="mt-2 flex flex-wrap gap-2" onSubmit={grade(`/api/app/instructor/assignments/${x.id}/grade`, x.maxScore, a.reload)}>
              <input name="score" type="number" min={0} max={x.maxScore} required aria-label="Score" placeholder={`/ ${x.maxScore}`} className="w-24 rounded-xl border border-ink/15 px-2 py-1.5" />
              <input name="feedback" aria-label="Feedback" placeholder="Feedback" className="flex-1 rounded-xl border border-ink/15 px-2 py-1.5" />
              <Btn small type="submit" disabled={busy}>Save mark</Btn>
            </form>
          </li>
        ))}
        {qToMark.map((x) => (
          <li key={x.id} className="rounded-xl bg-ink/[0.03] p-3 text-sm">
            <b>{x.title}</b> ({x.kind}) · {x.studentName}
            {x.questions.map((qq, i) => <p key={i} className="mt-1"><span className="text-ink/60">{i + 1}. {qq.prompt}</span><br />{String(x.answers?.[i] ?? "(no answer)")}</p>)}
            <form className="mt-2 flex flex-wrap gap-2" onSubmit={grade(`/api/app/instructor/quizzes/${x.id}/grade`, x.maxScore, q.reload)}>
              <input name="score" type="number" min={0} max={x.maxScore} required aria-label="Score" placeholder={`/ ${x.maxScore}`} className="w-24 rounded-xl border border-ink/15 px-2 py-1.5" />
              <input name="feedback" aria-label="Feedback" placeholder="Feedback" className="flex-1 rounded-xl border border-ink/15 px-2 py-1.5" />
              <Btn small type="submit" disabled={busy}>Save mark</Btn>
            </form>
          </li>
        ))}
      </ul>
      {a.data && q.data && !toMark.length && !qToMark.length && <Empty>Nothing waiting to be marked.</Empty>}
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

const TABS = ["today", "schedule", "students", "coursework", "materials", "messages", "account"] as const;
type Tab = (typeof TABS)[number];
type Perf = { studentsTaught: number; activeStudents: number; sessions: { completed: number; missed: number; cancelled: number; awaitingAttendance: number }; attendancePct: number | null; rating: { average: number | null; count: number }; grading: { waiting: number }; reviews: { rating: number; comment: string | null }[] };

export function InstructorDashboard({ me }: { me: Me }) {
  const [tab, setTab] = useTab(TABS, "today");
  const st = useLoad<{ students: Student[] }>("/api/app/instructor/students");
  const perf = useLoad<{ performance: Perf }>("/api/app/instructor/performance");
  const msgs = useLoad<{ unread: number }>("/api/app/messages");
  const [pick, setPick] = useState<string | null>(null);
  const detail = useLoad<{ student: { fullName: string; email: string; phone: string | null; studentNo: string | null; bio: string | null }; progress: Progress[] }>(pick ? `/api/app/instructor/students/${pick}` : null);
  const groups = (st.data?.students ?? []).reduce<Record<string, Student[]>>((m, s) => { (m[s.programmeName] ??= []).push(s); return m; }, {});
  const p = perf.data?.performance;
  const programmes = [...new Map((st.data?.students ?? []).map((s) => [s.programme, { slug: s.programme, name: s.programmeName }])).values()];
  const nav: NavItem<Tab>[] = [
    { id: "today", label: "Today", icon: "home" },
    { id: "schedule", label: "Schedule", icon: "calendar", badge: p?.sessions.awaitingAttendance },
    { id: "students", label: "Students", icon: "users" },
    { id: "coursework", label: "Coursework & marking", icon: "clipboard", badge: p?.grading.waiting },
    { id: "materials", label: "Materials", icon: "folder" },
    { id: "messages", label: "Messages", icon: "chat", badge: msgs.data?.unread },
    { id: "account", label: "Profile & performance", icon: "user" },
  ];
  return (
    <AppShell me={me} nav={nav} tab={tab} setTab={setTab}>
      {tab === "today" && <>
        <PageTitle title={`Welcome, ${me.fullName.split(" ")[0]}`} sub={<>Faculty{me.staffNo ? <> · Staff No <b className="font-semibold text-ink/80">{me.staffNo}</b></> : null}</>} />
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Active students" value={p?.activeStudents ?? "–"} note={p ? `${p.studentsTaught} taught in total` : undefined} />
          <Stat label="Attendance to record" value={p?.sessions.awaitingAttendance ?? "–"} tone={p?.sessions.awaitingAttendance ? "alert" : "plain"} />
          <Stat label="Waiting to be marked" value={p?.grading.waiting ?? "–"} tone={p?.grading.waiting ? "alert" : "plain"} />
          <Stat label="Unread messages" value={msgs.data?.unread ?? "–"} />
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Schedule />
          <Marking />
        </div>
      </>}
      {tab === "schedule" && <><PageTitle title="Schedule" sub="Add each class's Google Meet link and record attendance afterwards. Times are Lagos time." /><div className="max-w-4xl"><Schedule /></div></>}
      {tab === "students" && <>
        <PageTitle title="Students" sub="Your students, grouped by programme." />
        <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
          <Card title="By programme">
            {Object.entries(groups).map(([prog, ss]) => (
              <div key={prog} className="mb-4 last:mb-0"><p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{prog} · {ss.length}</p>
                <ul className="mt-2 space-y-1">{ss.map((s) => <li key={s.enrolmentId}><button onClick={() => setPick(s.student.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${pick === s.student.id ? "bg-indigo text-white" : "hover:bg-ink/[0.04]"}`}><Avatar src={s.student.photo} name={s.student.fullName} size={30} /><span className="flex-1 font-medium">{s.student.fullName}</span><Badge s={s.status} /></button></li>)}</ul></div>
            ))}
            {st.data && !st.data.students.length && <Empty>No students assigned yet.</Empty>}
          </Card>
          {pick && detail.data ? <Card title={detail.data.student.fullName}>
            <p className="text-sm text-ink/65">{detail.data.student.email}{detail.data.student.phone ? ` · ${detail.data.student.phone}` : ""}{detail.data.student.studentNo ? ` · ${detail.data.student.studentNo}` : ""}</p>
            {detail.data.student.bio && <p className="mt-2 text-sm">{detail.data.student.bio}</p>}
            <div className="mt-4 space-y-5">{detail.data.progress.map((pr) => <ProgressView key={pr.enrolmentId} p={pr} />)}</div>
          </Card> : <Card><Empty>Select a student to see their progress.</Empty></Card>}
        </div>
      </>}
      {tab === "coursework" && <><PageTitle title="Coursework and marking" /><div className="grid gap-5 lg:grid-cols-2"><Marking /><SetWork students={st.data?.students ?? []} /></div></>}
      {tab === "materials" && <><PageTitle title="Materials" sub="Upload or link materials for your programmes. An administrator approves them before students see them." /><div className="max-w-4xl"><MaterialsManager admin={false} programmes={programmes} /></div></>}
      {tab === "messages" && <><PageTitle title="Messages" /><div className="max-w-3xl"><Messages /></div></>}
      {tab === "account" && <>
        <PageTitle title="Profile and performance" />
        <div className="grid gap-5 lg:grid-cols-2">
          <ProfileEditor me={me} onSaved={() => window.location.reload()} />
          <Card title="My performance">
            {p ? <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Classes completed" value={p.sessions.completed} note={`${p.sessions.missed} missed · ${p.sessions.cancelled} cancelled`} />
                <Stat label="Attendance" value={p.attendancePct != null ? `${p.attendancePct}%` : "–"} />
                <Stat label="Rating" value={p.rating.average ?? "–"} note={`${p.rating.count} student rating${p.rating.count === 1 ? "" : "s"}`} />
                <Stat label="To mark" value={p.grading.waiting} />
              </div>
              <ul className="mt-4 space-y-2">{p.reviews.filter((r) => r.comment).slice(0, 3).map((r, i) => <li key={i} className="rounded-lg bg-ink/[0.03] p-3 text-sm">“{r.comment}” <span className="text-ink/55">({r.rating}★)</span></li>)}</ul>
            </> : <Empty>Loading…</Empty>}
          </Card>
        </div>
      </>}
    </AppShell>
  );
}

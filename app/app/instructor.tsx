"use client";
// Instructor workspace: Overview (next teaching responsibility first), My Students, My Programmes, Teaching Calendar,
// Class Sessions (Meet links), Assignments, Assessments, Attendance, Messages, Academic Resources, Instructor Profile.
// The server only ever returns this instructor's own students and sessions.
import { useMemo, useState } from "react";
import type { Me } from "./page";
import { MaterialsManager, Messages, ProgressView, type Progress } from "./shared";
import { api, Avatar, Badge, Btn, Card, Empty, Field, inputCls, Msg, PageTitle, Stat, useAction, useLoad, useNow, useTab, VerifiedBadge, when } from "./ui";
import { AppShell, useNotifications, type NavItem } from "./shell";
import { AcademicCalendar, type CalEvent } from "./calendar";
import { InstructorProfileForm } from "./instructor-profile";
import { AttendancePanel, ClassSessions, MeetSettings, StudentCards } from "./instructor-records";
import { StaffWeekly } from "./weekly";

export type S = { id: string; programmeName: string; startsAt: string; endsAt: string; lagosTime: string; durationMin: number; status: string; meetUrl: string | null; meetNotifiedAt: string | null; needsOutcome: boolean; student: { id: string; fullName: string; photo: string | null } };
type Student = { enrolmentId: string; programme: string; programmeName: string; status: string; student: { id: string; fullName: string; email: string; studentNo: string | null; photo: string | null } };
const lagosDay = (iso: string) => new Date(Date.parse(iso) + 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
type Work = { id: string; title: string; studentName: string; status: string; dueAt: string; dueText: string; maxScore: number; kind?: string };

export function SessionRow({ s, reload }: { s: S; reload: () => void }) {
  const [url, setUrl] = useState(s.meetUrl ?? "");
  const { busy, msg, run } = useAction();
  const now = useNow();
  const started = now > 0 && Date.parse(s.startsAt) <= now;
  return (
    <li className="rounded-lg border border-ink/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar src={s.student.photo} name={s.student.fullName} size={36} />
          <span><b className="text-[0.95rem]">{s.student.fullName}</b><span className="block text-sm text-ink/70">{s.programmeName} · {s.lagosTime} · {s.durationMin} min</span></span>
        </div>
        <div className="flex items-center gap-2"><Badge s={s.status} />{s.status === "scheduled" && <span className="text-sm text-ink/70">{s.meetUrl ? "Meet link added" : "Meet link needed"}</span>}</div>
      </div>
      {s.status === "scheduled" && !s.needsOutcome && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/app/instructor/sessions/${s.id}/meet`, { method: "PUT", body: { url } }), s.meetUrl ? "Link replaced; the student was told." : "Link added; the student was told.", reload); }}>
          <label className="sr-only" htmlFor={`m-${s.id}`}>Google Meet link</label>
          <input id={`m-${s.id}`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" className={`${inputCls} mt-0`} />
          <Btn small type="submit" disabled={busy}>{s.meetUrl ? "Replace" : "Add link"}</Btn>
        </form>
      )}
      {s.meetUrl && s.status === "scheduled" && <p className="mt-1 text-sm text-ink/70">{s.meetNotifiedAt ? `Student notified ${when(s.meetNotifiedAt)}` : "Notifying the student…"} · <a href={s.meetUrl} target="_blank" rel="noopener noreferrer" className="underline">Open Meet</a></p>}
      {s.status === "scheduled" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {started && <Btn small kind="dark" disabled={busy} onClick={() => run(() => api(`/api/app/instructor/sessions/${s.id}/outcome`, { method: "POST", body: { status: "completed", detail: "on_time" } }), "Marked attended.", reload)}>Completed</Btn>}
          {started && <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/instructor/sessions/${s.id}/outcome`, { method: "POST", body: { status: "completed", detail: "late" } }), "Marked attended, late.", reload)}>Attended late</Btn>}
          {started && <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/instructor/sessions/${s.id}/outcome`, { method: "POST", body: { status: "missed" } }), "Marked missed.", reload)}>Student missed</Btn>}
          {started && <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/instructor/sessions/${s.id}/outcome`, { method: "POST", body: { status: "missed", detail: "excused" } }), "Marked as an excused absence.", reload)}>Excused absence</Btn>}
          <Btn small kind="ghost" disabled={busy} onClick={() => { if (confirm("Cancel this class? The student will be told.")) run(() => api(`/api/app/instructor/sessions/${s.id}/outcome`, { method: "POST", body: { status: "cancelled" } }), "Cancelled.", reload); }}>Cancel</Btn>
        </div>
      )}
      <Msg text={msg.text} kind={msg.kind} />
    </li>
  );
}

function SetWork({ students, kinds = ["assignment", "quiz", "assessment"] }: { students: Student[]; kinds?: ("assignment" | "quiz" | "assessment")[] }) {
  const [kind, setKind] = useState<"assignment" | "quiz" | "assessment">(kinds[0]);
  const [qs, setQs] = useState([{ prompt: "", options: "", answer: 0, type: "mcq" as "mcq" | "text" }]);
  const { busy, msg, run } = useAction();
  return (
    <Card title={kinds.length === 1 ? "Set an assignment" : "Set a quiz or assessment"}>
      {kinds.length > 1 && <div role="tablist" aria-label="Type of work" className="mb-4 inline-flex rounded-lg border border-ink/15 p-0.5">{kinds.map((k) => <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${kind === k ? "bg-indigo text-white" : "text-ink/75"}`}>{k}</button>)}</div>}
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
            <fieldset key={i} className="rounded-lg border border-ink/10 p-3">
              <legend className="px-1 text-sm font-semibold">Question {i + 1}</legend>
              {kind === "assessment" && <select aria-label="Question type" value={q.type} onChange={(e) => setQs(qs.map((x, k) => k === i ? { ...x, type: e.target.value as "mcq" | "text" } : x))} className={inputCls}><option value="mcq">Multiple choice</option><option value="text">Written answer</option></select>}
              <input aria-label="Question" required value={q.prompt} onChange={(e) => setQs(qs.map((x, k) => k === i ? { ...x, prompt: e.target.value } : x))} placeholder="Question" className={inputCls} />
              {q.type === "mcq" && <>
                <textarea aria-label="Options, one per line" required rows={3} value={q.options} onChange={(e) => setQs(qs.map((x, k) => k === i ? { ...x, options: e.target.value } : x))} placeholder="Options, one per line" className={inputCls} />
                <label className="text-sm">Correct option number <input type="number" min={1} max={6} value={q.answer + 1} onChange={(e) => setQs(qs.map((x, k) => k === i ? { ...x, answer: Math.max(0, Number(e.target.value) - 1) } : x))} className="w-16 rounded border border-ink/15 px-2" /></label>
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

function Marking({ only }: { only?: "assignments" | "quizzes" }) {
  const a = useLoad<{ assignments: { id: string; title: string; studentName: string; status: string; maxScore: number; submission: { text: string | null; fileName: string | null; file: string | null } | null }[] }>("/api/app/instructor/assignments");
  const q = useLoad<{ quizzes: { id: string; title: string; kind: string; studentName: string; status: string; maxScore: number; questions: { prompt: string; type: string }[]; answers: (string | number | null)[] | null }[] }>("/api/app/instructor/quizzes");
  const { busy, msg, run } = useAction();
  const toMark = only === "quizzes" ? [] : (a.data?.assignments ?? []).filter((x) => x.status === "submitted" || x.status === "submitted_late");
  const qToMark = only === "assignments" ? [] : (q.data?.quizzes ?? []).filter((x) => x.status === "submitted");
  const grade = (path: string, max: number, reload: () => void) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    run(() => api(path, { method: "POST", body: { score: Math.min(max, Number(f.score)), feedback: f.feedback } }), "Marked; the student was told.", reload);
  };
  return (
    <Card title={`Awaiting grading (${toMark.length + qToMark.length})`}>
      <ul className="space-y-3">
        {toMark.map((x) => (
          <li key={x.id} className="rounded-lg border border-ink/10 p-4 text-[0.95rem]">
            <b>{x.title}</b> · {x.studentName} <Badge s={x.status} />
            {x.submission?.text && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-white p-2">{x.submission.text}</p>}
            {x.submission?.file && <a href={x.submission.file} className="mt-1 inline-block font-semibold text-indigo underline">Download {x.submission.fileName}</a>}
            <form className="mt-2 flex flex-wrap gap-2" onSubmit={grade(`/api/app/instructor/assignments/${x.id}/grade`, x.maxScore, a.reload)}>
              <input name="score" type="number" min={0} max={x.maxScore} required aria-label="Score" placeholder={`/ ${x.maxScore}`} className="w-24 rounded-lg border border-ink/25 px-3 py-2" />
              <input name="feedback" aria-label="Feedback" placeholder="Feedback" className="min-w-40 flex-1 rounded-lg border border-ink/25 px-3 py-2" />
              <Btn small type="submit" disabled={busy}>Save mark</Btn>
            </form>
          </li>
        ))}
        {qToMark.map((x) => (
          <li key={x.id} className="rounded-lg border border-ink/10 p-4 text-[0.95rem]">
            <b>{x.title}</b> ({x.kind}) · {x.studentName}
            {x.questions.map((qq, i) => <p key={i} className="mt-1"><span className="text-ink/70">{i + 1}. {qq.prompt}</span><br />{String(x.answers?.[i] ?? "(no answer)")}</p>)}
            <form className="mt-2 flex flex-wrap gap-2" onSubmit={grade(`/api/app/instructor/quizzes/${x.id}/grade`, x.maxScore, q.reload)}>
              <input name="score" type="number" min={0} max={x.maxScore} required aria-label="Score" placeholder={`/ ${x.maxScore}`} className="w-24 rounded-lg border border-ink/25 px-3 py-2" />
              <input name="feedback" aria-label="Feedback" placeholder="Feedback" className="min-w-40 flex-1 rounded-lg border border-ink/25 px-3 py-2" />
              <Btn small type="submit" disabled={busy}>Save mark</Btn>
            </form>
          </li>
        ))}
      </ul>
      {a.data && q.data && !toMark.length && !qToMark.length && <Empty>Nothing is waiting to be graded.</Empty>}
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

const TABS = ["overview", "students", "programmes", "calendar", "sessions", "assignments", "assessments", "attendance", "messages", "resources", "profile"] as const;
type Tab = (typeof TABS)[number];
type Perf = { studentsTaught: number; activeStudents: number; sessions: { completed: number; missed: number; cancelled: number; awaitingAttendance: number }; attendancePct: number | null; rating: { average: number | null; count: number }; grading: { waiting: number }; reviews: { rating: number; comment: string | null }[] };
type Module = { id: string; title: string; description: string | null; lessons: { id: string; title: string }[] };

// One programme the instructor teaches: its students and its curriculum (read-only; the Academy edits curricula).
function ProgrammeBlock({ slug, name, students }: { slug: string; name: string; students: Student[] }) {
  const c = useLoad<{ courses: Module[] }>(`/api/app/programmes/${slug}/courses`);
  return (
    <Card title={name} action={<span className="text-sm text-ink/70">{students.length} student{students.length === 1 ? "" : "s"}</span>}>
      <p className="text-sm font-semibold text-ink/75">Curriculum</p>
      {c.data?.courses.length ? <ol className="mt-2 divide-y divide-ink/[0.07] rounded-lg border border-ink/10">{c.data.courses.map((m, i) => <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3"><span><b className="font-semibold">Module {i + 1}: {m.title}</b>{m.description && <span className="block text-sm text-ink/70">{m.description}</span>}</span><span className="shrink-0 text-sm text-ink/70">{m.lessons.length} topics</span></li>)}</ol> : <div className="mt-2"><Empty>The Academy has not published the modules for this programme yet.</Empty></div>}
    </Card>
  );
}

// A new instructor sees only their onboarding profile until the Academy verifies it.
function Onboarding({ me }: { me: Me }) {
  const nav: NavItem<"profile">[] = [{ id: "profile", label: "My faculty profile", icon: "user" }];
  const submitted = !!me.profileSubmittedAt;
  return (
    <AppShell me={me} nav={nav} tab="profile" setTab={() => undefined}>
      <div className="mb-6 rounded-xl border border-ink/10 border-l-4 border-l-indigo bg-white p-6 sm:p-7">
        <p className="text-sm font-semibold text-indigo">Faculty onboarding</p>
        <h1 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">{submitted ? "Your profile is with the Academy for verification." : `Congratulations, ${me.fullName.split(" ")[0]}. Welcome to the faculty.`}</h1>
        <p className="mt-2 max-w-3xl text-[0.95rem] text-ink/75">{submitted
          ? "We are checking your details and certifications. You will be emailed as soon as it is verified; the verified badge then shows next to your name and your full workspace opens. You can still update your profile below."
          : "Complete your faculty profile and submit it. The Academy verifies your information, then your verified badge appears and your teaching workspace opens."}</p>
        <ol className="mt-5 flex flex-wrap gap-2 text-sm font-semibold">
          {["Complete your profile", "Submit for verification", "Academy review", "Verified badge"].map((s, i) => {
            const done = submitted ? i < 2 : false, now = submitted ? i === 2 : i === 0;
            return <li key={s} className={`rounded-md px-3 py-1.5 ${done ? "bg-indigo text-white" : now ? "bg-brand-orange/20 text-ink ring-1 ring-brand-orange" : "bg-ink/[0.05] text-ink/75"}`}>{i + 1}. {s}{done ? " ✓" : now ? " (now)" : ""}</li>;
          })}
        </ol>
      </div>
      <InstructorProfileForm me={me} onboarding />
    </AppShell>
  );
}

export function InstructorDashboard({ me }: { me: Me }) {
  if (me.verified === false) return <Onboarding me={me} />;
  return <Workspace me={me} />;
}

function Workspace({ me }: { me: Me }) {
  const [tab, setTab] = useTab(TABS, "overview");
  const now = useNow();
  const st = useLoad<{ students: Student[] }>("/api/app/instructor/students");
  const perf = useLoad<{ performance: Perf }>("/api/app/instructor/performance");
  const msgs = useLoad<{ contacts: { id: string; fullName: string; unread: number; lastAt: string | null; lastMessage: string | null }[]; unread: number }>("/api/app/messages");
  const asg = useLoad<{ assignments: Work[] }>("/api/app/instructor/assignments");
  const qz = useLoad<{ quizzes: Work[] }>("/api/app/instructor/quizzes");
  const today = now ? lagosDay(new Date(now).toISOString()) : null;
  const range = useLoad<{ sessions: S[]; pendingOutcomes: S[] }>(today ? `/api/app/instructor/sessions?from=${addDays(today, -28)}&to=${addDays(today, 34)}` : null);
  const notes = useNotifications();
  const [pick, setPick] = useState<string | null>(null);
  const detail = useLoad<{ student: { fullName: string; email: string; phone: string | null; studentNo: string | null; bio: string | null }; progress: Progress[] }>(pick ? `/api/app/instructor/students/${pick}` : null);
  const students = st.data?.students ?? [];
  const groups = students.reduce<Record<string, Student[]>>((m, s) => { (m[s.programme] ??= []).push(s); return m; }, {});
  const p = perf.data?.performance;
  const programmes = [...new Map(students.map((s) => [s.programme, { slug: s.programme, name: s.programmeName }])).values()];
  const sessions = range.data?.sessions ?? [];
  const todays = sessions.filter((x) => today && lagosDay(x.startsAt) === today && x.status !== "cancelled");
  const upcoming = sessions.filter((x) => now && Date.parse(x.startsAt) > now && today && lagosDay(x.startsAt) !== today && x.status === "scheduled").slice(0, 5);
  const toGrade = [...(asg.data?.assignments ?? []).filter((x) => x.status === "submitted" || x.status === "submitted_late").map((x) => ({ ...x, type: "Assignment", to: "assignments" as Tab })),
    ...(qz.data?.quizzes ?? []).filter((x) => x.status === "submitted").map((x) => ({ ...x, type: x.kind === "assessment" ? "Assessment" : "Quiz", to: "assessments" as Tab }))];
  const go = (t: Tab) => setTab(t);
  const events: CalEvent[] = useMemo(() => [
    ...sessions.filter((x) => x.status !== "cancelled").map((x) => ({ id: `s${x.id}`, at: x.startsAt, title: `${x.student.fullName} · ${x.programmeName}`, kind: "class" as const, meta: `${x.durationMin} min${x.meetUrl ? "" : " · Meet link needed"}`, status: x.status === "scheduled" ? undefined : x.status, onOpen: () => go("sessions") })),
    ...(asg.data?.assignments ?? []).map((x) => ({ id: `a${x.id}`, at: x.dueAt, title: `${x.title} · ${x.studentName}`, kind: "assignment" as const, status: x.status.replace(/_/g, " "), onOpen: () => go("assignments") })),
    ...(qz.data?.quizzes ?? []).map((x) => ({ id: `q${x.id}`, at: x.dueAt, title: `${x.title} · ${x.studentName}`, kind: (x.kind === "assessment" ? "assessment" : "quiz") as CalEvent["kind"], status: x.status.replace(/_/g, " "), onOpen: () => go("assessments") })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [range.data, asg.data, qz.data]);
  const workTable = (rows: Work[], kindLabel: (w: Work) => string) => rows.length ? (
    <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[36rem] text-left text-[0.95rem]">
      <thead><tr className="border-b border-ink/10 text-sm text-ink/70"><th className="px-2 py-2 font-semibold">Title</th><th className="px-2 py-2 font-semibold">Student</th><th className="px-2 py-2 font-semibold">Type</th><th className="px-2 py-2 font-semibold">Due</th><th className="px-2 py-2 font-semibold">Status</th></tr></thead>
      <tbody>{[...rows].sort((a, b) => b.dueAt.localeCompare(a.dueAt)).map((w) => <tr key={w.id} className="border-b border-ink/[0.06] last:border-0"><td className="px-2 py-2.5 font-semibold">{w.title}</td><td className="px-2 py-2.5">{w.studentName}</td><td className="px-2 py-2.5 capitalize">{kindLabel(w)}</td><td className="px-2 py-2.5 text-ink/75">{w.dueText}</td><td className="px-2 py-2.5"><Badge s={w.status} /></td></tr>)}</tbody>
    </table></div>) : <Empty>Nothing set yet.</Empty>;

  const nav: NavItem<Tab>[] = [
    { id: "overview", label: "Overview", icon: "home" },
    { id: "students", label: "My Students", icon: "users" },
    { id: "programmes", label: "My Programmes", icon: "school" },
    { id: "calendar", label: "Teaching Calendar", icon: "calendar" },
    { id: "sessions", label: "Class Sessions", icon: "play" },
    { id: "assignments", label: "Assignments", icon: "clipboard", badge: toGrade.filter((x) => x.to === "assignments").length },
    { id: "assessments", label: "Assessments", icon: "check", badge: toGrade.filter((x) => x.to === "assessments").length },
    { id: "attendance", label: "Attendance", icon: "list", badge: range.data?.pendingOutcomes.length },
    { id: "messages", label: "Messages", icon: "mail", badge: msgs.data?.unread },
    { id: "resources", label: "Academic Resources", icon: "folder" },
    { id: "profile", label: "Instructor Profile", icon: "user" },
  ];
  return (
    <AppShell me={me} nav={nav} tab={tab} setTab={setTab} primary={8}>
      {tab === "overview" && <>
        <PageTitle title={<span className="inline-flex items-center gap-2">Welcome, {me.fullName.split(" ")[0]}.{me.verified && <VerifiedBadge />}</span>} sub={<>{me.headline ?? "Faculty"}{me.staffNo ? <> · Faculty No <b className="font-semibold text-ink">{me.staffNo}</b></> : null}</>} />
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {!!range.data?.pendingOutcomes.length && <section className="rounded-xl border border-ink/10 border-l-4 border-l-brand-orange bg-white p-5"><h2 className="font-display text-lg font-semibold">Attendance to record</h2><p className="mt-1 text-[0.95rem] text-ink/75">{range.data.pendingOutcomes.length} finished class{range.data.pendingOutcomes.length > 1 ? "es need" : " needs"} an outcome (completed or missed).</p><div className="mt-3"><Btn small onClick={() => go("attendance")}>Record attendance</Btn></div></section>}
            <Card title="Today's classes" action={<button onClick={() => go("sessions")} className="text-sm font-semibold text-indigo hover:underline">All sessions</button>}>
              {todays.length ? <ul className="space-y-3">{todays.map((x) => <SessionRow key={x.id} s={x} reload={range.reload} />)}</ul> : <Empty>No classes today.</Empty>}
            </Card>
            <Card title="Assignments awaiting grading" action={toGrade.length ? <span className="text-sm text-ink/70">{toGrade.length} waiting</span> : null}>
              {toGrade.length ? <ul className="divide-y divide-ink/[0.07]">{toGrade.slice(0, 6).map((w) => <li key={w.id} className="flex items-center justify-between gap-3 py-3"><span><b className="font-semibold">{w.title}</b><span className="block text-sm text-ink/70">{w.type} · {w.studentName} · <Badge s={w.status} /></span></span><Btn small kind="ghost" onClick={() => go(w.to)}>Grade</Btn></li>)}</ul> : <Empty>Nothing is waiting to be graded.</Empty>}
            </Card>
            <Card title="Recent academic activity">
              {notes.data?.notifications.length ? <ul className="divide-y divide-ink/[0.07]">{notes.data.notifications.slice(0, 6).map((n) => <li key={n.id} className="py-3"><p className="font-semibold">{n.title}</p>{n.body && <p className="text-[0.95rem] text-ink/75">{n.body}</p>}<p className="text-sm text-ink/65">{when(n.created_at)}</p></li>)}</ul> : <Empty>No recent activity.</Empty>}
            </Card>
          </div>
          <div className="space-y-6">
            <Card title="Upcoming classes" action={<button onClick={() => go("calendar")} className="text-sm font-semibold text-indigo hover:underline">Calendar</button>}>
              {upcoming.length ? <ul className="space-y-2.5">{upcoming.map((x) => <li key={x.id} className="text-[0.95rem]"><b className="font-semibold">{x.student.fullName}</b><span className="block text-sm text-ink/70">{x.lagosTime} · {x.programmeName}{x.meetUrl ? "" : " · Meet link needed"}</span></li>)}</ul> : <Empty>No further classes this week.</Empty>}
            </Card>
            <Card title="New student messages" action={<button onClick={() => go("messages")} className="text-sm font-semibold text-indigo hover:underline">Messages</button>}>
              {(msgs.data?.contacts ?? []).filter((c) => c.unread).length ? <ul className="space-y-2.5">{msgs.data!.contacts.filter((c) => c.unread).map((c) => <li key={c.id}><b className="font-semibold">{c.fullName}</b> <span className="text-sm text-ink/70">({c.unread} new)</span>{c.lastMessage && <span className="block truncate text-sm text-ink/75">{c.lastMessage}</span>}</li>)}</ul> : <Empty>No unread messages.</Empty>}
            </Card>
            <Card title="At a glance">
              <dl className="space-y-2 text-[0.95rem]">
                <div className="flex justify-between"><dt className="text-ink/70">Active students</dt><dd className="font-semibold">{p?.activeStudents ?? "…"}</dd></div>
                <div className="flex justify-between"><dt className="text-ink/70">Classes completed</dt><dd className="font-semibold">{p?.sessions.completed ?? "…"}</dd></div>
                <div className="flex justify-between"><dt className="text-ink/70">Attendance</dt><dd className="font-semibold">{p?.attendancePct != null ? `${p.attendancePct}%` : "–"}</dd></div>
                <div className="flex justify-between"><dt className="text-ink/70">Student rating</dt><dd className="font-semibold">{p?.rating.average ?? "–"}</dd></div>
              </dl>
            </Card>
          </div>
        </div>
      </>}

      {tab === "students" && <>
        <PageTitle title="My Students" sub="Figures are calculated from class, attendance and coursework records, and update as records change." />
        <StudentCards onOpen={(id) => setPick(id)} selected={pick} />
        <h2 className="mb-3 mt-8 font-display text-lg font-semibold">Student record</h2>
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[1fr_1.5fr]">
          <Card title={`Students (${students.length})`}>
            {Object.entries(groups).map(([slug, ss]) => (
              <div key={slug} className="mb-4 last:mb-0"><p className="border-b border-ink/10 pb-1 text-sm font-semibold text-ink/75">{ss[0].programmeName} · {ss.length}</p>
                <ul className="mt-2 space-y-1">{ss.map((x) => <li key={x.enrolmentId}><button onClick={() => setPick(x.student.id)} aria-pressed={pick === x.student.id} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${pick === x.student.id ? "bg-indigo/[0.08] ring-1 ring-indigo" : "hover:bg-ink/[0.04]"}`}><Avatar src={x.student.photo} name={x.student.fullName} size={34} /><span className="flex-1"><span className="block font-semibold">{x.student.fullName}</span><span className="block text-sm text-ink/70">{x.student.studentNo ?? ""}</span></span><Badge s={x.status} /></button></li>)}</ul></div>
            ))}
            {st.data && !students.length && <Empty>No students assigned yet.</Empty>}
          </Card>
          {pick && detail.data ? <Card title={detail.data.student.fullName}>
            <p className="text-[0.95rem] text-ink/75">{detail.data.student.email}{detail.data.student.phone ? ` · ${detail.data.student.phone}` : ""}{detail.data.student.studentNo ? ` · ${detail.data.student.studentNo}` : ""}</p>
            {detail.data.student.bio && <p className="mt-2">{detail.data.student.bio}</p>}
            <div className="mt-4 space-y-5">{detail.data.progress.map((pr) => <ProgressView key={pr.enrolmentId} p={pr} />)}</div>
          </Card> : <Card><Empty>Select a student to see their progress.</Empty></Card>}
          {pick && detail.data && <div className="space-y-6 lg:col-start-2">{detail.data.progress.map((pr) => <StaffWeekly key={pr.enrolmentId} enrolmentId={pr.enrolmentId} canAssign />)}</div>}
        </div>
      </>}

      {tab === "programmes" && <>
        <PageTitle title="My Programmes" sub="The programmes you teach, with their curriculum." />
        <div className="space-y-6">{programmes.map((pr) => <ProgrammeBlock key={pr.slug} slug={pr.slug} name={pr.name} students={groups[pr.slug] ?? []} />)}{st.data && !programmes.length && <Card><Empty>You will see your programmes once students are assigned to you.</Empty></Card>}</div>
      </>}

      {tab === "calendar" && <><PageTitle title="Teaching Calendar" sub="Your teaching commitments at a glance: every scheduled class and the deadlines you have set. Open Class Sessions to teach. Times are Lagos time (WAT)." /><AcademicCalendar events={events} now={now} title="Teaching calendar" /></>}

      {tab === "sessions" && <><PageTitle title="Class Sessions" sub="Choose a class on the left to open its teaching screen. Times are Lagos time (WAT)." /><ClassSessions students={students} /></>}

      {tab === "assignments" && <>
        <PageTitle title="Assignments" />
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-2"><Marking only="assignments" /><SetWork students={students} kinds={["assignment"]} /></div>
        <div className="mt-6"><Card title="All assignments set">{workTable(asg.data?.assignments ?? [], () => "assignment")}</Card></div>
      </>}

      {tab === "assessments" && <>
        <PageTitle title="Assessments" sub="Quizzes and assessments, including timed and written ones." />
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-2"><Marking only="quizzes" /><SetWork students={students} kinds={["quiz", "assessment"]} /></div>
        <div className="mt-6"><Card title="All quizzes and assessments set">{workTable(qz.data?.quizzes ?? [], (w) => w.kind ?? "quiz")}</Card></div>
      </>}

      {tab === "attendance" && <>
        <PageTitle title="Attendance" sub="Record each finished class. Your records update the student's attendance immediately." />
        <div className="mb-6"><Card title={`To record (${range.data?.pendingOutcomes.length ?? 0})`}>{range.data?.pendingOutcomes.length ? <ul className="space-y-3">{range.data.pendingOutcomes.map((x) => <SessionRow key={x.id} s={x} reload={range.reload} />)}</ul> : <Empty>All attendance is recorded.</Empty>}</Card></div>
        <AttendancePanel />
      </>}

      {tab === "messages" && <><PageTitle title="Messages" sub="Private conversations with your students." /><div className="max-w-3xl"><Messages /></div></>}
      {tab === "resources" && <><PageTitle title="Academic Resources" sub="Upload or link materials for your programmes. An administrator approves them before students see them." /><div className="max-w-4xl"><MaterialsManager admin={false} programmes={programmes} /></div></>}
      {tab === "profile" && <>
        <PageTitle title="Instructor Profile" sub="Your faculty profile and teaching record." />
        <div className="space-y-6">
          <Card title="Teaching record">
            {p ? <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Classes completed" value={p.sessions.completed} note={`${p.sessions.missed} missed · ${p.sessions.cancelled} cancelled`} />
                <Stat label="Attendance" value={p.attendancePct != null ? `${p.attendancePct}%` : "–"} />
                <Stat label="Rating" value={p.rating.average ?? "–"} note={`${p.rating.count} student rating${p.rating.count === 1 ? "" : "s"}`} />
                <Stat label="Awaiting grading" value={p.grading.waiting} />
              </div>
              <ul className="mt-4 space-y-2">{p.reviews.filter((r) => r.comment).slice(0, 3).map((r, i) => <li key={i} className="rounded-lg bg-ink/[0.03] p-3">“{r.comment}” <span className="text-ink/70">({r.rating}★)</span></li>)}</ul>
            </> : <Empty>Loading…</Empty>}
          </Card>
          <MeetSettings />
          <InstructorProfileForm me={me} onboarding={false} />
        </div>
      </>}
    </AppShell>
  );
}

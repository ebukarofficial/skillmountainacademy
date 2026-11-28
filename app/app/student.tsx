"use client";
// The student's learning space, laid out like an academic learning environment: Home answers "what am I studying,
// what must I do, when is my next class, has my instructor written, how am I doing"; then My Programme (modules),
// Learning Materials, Assignments, Assessments, Calendar, Messages, Notifications and Profile.
// Everything shown comes from the student's own records; nothing is invented.
import { useMemo, useState } from "react";
import type { Me } from "./page";
import { Messages, ProfileEditor, ProgressView, type Progress } from "./shared";
import { StudentWeekly } from "./weekly";
import { api, Avatar, Badge, Bar, Btn, Card, Empty, inputCls, Msg, naira, PageTitle, upload, useAction, useLoad, useNow, useTab, VerifiedBadge, when } from "./ui";
import { AppShell, Icon, NotificationsPage, targetOf, useNotifications, type NavItem, type Note } from "./shell";
import { AcademicCalendar, UpcomingList, type CalEvent } from "./calendar";
import { firstName, ProgressRing, StatCard, StatGrid, WelcomeHero } from "./dash";

type Session = { id: string; programmeName: string; startsAt: string; endsAt: string; lagosTime: string; durationMin: number; status: string; meetUrl: string | null; meetStatus: string; joinOpen: boolean; instructor: { fullName: string } | null };
type Overview = { enrolments: { id: string; programme: string; programmeName: string; status: string; startedAt: string; instructor: { id: string; fullName: string; email: string; bio: string | null; photo: string | null; specialization: string | null; verified?: boolean; headline?: string | null } | null; timetable: { day: string; startTime: string; durationMin: number } | null }[]; nextSession: Session | null };
type Assignment = { id: string; title: string; description: string | null; dueAt: string; dueText: string; programme?: string; status: string; maxScore: number; submission: { text: string | null; fileName: string | null } | null; grade: { score: number; feedback: string | null } | null };
type Quiz = { id: string; kind: string; title: string; instructions: string | null; durationMin: number | null; dueAt: string; dueText: string; programme?: string; status: string; score: number | null; maxScore: number; feedback: string | null;
  questions: { n?: number; type: string; prompt: string; options?: string[]; points: number; answer?: number }[]; answers: (number | string | null)[] | null };

const left = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `${d} day${d > 1 ? "s" : ""}${h % 24 ? ` ${h % 24} h` : ""}` : `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

// The next live class: prominent, but a white card rather than a dark banner.
function NextClass({ s, now }: { s: Session | null; now: number }) {
  if (!s) return (
    <Card title="Next class">
      <p className="text-[0.95rem] text-ink/75">Your weekly class time is being arranged. It appears here as soon as the Academy confirms it, and you will be notified.</p>
    </Card>
  );
  const start = Date.parse(s.startsAt), live = now >= start && now < Date.parse(s.endsAt);
  const date = new Date(s.startsAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });
  const t = new Date(s.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
  return (
    <section aria-labelledby="next-class" className="rounded-xl border border-ink/10 border-l-4 border-l-indigo bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="next-class" className="font-display text-lg font-semibold">Next class</h2>
        {now > 0 && <span className={`rounded-md px-2.5 py-1 text-sm font-semibold ${live ? "bg-brand-orange/20 text-ink" : "bg-indigo/[0.08] text-indigo"}`}>{live ? "In session now" : now < start ? `Starts in ${left(start - now)}` : "Ended"}</span>}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[0.95rem] sm:grid-cols-2">
        <div><dt className="text-sm text-ink/65">Date</dt><dd className="font-semibold">{date}</dd></div>
        <div><dt className="text-sm text-ink/65">Time (Lagos)</dt><dd className="font-semibold">{t} · {s.durationMin} minutes</dd></div>
        <div><dt className="text-sm text-ink/65">Programme</dt><dd className="font-semibold">{s.programmeName}</dd></div>
        <div><dt className="text-sm text-ink/65">Instructor</dt><dd className="font-semibold">{s.instructor?.fullName ?? "Being assigned"}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {s.joinOpen && s.meetUrl
          ? <a href={s.meetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo px-5 font-display text-[0.95rem] font-semibold text-white hover:bg-navy"><Icon name="play" /> Join the live session</a>
          : <p className="text-[0.95rem] text-ink/75">{s.meetUrl ? "Your Google Meet link is ready. The Join button appears 15 minutes before class." : "Your instructor has not added the meeting link yet. You will be notified when they do."}</p>}
      </div>
    </section>
  );
}

function Assistant() {
  const { data, reload } = useLoad<{ available: boolean; history: { role: string; content: string }[]; remainingToday: number }>("/api/app/student/assistant");
  const [q, setQ] = useState("");
  const [sources, setSources] = useState<{ title: string }[]>([]);
  const { busy, msg, run } = useAction();
  return (
    <Card title="Learning assistant" action={data ? <span className="text-xs text-ink/60">{data.remainingToday} questions left today</span> : null}>
      {data && !data.available ? <Empty>The assistant is not switched on yet. Please message your instructor.</Empty> : <>
        <p className="mb-2 text-xs text-ink/60">Helps with your programme using approved materials. It guides you; it does not do graded work, and your instructor has the final word.</p>
        <ul className="max-h-[28rem] min-h-48 space-y-3 overflow-auto rounded-xl bg-ink/[0.03] p-4" aria-live="polite">
          {data?.history.map((m, i) => <li key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "ml-auto rounded-br-md bg-indigo text-white" : "rounded-bl-md border border-ink/[0.07] bg-white"}`}>{m.content}</li>)}
          {!data?.history.length && <li className="text-sm text-ink/60">Ask anything about your lessons, assignments or practical work.</li>}
          {busy && <li className="text-sm text-ink/60">Thinking…</li>}
        </ul>
        {!!sources.length && <p className="mt-1 text-xs text-ink/60">Based on: {sources.map((s) => s.title).join(", ")}</p>}
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) run(async () => { const r = await api<{ sources: { title: string }[] }>("/api/app/student/assistant", { method: "POST", body: { message: q } }); setSources(r.sources); }, "", () => { setQ(""); reload(); }); }}>
          <label htmlFor="ask" className="sr-only">Ask the assistant</label>
          <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} maxLength={2000} className={`${inputCls} mt-0`} placeholder="Ask a question about your lessons" />
          <Btn type="submit" disabled={busy}>Ask</Btn>
        </form>
        <Msg text={msg.text} kind={msg.kind} />
      </>}
    </Card>
  );
}

function AssignmentItem({ a, reload }: { a: Assignment; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(a.submission?.text ?? "");
  const { busy, msg, run } = useAction();
  const locked = a.status === "graded";
  return (
    <li className="rounded-lg border border-ink/10 bg-white p-4">
      <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b className="text-[0.95rem]">{a.title}</b><span className="block text-sm text-ink/70">Due {a.dueText}</span></span><Badge s={a.status} />
      </button>
      {open && <div className="mt-2 space-y-2 text-sm">
        {a.description && <p className="whitespace-pre-wrap text-ink/80">{a.description}</p>}
        {a.grade && <p className="rounded-lg bg-ink/[0.03] p-3"><b>Score: {a.grade.score}/{a.maxScore}</b>{a.grade.feedback ? ` · ${a.grade.feedback}` : ""}</p>}
        {!locked && <>
          <label className="sr-only" htmlFor={`t-${a.id}`}>Your answer</label>
          <textarea id={`t-${a.id}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="Type your answer or notes" />
          <div className="flex flex-wrap items-center gap-2">
            <Btn small disabled={busy || !text.trim()} onClick={() => run(() => api(`/api/app/student/assignments/${a.id}/submission`, { method: "POST", body: { text } }), "Submitted.", reload)}>Submit text</Btn>
            <label className="cursor-pointer rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-indigo/40">Upload a file<input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => upload(`/api/app/student/assignments/${a.id}/submission/file`, f), "File uploaded.", reload); }} /></label>
            {a.submission?.fileName && <a href={`/api/app/files/submission/${a.id}`} className="text-xs underline">{a.submission.fileName}</a>}
          </div>
        </>}
        <Msg text={msg.text} kind={msg.kind} />
      </div>}
    </li>
  );
}

function QuizItem({ q, reload }: { q: Quiz; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<(number | string | null)[]>([]);
  const { busy, msg, run } = useAction();
  const taking = q.status === "in_progress";
  return (
    <li className="rounded-lg border border-ink/10 bg-white p-4">
      <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b className="text-[0.95rem]">{q.title}</b><span className="block text-sm text-ink/70">{q.kind} · due {q.dueText}{q.durationMin ? ` · ${q.durationMin} min` : ""}</span></span><Badge s={q.status} />
      </button>
      {open && <div className="mt-2 space-y-3 text-sm">
        {q.instructions && <p className="text-ink/80">{q.instructions}</p>}
        {q.status === "graded" && <p className="rounded-lg bg-ink/[0.03] p-3"><b>Score: {q.score}/{q.maxScore}</b>{q.feedback ? ` · ${q.feedback}` : ""}</p>}
        {q.status === "open" && <Btn small disabled={busy} onClick={() => run(() => api(`/api/app/student/quizzes/${q.id}/start`, { method: "POST" }), "", reload)}>Start{q.durationMin ? ` (${q.durationMin} min timer)` : ""}</Btn>}
        {taking && <form onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/app/student/quizzes/${q.id}/submit`, { method: "POST", body: { answers } }), "Submitted.", reload); }} className="space-y-3">
          {q.questions.map((qq, i) => (
            <fieldset key={i} className="rounded-lg border border-ink/10 p-3">
              <legend className="font-semibold">{i + 1}. {qq.prompt} <span className="text-xs text-ink/65">({qq.points} pt)</span></legend>
              {qq.type === "mcq" ? qq.options!.map((o, k) => (
                <label key={k} className="mt-1 flex items-center gap-2"><input type="radio" name={`q${i}`} onChange={() => { const a = [...answers]; a[i] = k; setAnswers(a); }} className="accent-indigo" />{o}</label>
              )) : <textarea rows={3} className={inputCls} aria-label={`Answer ${i + 1}`} onChange={(e) => { const a = [...answers]; a[i] = e.target.value; setAnswers(a); }} />}
            </fieldset>
          ))}
          <Btn type="submit" disabled={busy}>Submit answers</Btn>
        </form>}
        {q.status === "graded" && q.questions.map((qq, i) => qq.type === "mcq" && <p key={i} className="text-xs">{i + 1}. {qq.prompt}: correct answer <b>{qq.options![qq.answer!]}</b>{q.answers?.[i] !== qq.answer ? " (yours was different)" : " ✓"}</p>)}
        <Msg text={msg.text} kind={msg.kind} />
      </div>}
    </li>
  );
}

const TABS = ["home", "programme", "materials", "assignments", "assessments", "calendar", "messages", "notifications", "profile"] as const;
type Tab = (typeof TABS)[number];
type Pay = { orders: { reference: string; programme: string; plan: string; totalNaira: number; paidNaira: number; outstandingNaira: number; status: string; parts: { part: number; naira: number; due: string; status: string; payLink: string | null }[] }[] };
type Lesson = { id: string; title: string; objectives: string | null; completedAt?: string | null };
type Module = { id: string; title: string; description: string | null; lessons: Lesson[] };
type Contact = { id: string; fullName: string; photo: string | null; unread: number; lastAt: string | null; lastMessage: string | null };
type Resource = { id: string; title: string; kind: string; url: string | null; file: string | null };

const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

// A Brightspace-style module card: title, completion bar and "x/y topics completed"; opens to its lessons.
function ModuleCard({ m, n, reload, current }: { m: Module; n: number; reload: () => void; current: boolean }) {
  const [open, setOpen] = useState(current);
  const { busy, msg, run } = useAction();
  const done = m.lessons.filter((l) => l.completedAt).length;
  return (
    <li className={`rounded-xl border bg-white ${current ? "border-indigo" : "border-ink/10"}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-4 p-5 text-left">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg font-display text-base font-semibold ${done === m.lessons.length && m.lessons.length ? "bg-indigo text-white" : "bg-indigo/[0.08] text-indigo"}`}>{n}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="font-display text-lg font-semibold text-indigo">{m.title}</span>{current && <span className="rounded-md bg-brand-orange/20 px-2 py-0.5 text-xs font-semibold text-ink">Current module</span>}</span>
          {m.description && <span className="mt-0.5 block text-[0.95rem] text-ink/75">{m.description}</span>}
          <span className="mt-3 block h-2 rounded-full bg-ink/[0.08]" role="progressbar" aria-label={`${m.title} completion`} aria-valuenow={pctOf(done, m.lessons.length)} aria-valuemin={0} aria-valuemax={100}><span className="block h-2 rounded-full bg-indigo" style={{ width: `${pctOf(done, m.lessons.length)}%` }} /></span>
          <span className="mt-1.5 block text-sm text-ink/75">{done}/{m.lessons.length} topics completed</span>
        </span>
        <Icon name="down" className={`mt-1 h-5 w-5 shrink-0 text-ink/60 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="border-t border-ink/10 px-5 py-2">
          {m.lessons.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 border-b border-ink/[0.06] py-3 last:border-0">
              <span className="flex items-start gap-3">
                <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${l.completedAt ? "bg-indigo text-white" : "border-2 border-ink/25"}`}>{l.completedAt ? "✓" : ""}</span>
                <span><span className="block font-semibold">{l.title}</span>{l.objectives && <span className="block text-sm text-ink/70">{l.objectives}</span>}<span className="block text-sm text-ink/65">{l.completedAt ? "Completed" : "Not yet completed"}</span></span>
              </span>
              <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/student/lessons/${l.id}/complete`, { method: l.completedAt ? "DELETE" : "POST" }), "", reload)}>{l.completedAt ? "Mark as not done" : "Mark complete"}</Btn>
            </li>
          ))}
          {!m.lessons.length && <li className="py-3"><Empty>Topics for this module are being published.</Empty></li>}
          <li><Msg text={msg.text} kind={msg.kind} /></li>
        </ul>
      )}
    </li>
  );
}

export function StudentDashboard({ me }: { me: Me }) {
  const [tab, setTab] = useTab(TABS, "home");
  const ov = useLoad<Overview>("/api/app/student/overview");
  const sessions = useLoad<{ sessions: Session[] }>("/api/app/student/sessions");
  const asg = useLoad<{ assignments: Assignment[] }>("/api/app/student/assignments");
  const quizzes = useLoad<{ quizzes: Quiz[] }>("/api/app/student/quizzes");
  const res = useLoad<{ resources: Resource[] }>(tab === "home" || tab === "materials" ? "/api/app/resources" : null);
  const prog = useLoad<{ progress: Progress[] }>(`/api/app/students/${me.id}/progress`);
  const pay = useLoad<Pay>(tab === "profile" ? "/api/app/student/payments" : null);
  const msgs = useLoad<{ contacts: Contact[]; unread: number }>("/api/app/messages");
  const notes = useNotifications();
  const e0 = ov.data?.enrolments[0];
  const mods = useLoad<{ courses: Module[] }>(e0 ? `/api/app/programmes/${e0.programme}/courses` : null);
  const now = useNow();

  const assignments = asg.data?.assignments ?? [];
  const allQuizzes = quizzes.data?.quizzes ?? [];
  const todoA = assignments.filter((a) => a.status === "pending" || a.status === "overdue");
  const todoQ = allQuizzes.filter((q) => q.status === "open" || q.status === "in_progress");
  const tasks = [
    ...todoA.map((a) => ({ id: a.id, title: a.title, type: "Assignment", due: a.dueAt, dueText: a.dueText, status: a.status, to: "assignments" as Tab })),
    ...todoQ.map((q) => ({ id: q.id, title: q.title, type: q.kind === "assessment" ? "Assessment" : "Quiz", due: q.dueAt, dueText: q.dueText, status: q.status, to: "assessments" as Tab })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  const p0 = prog.data?.progress[0];
  const ins = e0?.instructor ?? null;
  const modules = mods.data?.courses ?? [];
  const current = modules.find((m) => m.lessons.some((l) => !l.completedAt)) ?? null;
  const modulesDone = modules.filter((m) => m.lessons.length && m.lessons.every((l) => l.completedAt)).length;
  const goTab = (t: Tab) => setTab(t);

  const events: CalEvent[] = useMemo(() => [
    ...(sessions.data?.sessions ?? []).filter((x) => x.status !== "cancelled").map((x) => ({ id: `s${x.id}`, at: x.startsAt, title: x.programmeName, kind: "class" as const, meta: `${x.durationMin} min${x.instructor ? ` with ${x.instructor.fullName}` : ""}`, status: x.status === "scheduled" ? undefined : x.status.replace(/_/g, " "), onOpen: () => goTab("calendar") })),
    ...assignments.map((a) => ({ id: `a${a.id}`, at: a.dueAt, title: a.title, kind: "assignment" as const, status: a.status.replace(/_/g, " "), onOpen: () => goTab("assignments") })),
    ...allQuizzes.map((q) => ({ id: `q${q.id}`, at: q.dueAt, title: q.title, kind: (q.kind === "assessment" ? "assessment" : "quiz") as CalEvent["kind"], status: q.status.replace(/_/g, " "), onOpen: () => goTab("assessments") })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sessions.data, asg.data, quizzes.data]);

  // Announcements and messages: notices and the latest message from each contact, newest first.
  const feed = [
    ...(notes.data?.notifications ?? []).filter((n) => !/^message/.test(n.kind)).map((n) => ({ id: n.id, at: n.created_at, title: n.title, body: n.body, unread: !n.read_at, note: n as Note | null, contact: null as Contact | null })),
    ...(msgs.data?.contacts ?? []).filter((c) => c.lastAt).map((c) => ({ id: `m${c.id}`, at: c.lastAt!, title: `Message from ${c.fullName}`, body: c.lastMessage, unread: c.unread > 0, note: null, contact: c })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const nav: NavItem<Tab>[] = [
    { id: "home", label: "Home", icon: "home" },
    { id: "programme", label: "My Programme", icon: "school" },
    { id: "materials", label: "Learning Materials", icon: "folder" },
    { id: "assignments", label: "Assignments", icon: "clipboard", badge: todoA.length },
    { id: "assessments", label: "Assessments", icon: "check", badge: todoQ.length },
    { id: "calendar", label: "Calendar", icon: "calendar" },
    { id: "messages", label: "Messages", icon: "mail", badge: msgs.data?.unread },
    { id: "notifications", label: "Notifications", icon: "bell", badge: notes.data?.unread },
    { id: "profile", label: "Profile", icon: "user" },
  ];

  const myProgramme = (
    <Card title="My Programme">
      {e0 ? <>
        <p className="font-display text-lg font-semibold">{e0.programmeName}</p>
        <dl className="mt-3 space-y-2.5 text-[0.95rem]">
          <div className="flex justify-between gap-3"><dt className="text-ink/70">Instructor</dt><dd className="flex items-center gap-1 text-right font-semibold">{ins ? <>{ins.fullName}{ins.verified && <VerifiedBadge />}</> : "Being assigned"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink/70">Current module</dt><dd className="text-right font-semibold">{current?.title ?? (modules.length ? "All modules completed" : "Being published")}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink/70">Status</dt><dd><Badge s={e0.status} /></dd></div>
          {e0.timetable && <div className="flex justify-between gap-3"><dt className="text-ink/70">Weekly class</dt><dd className="text-right font-semibold">{e0.timetable.day}s, {e0.timetable.startTime}</dd></div>}
        </dl>
        <div className="mt-4"><Bar pct={p0 ? p0.overall : null} label="Programme progress" /></div>
        <div className="mt-4"><Btn onClick={() => goTab("programme")}>Continue learning</Btn></div>
      </> : <Empty>Your programme appears here once your admission is complete.</Empty>}
    </Card>
  );

  return (
    <AppShell me={me} nav={nav} tab={tab} setTab={setTab} context={e0?.programmeName} primary={9}>
      {tab === "home" && <>
        <WelcomeHero name={me.fullName} eyebrow="Your learning space" title={<>Welcome, {firstName(me.fullName)}.</>}
          sub={<span className="flex flex-wrap gap-x-3">{e0 ? <span>{e0.programmeName}</span> : <span>Your programme appears here once your admission is complete.</span>}{me.studentNo && <span>Registration No: <b className="font-semibold text-ink">{me.studentNo}</b></span>}</span>}
          actions={<>{e0 && <Btn onClick={() => goTab("programme")}>Continue learning</Btn>}{tasks.length > 0 && <Btn kind="ghost" onClick={() => goTab(tasks[0].to)}>Next task</Btn>}</>}
          aside={<div className="rounded-2xl bg-ink/[0.03] p-4"><ProgressRing pct={p0 ? p0.overall : null} label="Programme progress" sub={modules.length ? `${modulesDone} of ${modules.length} modules completed` : "Modules are being published"} size={112} /></div>} />
        <StatGrid>
          <StatCard icon="clipboard" label="Tasks to complete" value={asg.data && quizzes.data ? tasks.length : null} note={tasks.filter((t) => t.status === "overdue").length ? `${tasks.filter((t) => t.status === "overdue").length} overdue` : "assignments, quizzes, assessments"} tone={tasks.some((t) => t.status === "overdue") ? "alert" : "plain"} onClick={() => goTab(tasks[0]?.to ?? "assignments")} />
          <StatCard icon="play" label="Next class" value={ov.data ? (ov.data.nextSession ? new Date(ov.data.nextSession.startsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" }) : "Not set") : null} note={ov.data?.nextSession ? `${new Date(ov.data.nextSession.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} Lagos time` : "your weekly time is being arranged"} tone="indigo" onClick={() => goTab("calendar")} />
          <StatCard icon="user" label="Your instructor" value={ov.data ? (ins ? firstName(ins.fullName) : "Pending") : null} note={ins ? ins.fullName : "being assigned"} onClick={() => goTab(ins ? "messages" : "programme")} />
          <StatCard icon="mail" label="Unread messages" value={msgs.data ? msgs.data.unread : null} note={notes.data?.unread ? `${notes.data.unread} unread notifications` : "messages from your instructor"} tone={msgs.data?.unread ? "orange" : "plain"} onClick={() => goTab("messages")} />
        </StatGrid>
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <NextClass s={ov.data?.nextSession ?? null} now={now} />
            <StudentWeekly />
            <Card title="Your Academic Tasks" action={tasks.length ? <span className="text-sm text-ink/70">{tasks.length} to complete</span> : null}>
              {tasks.length ? (<>
                {/* Phones: one stacked item per task. */}
                <ul className="divide-y divide-ink/[0.07] sm:hidden">{tasks.slice(0, 8).map((t) => {
                  const soon = now > 0 && Date.parse(t.due) - now < 48 * 3600_000;
                  return (
                    <li key={t.id} className="py-3">
                      <p className="flex items-center gap-2 font-semibold">{(t.status === "overdue" || soon) && <span className={`h-2 w-2 shrink-0 rounded-full ${t.status === "overdue" ? "bg-brand-red" : "bg-brand-orange"}`} aria-hidden="true" />}{t.title}</p>
                      <p className="mt-0.5 text-[0.95rem] text-ink/75">{t.type} · due {t.dueText}{t.status !== "overdue" && soon ? " · due soon" : ""}</p>
                      <div className="mt-2 flex items-center justify-between gap-3"><Badge s={t.status} /><Btn small kind="ghost" onClick={() => goTab(t.to)}>{t.status === "in_progress" ? "Continue" : "Open"}</Btn></div>
                    </li>
                  );
                })}</ul>
                <div className="relative -mx-2 hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[34rem] text-left text-[0.95rem]">
                    <thead><tr className="border-b border-ink/10 text-sm text-ink/70"><th className="px-2 py-2 font-semibold">Task</th><th className="px-2 py-2 font-semibold">Type</th><th className="px-2 py-2 font-semibold">Deadline</th><th className="px-2 py-2 font-semibold">Status</th><th className="px-2 py-2"><span className="sr-only">Action</span></th></tr></thead>
                    <tbody>{tasks.slice(0, 8).map((t) => {
                      const soon = now > 0 && Date.parse(t.due) - now < 48 * 3600_000;
                      return (
                        <tr key={t.id} className="border-b border-ink/[0.06] last:border-0">
                          <td className="px-2 py-3 font-semibold"><span className="flex items-center gap-2">{(t.status === "overdue" || soon) && <span className={`h-2 w-2 shrink-0 rounded-full ${t.status === "overdue" ? "bg-brand-red" : "bg-brand-orange"}`} aria-hidden="true" />}{t.title}</span></td>
                          <td className="px-2 py-3 text-ink/75">{t.type}</td>
                          <td className="px-2 py-3 text-ink/75">{t.dueText}{t.status !== "overdue" && soon ? <span className="block text-sm font-semibold text-ink">Due soon</span> : null}</td>
                          <td className="px-2 py-3"><Badge s={t.status} /></td>
                          <td className="px-2 py-3 text-right"><Btn small kind="ghost" onClick={() => goTab(t.to)}>{t.status === "in_progress" ? "Continue" : "Open"}</Btn></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              </>) : <Empty>All clear for now. New assignments, quizzes and assessments from your instructor appear here.</Empty>}
            </Card>
            <Card title="Announcements and messages" action={<button onClick={() => goTab("notifications")} className="text-sm font-semibold text-indigo hover:underline">View all</button>}>
              {feed.length ? (
                <ul className="divide-y divide-ink/[0.07]">
                  {feed.slice(0, 6).map((f) => (
                    <li key={f.id}>
                      <button onClick={async () => {
                        if (f.contact) return goTab("messages");
                        if (f.note && !f.note.read_at) await api("/api/app/notifications/read", { method: "POST", body: { ids: [f.note.id] } }).catch(() => undefined);
                        notes.reload();
                        const t = f.note ? targetOf(f.note.kind, TABS as unknown as string[]) : null;
                        goTab((t as Tab) ?? "notifications");
                      }} className="flex w-full gap-3 py-3 text-left">
                        <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${f.unread ? "bg-indigo" : "bg-transparent"}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-indigo">{f.title}{f.unread && <span className="sr-only"> (unread)</span>}</span>
                          {f.body && <span className="block truncate text-[0.95rem] text-ink/75">{f.body}</span>}
                          <span className="block text-sm text-ink/65">{when(f.at)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No announcements or messages yet.</Empty>}
            </Card>
          </div>
          <div className="space-y-6">
            {myProgramme}
            <Card title="Upcoming events" action={<button onClick={() => goTab("calendar")} className="text-sm font-semibold text-indigo hover:underline">Calendar</button>}>
              <UpcomingList events={events} now={now} limit={5} empty="There are no upcoming events." />
            </Card>
            <Card title="Academic progress" action={<button onClick={() => goTab("programme")} className="text-sm font-semibold text-indigo hover:underline">Details</button>}>
              {p0 ? <div className="space-y-3">
                <Bar pct={p0.overall} label="Programme completion" />
                <p className="text-[0.95rem]"><span className="text-ink/70">Modules completed: </span><b>{modulesDone} of {modules.length}</b></p>
                <Bar pct={p0.attendance.pct} label={`Attendance (${p0.attendance.attended} attended)`} />
                <Bar pct={p0.assignments.avgScorePct} label="Assignment average" />
                <Bar pct={p0.assessments.avgScorePct ?? p0.quizzes.avgScorePct} label="Assessment average" />
              </div> : <Empty>Progress appears once your programme starts.</Empty>}
            </Card>
            <Card title="Learning resources" action={<button onClick={() => goTab("materials")} className="text-sm font-semibold text-indigo hover:underline">All materials</button>}>
              {res.data?.resources.length ? <ul className="space-y-2">{res.data.resources.slice(0, 4).map((r) => <li key={r.id}><a href={r.url ?? r.file ?? undefined} target={r.url ? "_blank" : undefined} rel="noopener noreferrer" className="flex items-center gap-2 font-semibold text-indigo hover:underline"><Icon name="folder" className="h-4 w-4 shrink-0" />{r.title}</a></li>)}</ul> : <Empty>Materials appear when your instructors publish them.</Empty>}
            </Card>
          </div>
        </div>
      </>}

      {tab === "programme" && <>
        <PageTitle title="My Programme" sub={e0 ? <>{e0.programmeName}{ins ? <> · Instructor: <b className="font-semibold text-ink">{ins.fullName}</b></> : null}</> : undefined} />
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="mb-3 font-display text-lg font-semibold">Course modules</h2>
            {modules.length ? <ol className="space-y-4">{modules.map((m, i) => <ModuleCard key={m.id} m={m} n={i + 1} current={current?.id === m.id} reload={() => { mods.reload(); prog.reload(); }} />)}</ol>
              : <Card><Empty>The modules for your programme are being published. They appear here as soon as they are ready.</Empty></Card>}
          </div>
          <div className="space-y-6">
            {ins && <Card title="Your instructor">
              <div className="flex items-center gap-3"><Avatar src={ins.photo} name={ins.fullName} size={52} /><div><p className="flex items-center gap-1 font-semibold">{ins.fullName}{ins.verified && <VerifiedBadge />}</p>{(ins.headline || ins.specialization) && <p className="text-[0.95rem] text-ink/70">{ins.headline || ins.specialization}</p>}</div></div>
              <div className="mt-4"><Btn small kind="ghost" onClick={() => goTab("messages")}>Send a message</Btn></div>
            </Card>}
            <Card title="Academic standing">{prog.data?.progress.map((p) => <ProgressView key={p.enrolmentId} p={p} />)}{prog.data && !prog.data.progress.length && <Empty>Progress appears once you are enrolled.</Empty>}</Card>
          </div>
        </div>
      </>}

      {tab === "materials" && <>
        <PageTitle title="Learning Materials" sub="Materials approved for your programme, and a learning assistant that answers from them." />
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="Materials">
              {res.data?.resources.length ? <ul className="divide-y divide-ink/[0.07]">{res.data.resources.map((r) => (
                <li key={r.id}><a href={r.url ?? r.file ?? undefined} target={r.url ? "_blank" : undefined} rel="noopener noreferrer" className="flex items-center gap-4 py-3 hover:bg-ink/[0.02]">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo/[0.07] text-indigo"><Icon name={r.kind === "video" ? "play" : "folder"} /></span>
                  <span className="min-w-0"><span className="block font-semibold text-indigo">{r.title}</span><span className="block text-sm capitalize text-ink/70">{r.kind}{r.url ? " · opens in a new tab" : " · download"}</span></span>
                </a></li>
              ))}</ul> : <Empty>Materials appear here when your instructors publish them.</Empty>}
            </Card>
          </div>
          <Assistant />
        </div>
      </>}

      {tab === "assignments" && <>
        <PageTitle title="Assignments" sub="Submit your work and read your instructor's feedback." />
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-2">
          <Card title={`To do (${todoA.length})`}><ul className="space-y-3">{todoA.map((a) => <AssignmentItem key={a.id} a={a} reload={asg.reload} />)}</ul>{asg.data && !todoA.length && <Empty>No assignments waiting.</Empty>}</Card>
          <Card title="Submitted and marked"><ul className="space-y-3">{assignments.filter((a) => !todoA.includes(a)).map((a) => <AssignmentItem key={a.id} a={a} reload={asg.reload} />)}</ul>{asg.data && assignments.length === todoA.length && <Empty>Your submitted work appears here.</Empty>}</Card>
        </div>
      </>}

      {tab === "assessments" && <>
        <PageTitle title="Assessments" sub="Quizzes, tests and assessments. Timed ones start their timer when you press Start." />
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-2">
          <Card title={`Open (${todoQ.length})`}><ul className="space-y-3">{todoQ.map((q) => <QuizItem key={q.id} q={q} reload={quizzes.reload} />)}</ul>{quizzes.data && !todoQ.length && <Empty>No quizzes or assessments open.</Empty>}</Card>
          <Card title="Results">
            <ul className="space-y-3">{allQuizzes.filter((q) => q.status === "graded" || q.status === "submitted").map((q) => <QuizItem key={q.id} q={q} reload={quizzes.reload} />)}</ul>
            {quizzes.data && !allQuizzes.some((q) => q.status === "graded" || q.status === "submitted") && <Empty>Your results appear here once marked.</Empty>}
          </Card>
        </div>
      </>}

      {tab === "calendar" && <>
        <PageTitle title="Calendar" sub="Live classes and deadlines. Times are Lagos time (WAT)." />
        <div className="space-y-6"><NextClass s={ov.data?.nextSession ?? null} now={now} /><AcademicCalendar events={events} now={now} title="Academic calendar" /></div>
      </>}

      {tab === "messages" && <><PageTitle title="Messages" sub="Private conversation with your instructor." /><div className="max-w-3xl"><Messages /></div></>}

      {tab === "notifications" && <NotificationsPage ids={TABS as unknown as string[]} onGo={(t) => goTab(t as Tab)} />}

      {tab === "profile" && <StudentAccount me={me} ov={ov.data} pay={pay.data} ins={ins} />}
    </AppShell>
  );
}

function StudentAccount({ me, ov, pay, ins }: { me: Me; ov: Overview | null; pay: Pay | null; ins: { id: string; fullName: string } | null }) {
  const [rate, setRate] = useState(0);
  const { busy, msg, run } = useAction();
  const prefs = me.emailPrefs ?? {};
  const outstanding = (pay?.orders ?? []).reduce((n, o) => n + o.outstandingNaira, 0);
  const rows: [string, string][] = [
    ["Registration No", me.studentNo ?? "Being issued"], ["Email", me.email],
    ...((ov?.enrolments ?? []).flatMap((e) => [["Programme", e.programmeName], ["Admitted", new Date(e.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })], ["Instructor", e.instructor?.fullName ?? "Being assigned"], ["Programme status", e.status.replace(/_/g, " ")]] as [string, string][])),
    ["Account status", "Active"],
    ["Payment", pay ? (outstanding > 0 ? `${naira(outstanding)} outstanding` : "Fully paid") : "…"],
  ];
  return (
    <>
      <PageTitle title="Profile" sub="Your academic record, payments, profile and email preferences." />
      <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title="Academic record">
            <dl className="divide-y divide-ink/[0.07] text-sm">{rows.map(([k, v], i) => <div key={i} className="flex justify-between gap-4 py-2.5"><dt className="text-ink/65">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}</dl>
          </Card>
          <Card title="Payments">
            {pay?.orders.map((o) => (
              <div key={o.reference} className="mb-4 last:mb-0">
                <div className="flex items-center justify-between gap-2 text-sm"><b className="font-semibold">{o.programme}</b><Badge s={o.status} /></div>
                <p className="mt-1 text-xs text-ink/60">{o.plan} · total {naira(o.totalNaira)} · paid {naira(o.paidNaira)}</p>
                <ul className="mt-2 divide-y divide-ink/[0.07] rounded-lg border border-ink/[0.07] text-sm">{o.parts.map((p) => <li key={p.part} className="flex items-center justify-between gap-2 px-3 py-2"><span>Part {p.part} · {naira(p.naira)} <span className="text-xs text-ink/65">due {p.due}</span></span><span className="flex items-center gap-2"><Badge s={p.status} />{p.payLink && <a href={p.payLink} className="text-xs font-semibold text-indigo underline">Pay</a>}</span></li>)}</ul>
              </div>
            ))}
            {pay && !pay.orders.length && <Empty>No payments found for {me.email}.</Empty>}
            <p className="mt-3 text-xs text-ink/65">Amounts are in naira, the currency in which payments are settled.</p>
          </Card>
        </div>
        <div className="space-y-5">
          <ProfileEditor me={me} onSaved={() => window.location.reload()} />
          <Card title="Email preferences">
            <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => api("/api/me", { method: "PATCH", body: { emailPrefs: { reminders: f.get("reminders") === "on", updates: f.get("updates") === "on" } } }), "Saved."); }}>
              <label className="flex items-start gap-3"><input type="checkbox" name="reminders" defaultChecked={prefs.reminders !== false} className="mt-1 accent-indigo" /><span><b className="font-semibold">Class reminders</b><span className="block text-ink/65">24 hours, 1 hour and 15 minutes before each class.</span></span></label>
              <label className="flex items-start gap-3"><input type="checkbox" name="updates" defaultChecked={prefs.updates !== false} className="mt-1 accent-indigo" /><span><b className="font-semibold">Updates</b><span className="block text-ink/65">New materials and announcements.</span></span></label>
              <p className="text-xs text-ink/65">Sign-in links, payments, coursework and messages are always emailed. Everything also appears under notifications.</p>
              <Btn type="submit" small disabled={busy}>Save preferences</Btn>
            </form>
          </Card>
          {ins && <Card title={`Rate ${ins.fullName}`}>
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rate === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRate(n)} className={`text-2xl ${n <= rate ? "text-brand-orange" : "text-ink/20"}`}>★</button>)}</div>
            <div className="mt-2"><Btn small disabled={!rate || busy} onClick={() => run(() => api("/api/app/student/ratings", { method: "POST", body: { instructorId: ins.id, rating: rate } }), "Thank you for your feedback.")}>Send rating</Btn></div>
          </Card>}
          <Msg text={msg.text} kind={msg.kind} />
        </div>
      </div>
    </>
  );
}

"use client";
// The student's learning space. Home puts the next class and the next responsibility first; the other sections
// hold classes and the calendar, coursework, materials, the assistant, messages, progress and the account.
import { useEffect, useState } from "react";
import type { Me } from "./page";
import { Messages, ProfileEditor, ProgressView, type Progress } from "./shared";
import { api, Badge, Btn, Card, Empty, inputCls, Msg, naira, PageTitle, Stat, upload, useAction, useLoad, useNow, useTab, Avatar, VerifiedBadge } from "./ui";
import { AppShell, Icon, type NavItem } from "./shell";

type Session = { id: string; programmeName: string; startsAt: string; endsAt: string; lagosTime: string; durationMin: number; status: string; meetUrl: string | null; meetStatus: string; joinOpen: boolean; instructor: { fullName: string } | null };
type Overview = { enrolments: { id: string; programme: string; programmeName: string; status: string; startedAt: string; instructor: { id: string; fullName: string; email: string; bio: string | null; photo: string | null; specialization: string | null; verified?: boolean; headline?: string | null } | null; timetable: { day: string; startTime: string; durationMin: number } | null }[]; nextSession: Session | null };
type Assignment = { id: string; title: string; description: string | null; dueText: string; status: string; maxScore: number; submission: { text: string | null; fileName: string | null } | null; grade: { score: number; feedback: string | null } | null };
type Quiz = { id: string; kind: string; title: string; instructions: string | null; durationMin: number | null; dueText: string; status: string; score: number | null; maxScore: number; feedback: string | null;
  questions: { n?: number; type: string; prompt: string; options?: string[]; points: number; answer?: number }[]; answers: (number | string | null)[] | null };

const left = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `${d} day${d > 1 ? "s" : ""}${h % 24 ? ` ${h % 24} h` : ""}` : `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

function NextClass({ s, now }: { s: Session | null; now: number }) {
  if (!s) return (
    <section className="rounded-2xl bg-indigo p-6 text-white sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">Next class</p>
      <p className="mt-3 font-display text-xl font-semibold">Your weekly class time is being arranged.</p>
      <p className="mt-1 text-sm text-white/70">It appears here as soon as the Academy confirms it, and you will be notified.</p>
    </section>
  );
  const start = Date.parse(s.startsAt), live = now >= start && now < Date.parse(s.endsAt);
  return (
    <section className="relative overflow-hidden rounded-2xl bg-indigo p-6 text-white sm:p-7">
      <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/[0.04]" aria-hidden="true" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">Next class</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">{s.programmeName}</h2>
          <p className="mt-1 text-sm text-white/75">{s.lagosTime} · {s.durationMin} min{s.instructor ? ` · ${s.instructor.fullName}` : ""}</p>
        </div>
        {now > 0 && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${live ? "bg-brand-orange text-ink" : "bg-white/10 text-white"}`}>{live ? "In session now" : now < start ? `Starts in ${left(start - now)}` : "Ended"}</span>}
      </div>
      <div className="relative mt-5">
        {s.joinOpen && s.meetUrl
          ? <a href={s.meetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-display text-sm font-semibold text-indigo transition hover:bg-paper">Join the live session</a>
          : <p className="rounded-lg bg-white/[0.08] px-4 py-3 text-sm text-white/85">{s.meetUrl ? "Your Google Meet link is ready. The join button appears 15 minutes before class." : "Your instructor has not added the meeting link yet. You will be notified when they do."}</p>}
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
        <ul className="max-h-[28rem] min-h-48 space-y-3 overflow-auto rounded-xl bg-paper p-4" aria-live="polite">
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
    <li className="rounded-xl border border-ink/[0.07] bg-white p-4">
      <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b className="text-sm">{a.title}</b><span className="block text-xs text-ink/60">Due {a.dueText}</span></span><Badge s={a.status} />
      </button>
      {open && <div className="mt-2 space-y-2 text-sm">
        {a.description && <p className="whitespace-pre-wrap text-ink/80">{a.description}</p>}
        {a.grade && <p className="rounded-lg bg-paper p-3"><b>Score: {a.grade.score}/{a.maxScore}</b>{a.grade.feedback ? ` · ${a.grade.feedback}` : ""}</p>}
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
    <li className="rounded-xl border border-ink/[0.07] bg-white p-4">
      <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b className="text-sm">{q.title}</b><span className="block text-xs text-ink/60">{q.kind} · due {q.dueText}{q.durationMin ? ` · ${q.durationMin} min` : ""}</span></span><Badge s={q.status} />
      </button>
      {open && <div className="mt-2 space-y-3 text-sm">
        {q.instructions && <p className="text-ink/80">{q.instructions}</p>}
        {q.status === "graded" && <p className="rounded-lg bg-paper p-3"><b>Score: {q.score}/{q.maxScore}</b>{q.feedback ? ` · ${q.feedback}` : ""}</p>}
        {q.status === "open" && <Btn small disabled={busy} onClick={() => run(() => api(`/api/app/student/quizzes/${q.id}/start`, { method: "POST" }), "", reload)}>Start{q.durationMin ? ` (${q.durationMin} min timer)` : ""}</Btn>}
        {taking && <form onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/app/student/quizzes/${q.id}/submit`, { method: "POST", body: { answers } }), "Submitted.", reload); }} className="space-y-3">
          {q.questions.map((qq, i) => (
            <fieldset key={i} className="rounded-lg border border-ink/10 p-3">
              <legend className="font-semibold">{i + 1}. {qq.prompt} <span className="text-xs text-ink/50">({qq.points} pt)</span></legend>
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

const TABS = ["home", "classes", "coursework", "materials", "assistant", "messages", "progress", "account"] as const;
type Tab = (typeof TABS)[number];
type Pay = { orders: { reference: string; programme: string; plan: string; totalNaira: number; paidNaira: number; outstandingNaira: number; status: string; parts: { part: number; naira: number; due: string; status: string; payLink: string | null }[] }[] };

const greeting = (now: number) => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }).format(now || Date.now()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });

export function StudentDashboard({ me }: { me: Me }) {
  const [tab, setTab] = useTab(TABS, "home");
  const ov = useLoad<Overview>("/api/app/student/overview");
  const sessions = useLoad<{ sessions: Session[] }>("/api/app/student/sessions");
  const asg = useLoad<{ assignments: Assignment[] }>("/api/app/student/assignments");
  const quizzes = useLoad<{ quizzes: Quiz[] }>("/api/app/student/quizzes");
  const res = useLoad<{ resources: { id: string; title: string; kind: string; url: string | null; file: string | null }[] }>("/api/app/resources");
  const prog = useLoad<{ progress: Progress[] }>(`/api/app/students/${me.id}/progress`);
  const pay = useLoad<Pay>("/api/app/student/payments");
  const msgs = useLoad<{ unread: number }>("/api/app/messages");
  const now = useNow();
  const [first, setFirst] = useState(false);
  useEffect(() => {
    // The first visit gets a welcome; afterwards the greeting follows the day's work.
    const k = `sma-welcomed-${me.id}`;
    let seen = true;
    try { seen = !!localStorage.getItem(k); localStorage.setItem(k, "1"); } catch { /* private mode */ }
    const t = setTimeout(() => setFirst(!seen), 0);
    return () => clearTimeout(t);
  }, [me.id]);

  const todo = (asg.data?.assignments ?? []).filter((a) => a.status === "pending" || a.status === "overdue");
  const openQ = (quizzes.data?.quizzes ?? []).filter((q) => q.status === "open" || q.status === "in_progress");
  const graded = [...(asg.data?.assignments ?? []).filter((a) => a.grade).map((a) => ({ id: a.id, title: a.title, score: `${a.grade!.score}/${a.maxScore}`, feedback: a.grade!.feedback })),
    ...(quizzes.data?.quizzes ?? []).filter((q) => q.status === "graded").map((q) => ({ id: q.id, title: q.title, score: `${q.score}/${q.maxScore}`, feedback: q.feedback }))];
  const upcoming = (sessions.data?.sessions ?? []).filter((s) => now > 0 && Date.parse(s.endsAt) > now);
  const e0 = ov.data?.enrolments[0];
  const p0 = prog.data?.progress[0];
  const ins = ov.data?.enrolments.find((e) => e.instructor)?.instructor;
  const outstanding = (pay.data?.orders ?? []).reduce((n, o) => n + o.outstandingNaira, 0);

  const nav: NavItem<Tab>[] = [
    { id: "home", label: "Home", icon: "home" },
    { id: "classes", label: "Classes & calendar", icon: "calendar" },
    { id: "coursework", label: "Coursework", icon: "book", badge: todo.length + openQ.length },
    { id: "materials", label: "Materials", icon: "folder" },
    { id: "assistant", label: "Learning assistant", icon: "spark" },
    { id: "messages", label: "Messages", icon: "chat", badge: msgs.data?.unread },
    { id: "progress", label: "Progress", icon: "chart" },
    { id: "account", label: "My account", icon: "user" },
  ];

  const responsibilities = [
    ...todo.map((a) => ({ id: a.id, title: a.title, meta: a.status === "overdue" ? `Overdue · was due ${a.dueText}` : `Assignment · due ${a.dueText}`, urgent: a.status === "overdue" })),
    ...openQ.map((q) => ({ id: q.id, title: q.title, meta: `${q.kind === "assessment" ? "Assessment" : "Quiz"} · due ${q.dueText}${q.status === "in_progress" ? " · in progress" : ""}`, urgent: q.status === "in_progress" })),
  ];

  return (
    <AppShell me={me} nav={nav} tab={tab} setTab={setTab}>
      {tab === "home" && <>
        <div className="mb-7">
          <p className="text-sm font-medium text-ink/55">{now ? greeting(now) : "Welcome"}, {me.fullName.split(" ")[0]}.</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{first ? "Welcome to your learning space." : responsibilities.length ? `You have ${responsibilities.length} thing${responsibilities.length > 1 ? "s" : ""} to complete.` : "You are up to date."}</h1>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/60">
            {e0 && <span>{e0.programmeName}</span>}
            {me.studentNo && <span>Registration No: <b className="font-semibold text-ink/80">{me.studentNo}</b></span>}
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-5">
            <NextClass s={ov.data?.nextSession ?? null} now={now} />
            <Card title="Your responsibilities" action={responsibilities.length ? <button onClick={() => setTab("coursework")} className="text-xs font-semibold text-indigo hover:underline">Open coursework</button> : null}>
              {responsibilities.length ? (
                <ul className="divide-y divide-ink/[0.07]">
                  {responsibilities.slice(0, 6).map((r) => (
                    <li key={r.id}><button onClick={() => setTab("coursework")} className="flex w-full items-center gap-3 py-3 text-left">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${r.urgent ? "bg-brand-red/10 text-brand-red" : "bg-indigo/[0.07] text-indigo"}`}><Icon name="clipboard" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.title}</span><span className={`block text-xs ${r.urgent ? "text-brand-red" : "text-ink/55"}`}>{r.meta}</span></span>
                      <span className="text-ink/30" aria-hidden="true">›</span>
                    </button></li>
                  ))}
                </ul>
              ) : <Empty>Nothing waiting. New assignments and quizzes from your instructor appear here.</Empty>}
            </Card>
            {graded.length > 0 && <Card title="Recent feedback">
              <ul className="divide-y divide-ink/[0.07]">{graded.slice(0, 3).map((g) => <li key={g.id} className="flex items-start justify-between gap-3 py-3 text-sm"><span><b className="font-semibold">{g.title}</b>{g.feedback && <span className="mt-0.5 block text-ink/60">{g.feedback}</span>}</span><span className="shrink-0 rounded-md bg-indigo/[0.07] px-2 py-0.5 text-xs font-semibold text-indigo">{g.score}</span></li>)}</ul>
            </Card>}
          </div>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Progress" value={p0 ? `${p0.overall}%` : "–"} note={p0 ? "of the programme" : undefined} />
              <Stat label="Attendance" value={p0?.attendance.pct != null ? `${p0.attendance.pct}%` : "–"} note={p0 ? `${p0.attendance.attended} attended` : undefined} />
            </div>
            <Card title="Your instructor">
              {ins ? <div className="text-sm"><div className="flex items-center gap-3"><Avatar src={ins.photo} name={ins.fullName} size={44} /><div><p className="flex items-center gap-1 font-semibold">{ins.fullName}{ins.verified && <VerifiedBadge />}</p>{(ins.headline || ins.specialization) && <p className="text-ink/60">{ins.headline || ins.specialization}</p>}</div></div>
                <div className="mt-3 flex gap-2"><Btn small kind="ghost" onClick={() => setTab("messages")}>Message{msgs.data?.unread ? ` (${msgs.data.unread} new)` : ""}</Btn></div></div>
                : <Empty>Your instructor is being assigned. You will be notified.</Empty>}
              {e0?.timetable && <p className="mt-4 border-t border-ink/[0.07] pt-3 text-sm text-ink/70">Weekly class: <b className="text-ink">{e0.timetable.day}s at {e0.timetable.startTime}</b> (Lagos time)</p>}
            </Card>
            {upcoming.length > 1 && <Card title="Coming up" action={<button onClick={() => setTab("classes")} className="text-xs font-semibold text-indigo hover:underline">Calendar</button>}>
              <ul className="space-y-2 text-sm">{upcoming.slice(1, 4).map((s) => <li key={s.id} className="flex justify-between gap-2"><span className="text-ink/75">{s.lagosTime}</span><Badge s={s.status === "scheduled" ? s.meetStatus : s.status} /></li>)}</ul>
            </Card>}
          </div>
        </div>
      </>}

      {tab === "classes" && <>
        <PageTitle title="Classes and calendar" sub="Your live sessions for the next four weeks, and work that is due. Times are Lagos time." />
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-5">
            <NextClass s={ov.data?.nextSession ?? null} now={now} />
            <Card title="Calendar">
              {Object.entries(upcoming.reduce<Record<string, Session[]>>((m, s) => { (m[dayKey(s.startsAt)] ??= []).push(s); return m; }, {})).map(([day, list]) => (
                <div key={day} className="border-t border-ink/[0.07] py-3 first:border-0 first:pt-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{day}</p>
                  {list.map((s) => <div key={s.id} className="mt-2 flex items-center justify-between gap-3 text-sm"><span><b className="font-semibold">{s.programmeName}</b><span className="block text-ink/60">{new Date(s.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} · {s.durationMin} min{s.instructor ? ` · ${s.instructor.fullName}` : ""}</span></span><Badge s={s.status === "scheduled" ? s.meetStatus : s.status} /></div>)}
                </div>
              ))}
              {sessions.data && now > 0 && !upcoming.length && <Empty>No classes in the next four weeks.</Empty>}
            </Card>
          </div>
          <Card title="Deadlines">
            <ul className="space-y-3 text-sm">{responsibilities.map((r) => <li key={r.id}><b className="font-semibold">{r.title}</b><span className={`block text-xs ${r.urgent ? "text-brand-red" : "text-ink/55"}`}>{r.meta}</span></li>)}</ul>
            {!responsibilities.length && <Empty>No deadlines coming up.</Empty>}
          </Card>
        </div>
      </>}

      {tab === "coursework" && <>
        <PageTitle title="Coursework" sub="Assignments, quizzes and assessments set by your instructor." />
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Assignments">
            {asg.error && <Msg text={asg.error} />}
            <ul className="space-y-3">{asg.data?.assignments.map((a) => <AssignmentItem key={a.id} a={a} reload={asg.reload} />)}</ul>
            {asg.data && !asg.data.assignments.length && <Empty>No assignments yet.</Empty>}
          </Card>
          <div className="space-y-5">
            <Card title="Quizzes and assessments">
              <ul className="space-y-3">{openQ.map((q) => <QuizItem key={q.id} q={q} reload={quizzes.reload} />)}</ul>
              {quizzes.data && !openQ.length && <Empty>No quizzes open.</Empty>}
            </Card>
            <Card title="Marked work">
              <ul className="space-y-3">{(quizzes.data?.quizzes ?? []).filter((q) => q.status === "graded" || q.status === "submitted").map((q) => <QuizItem key={q.id} q={q} reload={quizzes.reload} />)}</ul>
              {!graded.length && <Empty>Marked work and feedback appear here.</Empty>}
            </Card>
          </div>
        </div>
      </>}

      {tab === "materials" && <>
        <PageTitle title="Learning materials" sub="Materials approved for your programme." />
        <div className="grid gap-3 sm:grid-cols-2">
          {res.data?.resources.map((r) => {
            const href = r.url ?? r.file;
            return (
              <a key={r.id} href={href ?? undefined} target={r.url ? "_blank" : undefined} rel="noopener noreferrer" className="flex items-center gap-4 rounded-2xl border border-ink/[0.07] bg-white p-4 shadow-sm shadow-ink/5 transition hover:border-indigo/30">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo/[0.07] text-indigo"><Icon name={r.kind === "video" ? "spark" : "folder"} /></span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{r.title}</span><span className="text-xs capitalize text-ink/55">{r.kind}</span></span>
              </a>
            );
          })}
        </div>
        {res.data && !res.data.resources.length && <Card><Empty>Materials appear here when your instructors publish them.</Empty></Card>}
      </>}

      {tab === "assistant" && <><PageTitle title="Learning assistant" sub="Explanations, examples and revision help, grounded in your programme's approved materials." /><div className="max-w-3xl"><Assistant /></div></>}
      {tab === "messages" && <><PageTitle title="Messages" sub="Private conversation with your instructor." /><div className="max-w-3xl"><Messages /></div></>}
      {tab === "progress" && <>
        <PageTitle title="Progress" sub="Calculated from your lessons, coursework and attendance." />
        <div className="max-w-3xl space-y-5">{prog.data?.progress.map((p) => <Card key={p.enrolmentId}><ProgressView p={p} /></Card>)}{prog.data && !prog.data.progress.length && <Card><Empty>Progress appears once you are enrolled.</Empty></Card>}</div>
      </>}

      {tab === "account" && <StudentAccount me={me} ov={ov.data} pay={pay.data} outstanding={outstanding} ins={ins ?? null} />}
    </AppShell>
  );
}

function StudentAccount({ me, ov, pay, outstanding, ins }: { me: Me; ov: Overview | null; pay: Pay | null; outstanding: number; ins: { id: string; fullName: string } | null }) {
  const [rate, setRate] = useState(0);
  const { busy, msg, run } = useAction();
  const prefs = me.emailPrefs ?? {};
  const rows: [string, string][] = [
    ["Registration No", me.studentNo ?? "Being issued"], ["Email", me.email],
    ...((ov?.enrolments ?? []).flatMap((e) => [["Programme", e.programmeName], ["Admitted", new Date(e.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })], ["Instructor", e.instructor?.fullName ?? "Being assigned"], ["Status", e.status.replace(/_/g, " ")]] as [string, string][])),
    ["Payment", pay ? (outstanding > 0 ? `${naira(outstanding)} outstanding` : "Fully paid") : "…"],
  ];
  return (
    <>
      <PageTitle title="My account" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title="Academic record">
            <dl className="divide-y divide-ink/[0.07] text-sm">{rows.map(([k, v], i) => <div key={i} className="flex justify-between gap-4 py-2.5"><dt className="text-ink/55">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}</dl>
          </Card>
          <Card title="Payments">
            {pay?.orders.map((o) => (
              <div key={o.reference} className="mb-4 last:mb-0">
                <div className="flex items-center justify-between gap-2 text-sm"><b className="font-semibold">{o.programme}</b><Badge s={o.status} /></div>
                <p className="mt-1 text-xs text-ink/60">{o.plan} · total {naira(o.totalNaira)} · paid {naira(o.paidNaira)}</p>
                <ul className="mt-2 divide-y divide-ink/[0.07] rounded-lg border border-ink/[0.07] text-sm">{o.parts.map((p) => <li key={p.part} className="flex items-center justify-between gap-2 px-3 py-2"><span>Part {p.part} · {naira(p.naira)} <span className="text-xs text-ink/50">due {p.due}</span></span><span className="flex items-center gap-2"><Badge s={p.status} />{p.payLink && <a href={p.payLink} className="text-xs font-semibold text-indigo underline">Pay</a>}</span></li>)}</ul>
              </div>
            ))}
            {pay && !pay.orders.length && <Empty>No payments found for {me.email}.</Empty>}
            <p className="mt-3 text-xs text-ink/50">Amounts are in naira, the currency in which payments are settled.</p>
          </Card>
        </div>
        <div className="space-y-5">
          <ProfileEditor me={me} onSaved={() => window.location.reload()} />
          <Card title="Email preferences">
            <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => api("/api/me", { method: "PATCH", body: { emailPrefs: { reminders: f.get("reminders") === "on", updates: f.get("updates") === "on" } } }), "Saved."); }}>
              <label className="flex items-start gap-3"><input type="checkbox" name="reminders" defaultChecked={prefs.reminders !== false} className="mt-1 accent-indigo" /><span><b className="font-semibold">Class reminders</b><span className="block text-ink/55">24 hours, 1 hour and 15 minutes before each class.</span></span></label>
              <label className="flex items-start gap-3"><input type="checkbox" name="updates" defaultChecked={prefs.updates !== false} className="mt-1 accent-indigo" /><span><b className="font-semibold">Updates</b><span className="block text-ink/55">New materials and announcements.</span></span></label>
              <p className="text-xs text-ink/50">Sign-in links, payments, coursework and messages are always emailed. Everything also appears under notifications.</p>
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

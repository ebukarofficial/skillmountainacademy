"use client";
// Student dashboard. Left: what to do (assignments, quizzes, grades, materials). Centre (largest): next live class,
// upcoming classes, AI assistant, messages. Right: profile, programme and instructor, payments, progress.
import { useState } from "react";
import type { Me } from "./page";
import { Messages, ProfileEditor, ProgressView, type Progress } from "./shared";
import { api, Badge, Btn, Card, Empty, inputCls, Msg, naira, upload, useAction, useLoad, useNow } from "./ui";

type Session = { id: string; programmeName: string; startsAt: string; endsAt: string; lagosTime: string; durationMin: number; status: string; meetUrl: string | null; meetStatus: string; joinOpen: boolean; instructor: { fullName: string } | null };
type Overview = { enrolments: { id: string; programme: string; programmeName: string; status: string; instructor: { id: string; fullName: string; email: string; bio: string | null; photo: string | null; specialization: string | null } | null; timetable: { day: string; startTime: string; durationMin: number } | null }[]; nextSession: Session | null };
type Assignment = { id: string; title: string; description: string | null; dueText: string; status: string; maxScore: number; submission: { text: string | null; fileName: string | null } | null; grade: { score: number; feedback: string | null } | null };
type Quiz = { id: string; kind: string; title: string; instructions: string | null; durationMin: number | null; dueText: string; status: string; score: number | null; maxScore: number; feedback: string | null;
  questions: { n?: number; type: string; prompt: string; options?: string[]; points: number; answer?: number }[]; answers: (number | string | null)[] | null };

function NextClass({ s }: { s: Session | null }) {
  if (!s) return <Card title="Your next live class"><Empty>No class scheduled yet. Your weekly time appears here once the academy sets it.</Empty></Card>;
  return (
    <section className="rounded-[1.75rem] bg-indigo p-6 text-white">
      <p className="text-sm text-white/70">Your next live class</p>
      <h2 className="mt-1 font-display text-2xl font-extrabold">{s.programmeName}</h2>
      <p className="mt-1 text-white/85">{s.lagosTime} · {s.durationMin} minutes{s.instructor ? ` · with ${s.instructor.fullName}` : ""}</p>
      {s.joinOpen && s.meetUrl
        ? <a href={s.meetUrl} target="_blank" rel="noopener noreferrer" className="brand-bg mt-4 inline-block rounded-full px-8 py-4 font-display text-lg font-bold text-white">Join live session</a>
        : s.meetUrl ? <p className="mt-4 rounded-2xl bg-white/10 p-3 text-sm">Your Google Meet link is ready. The Join button appears 15 minutes before class.</p>
        : <p className="mt-4 rounded-2xl bg-white/10 p-3 text-sm">Meet link pending: your instructor has not added it yet. You will be notified as soon as they do.</p>}
      <p className="mt-3 text-xs text-white/60">Screen sharing and the whiteboard are inside Google Meet.</p>
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
        <ul className="max-h-80 space-y-2 overflow-auto rounded-xl bg-cream p-3" aria-live="polite">
          {data?.history.map((m, i) => <li key={i} className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-indigo text-white" : "bg-white"}`}>{m.content}</li>)}
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
    <li className="rounded-xl bg-cream p-3">
      <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b className="text-sm">{a.title}</b><span className="block text-xs text-ink/60">Due {a.dueText}</span></span><Badge s={a.status} />
      </button>
      {open && <div className="mt-2 space-y-2 text-sm">
        {a.description && <p className="whitespace-pre-wrap text-ink/80">{a.description}</p>}
        {a.grade && <p className="rounded-lg bg-white p-2"><b>Score: {a.grade.score}/{a.maxScore}</b>{a.grade.feedback ? ` · ${a.grade.feedback}` : ""}</p>}
        {!locked && <>
          <label className="sr-only" htmlFor={`t-${a.id}`}>Your answer</label>
          <textarea id={`t-${a.id}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="Type your answer or notes" />
          <div className="flex flex-wrap items-center gap-2">
            <Btn small disabled={busy || !text.trim()} onClick={() => run(() => api(`/api/app/student/assignments/${a.id}/submission`, { method: "POST", body: { text } }), "Submitted.", reload)}>Submit text</Btn>
            <label className="cursor-pointer rounded-full border-2 border-indigo/30 px-3 py-1.5 text-xs font-semibold text-indigo">Upload a file<input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => upload(`/api/app/student/assignments/${a.id}/submission/file`, f), "File uploaded.", reload); }} /></label>
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
    <li className="rounded-xl bg-cream p-3">
      <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b className="text-sm">{q.title}</b><span className="block text-xs text-ink/60">{q.kind} · due {q.dueText}{q.durationMin ? ` · ${q.durationMin} min` : ""}</span></span><Badge s={q.status} />
      </button>
      {open && <div className="mt-2 space-y-3 text-sm">
        {q.instructions && <p className="text-ink/80">{q.instructions}</p>}
        {q.status === "graded" && <p className="rounded-lg bg-white p-2"><b>Score: {q.score}/{q.maxScore}</b>{q.feedback ? ` · ${q.feedback}` : ""}</p>}
        {q.status === "open" && <Btn small disabled={busy} onClick={() => run(() => api(`/api/app/student/quizzes/${q.id}/start`, { method: "POST" }), "", reload)}>Start{q.durationMin ? ` (${q.durationMin} min timer)` : ""}</Btn>}
        {taking && <form onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/app/student/quizzes/${q.id}/submit`, { method: "POST", body: { answers } }), "Submitted.", reload); }} className="space-y-3">
          {q.questions.map((qq, i) => (
            <fieldset key={i} className="rounded-lg bg-white p-2">
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

export function StudentDashboard({ me }: { me: Me }) {
  const ov = useLoad<Overview>("/api/app/student/overview");
  const sessions = useLoad<{ sessions: Session[] }>("/api/app/student/sessions");
  const asg = useLoad<{ assignments: Assignment[] }>("/api/app/student/assignments");
  const quizzes = useLoad<{ quizzes: Quiz[] }>("/api/app/student/quizzes");
  const res = useLoad<{ resources: { id: string; title: string; kind: string; url: string | null; file: string | null }[] }>("/api/app/resources");
  const prog = useLoad<{ progress: Progress[] }>(`/api/app/students/${me.id}/progress`);
  const pay = useLoad<{ orders: { reference: string; programme: string; plan: string; totalNaira: number; paidNaira: number; outstandingNaira: number; status: string; parts: { part: number; naira: number; due: string; status: string; payLink: string | null }[] }[] }>("/api/app/student/payments");
  const [rate, setRate] = useState(0);
  const now = useNow();
  const upcoming = (sessions.data?.sessions ?? []).filter((s) => now > 0 && Date.parse(s.endsAt) > now);
  const { msg, run } = useAction();
  const pendingQuizzes = (quizzes.data?.quizzes ?? []).filter((q) => q.status === "open" || q.status === "in_progress");
  const doneQuizzes = (quizzes.data?.quizzes ?? []).filter((q) => q.status === "graded" || q.status === "submitted");
  const ins = ov.data?.enrolments.find((e) => e.instructor)?.instructor;
  return (
    <>
      <div className="py-5">
        <h1 className="font-display text-2xl font-extrabold">Hi {me.fullName.split(" ")[0]}</h1>
        <p className="text-sm text-ink/70">{(asg.data?.assignments ?? []).filter((a) => a.status === "pending" || a.status === "overdue").length} assignment(s) to do · {pendingQuizzes.length} quiz(zes) open{ov.data?.nextSession ? ` · next class ${ov.data.nextSession.lagosTime}` : ""}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr_1fr]">
        <div className="order-2 space-y-5 lg:order-1">
          <Card title="This week's assignments">
            {asg.error && <Msg text={asg.error} />}
            <ul className="space-y-2">{asg.data?.assignments.map((a) => <AssignmentItem key={a.id} a={a} reload={asg.reload} />)}</ul>
            {asg.data && !asg.data.assignments.length && <Empty>Nothing due this week.</Empty>}
          </Card>
          <Card title="Quizzes and assessments">
            <ul className="space-y-2">{pendingQuizzes.map((q) => <QuizItem key={q.id} q={q} reload={quizzes.reload} />)}</ul>
            {quizzes.data && !pendingQuizzes.length && <Empty>No open quizzes.</Empty>}
          </Card>
          <Card title="Graded work">
            <ul className="space-y-2">{doneQuizzes.map((q) => <QuizItem key={q.id} q={q} reload={quizzes.reload} />)}</ul>
            {(asg.data?.assignments ?? []).filter((a) => a.grade).map((a) => <p key={a.id} className="mt-1 text-sm">{a.title}: <b>{a.grade!.score}/{a.maxScore}</b></p>)}
            {quizzes.data && !doneQuizzes.length && <Empty>No graded work yet.</Empty>}
          </Card>
          <Card title="Learning materials">
            <ul className="space-y-1 text-sm">{res.data?.resources.map((r) => <li key={r.id}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-red underline">{r.title}</a> : r.file ? <a href={r.file} className="font-semibold text-brand-red underline">{r.title}</a> : <b>{r.title}</b>} <span className="text-xs text-ink/50">{r.kind}</span></li>)}</ul>
            {res.data && !res.data.resources.length && <Empty>Materials appear here when your programme has them.</Empty>}
          </Card>
        </div>

        <div className="order-1 space-y-5 lg:order-2">
          <NextClass s={ov.data?.nextSession ?? null} />
          <Card title="Upcoming classes">
            <ul className="divide-y divide-ink/10 text-sm">{upcoming.map((s) => <li key={s.id} className="flex items-center justify-between gap-2 py-2"><span>{s.lagosTime}<span className="block text-xs text-ink/60">{s.programmeName} · {s.durationMin} min</span></span><Badge s={s.status === "scheduled" ? s.meetStatus : s.status} /></li>)}</ul>
            {sessions.data && now > 0 && !upcoming.length && <Empty>No classes in the next 4 weeks.</Empty>}
          </Card>
          <Assistant />
          <Messages />
        </div>

        <div className="order-3 space-y-5">
          <ProfileEditor me={me} onSaved={() => window.location.reload()} />
          <Card title="My programme">
            {ov.data?.enrolments.map((e) => (
              <div key={e.id} className="mb-3 text-sm">
                <p className="font-display font-bold">{e.programmeName} <Badge s={e.status} /></p>
                <p className="text-ink/70">{e.timetable ? `Weekly class: ${e.timetable.day}s at ${e.timetable.startTime} (Lagos), ${e.timetable.durationMin} min` : "Weekly class time: to be set by the academy"}</p>
                <p className="text-ink/70">Instructor: {e.instructor ? e.instructor.fullName : "being assigned"}</p>
                {e.instructor?.specialization && <p className="text-xs text-ink/60">{e.instructor.specialization}</p>}
              </div>
            ))}
            <p className="text-xs text-ink/60">To change your weekly class time, message your instructor or the academy.</p>
          </Card>
          <Card title="My progress">{prog.data?.progress.map((p) => <ProgressView key={p.enrolmentId} p={p} />)}{prog.data && !prog.data.progress.length && <Empty>Progress appears once you are enrolled.</Empty>}</Card>
          <Card title="Payments">
            {pay.data?.orders.map((o) => (
              <div key={o.reference} className="mb-3 text-sm">
                <p className="font-semibold">{o.programme} · {o.plan} <Badge s={o.status} /></p>
                <p>Total {naira(o.totalNaira)} · paid {naira(o.paidNaira)} · outstanding <b>{naira(o.outstandingNaira)}</b></p>
                <ul className="mt-1 text-xs">{o.parts.map((p) => <li key={p.part}>Part {p.part}: {naira(p.naira)} due {p.due} <Badge s={p.status} /> {p.payLink && <a href={p.payLink} className="font-semibold text-brand-red underline">Pay now</a>}</li>)}</ul>
              </div>
            ))}
            {pay.data && !pay.data.orders.length && <Empty>No payments found for {me.email}.</Empty>}
          </Card>
          {ins && <Card title={`Rate ${ins.fullName}`}>
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rate === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRate(n)} className={`text-2xl ${n <= rate ? "text-brand-orange" : "text-ink/20"}`}>★</button>)}</div>
            <Btn small disabled={!rate} onClick={() => run(() => api("/api/app/student/ratings", { method: "POST", body: { instructorId: ins.id, rating: rate } }), "Thank you for your feedback.")}>Send rating</Btn>
            <Msg text={msg.text} kind={msg.kind} />
          </Card>}
        </div>
      </div>
    </>
  );
}

"use client";
// Admin dashboard: the academy's command centre, in tabs.
import { useState } from "react";
import type { Me } from "./page";
import { AppShell, type NavItem } from "./shell";
import { PROGRAMMES } from "@/lib/config";
import { api, Badge, Btn, Card, Empty, Field, inputCls, Msg, naira, PageTitle, Stat, useAction, useLoad, useTab, when } from "./ui";
import { MaterialsManager } from "./shared";
import { AdmissionsAdmin, RecruitmentAdmin } from "./admissions-admin";

const TABS = ["overview", "admit", "admissions", "users", "recruitment", "enrolments", "orders", "academics", "finance", "instructors", "courses", "materials", "platform"] as const;
type Tab = (typeof TABS)[number];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type U = { id: string; email: string; role: string; status: string; fullName: string; studentNo: string | null; lastLoginAt: string | null };


function Overview() {
  const { data } = useLoad<{ overview: Record<string, number> }>("/api/app/admin/overview");
  const o = data?.overview;
  if (!o) return <Empty>Loading…</Empty>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Students" value={o.students} note={`${o.active_students} active`} />
      <Stat label="Instructors" value={o.instructors} note={`${o.active_instructors} active`} />
      <Stat label="Programmes" value={o.programmes} note={`${o.courses} courses`} />
      <Stat label="Enrolments" value={o.enrolments} note={`${o.ongoing} ongoing · ${o.completed} completed`} />
      <Stat label="Awaiting an instructor" value={o.awaiting_instructor} />
      <Stat label="Awaiting a weekly time" value={o.awaiting_timetable} />
      <Stat label="Registrations (30 days)" value={o.paid_registrations_30d} note={`${o.unpaid_registrations_30d} unpaid`} />
      <Stat label="Attendance to record" value={o.pending_outcomes} />
    </div>
  );
}

function Users() {
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const { data, reload } = useLoad<{ users: U[] }>(`/api/app/admin/users?limit=100${role ? `&role=${role}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const { busy, msg, run } = useAction();
  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <Card title="Users" action={<div className="flex gap-2"><select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className="rounded-xl border border-ink/15 px-2 py-1 text-sm"><option value="">All roles</option><option>student</option><option>instructor</option><option>admin</option></select><input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-32 rounded-xl border border-ink/15 px-2 py-1 text-sm" /></div>}>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink/60"><th className="py-1">Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>{data?.users.map((u) => (
            <tr key={u.id} className="border-t border-ink/10"><td className="py-2"><b>{u.fullName}</b><span className="block text-xs text-ink/60">{u.email}{u.studentNo ? ` · ${u.studentNo}` : ""}</span></td><td><Badge s={u.role} /></td><td><Badge s={u.status} /></td>
              <td className="text-xs">{u.lastLoginAt ? when(u.lastLoginAt) : "never"}</td>
              <td className="space-x-1 whitespace-nowrap text-right">
                <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/users/${u.id}/invite`, { method: "POST" }), `Sign-in link sent to ${u.email}.`)}>Send link</Btn>
                <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/users/${u.id}`, { method: "PATCH", body: { status: u.status === "active" ? "suspended" : "active" } }), "Updated.", reload)}>{u.status === "active" ? "Suspend" : "Reactivate"}</Btn>
              </td></tr>
          ))}</tbody></table></div>
        <Msg text={msg.text} kind={msg.kind} />
      </Card>
      <Card title="Add a person">
        <p className="mb-3 text-sm text-ink/60">For a paying student, use <b>Admit a student</b> so the payment, registration number and enrolment are recorded too.</p>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget; run(() => api("/api/app/admin/users", { method: "POST", body: f }), f.role === "instructor" ? "Added as an instructor candidate. Approve them in Recruitment to send their sign-in link." : "Created. A sign-in link was emailed.", () => { form.reset(); reload(); }); }}>
          <Field label="Full name"><input name="fullName" required className={inputCls} /></Field>
          <Field label="Email"><input name="email" type="email" required className={inputCls} /></Field>
          <Field label="Role"><select name="role" className={inputCls}><option value="instructor">Instructor (candidate)</option><option value="admin">Administrator</option><option value="student">Student (account only)</option></select></Field>
          <Field label="Phone (optional)"><input name="phone" className={inputCls} /></Field>
          <Btn type="submit" disabled={busy}>Create and invite</Btn>
        </form>
      </Card>
    </div>
  );
}

function Enrolments() {
  const { data, reload } = useLoad<{ enrolments: { id: string; student_id: string; programme_slug: string; instructor_id: string | null; status: string; student_name: string; student_email: string; instructor_name: string | null }[] }>("/api/app/admin/enrolments?limit=100");
  const students = useLoad<{ users: U[] }>("/api/app/admin/users?role=student&limit=100");
  // Only approved, active instructors can be assigned students.
  const approved = useLoad<{ candidates: { id: string; fullName: string; status: string }[] }>("/api/app/admin/recruitment?stage=approved");
  const instructors = { data: approved.data ? { users: approved.data.candidates.filter((c) => c.status === "active") } : null };
  const [open, setOpen] = useState<string | null>(null);
  const { busy, msg, run } = useAction();
  const name = (slug: string) => PROGRAMMES.find((p) => p.slug === slug)?.name ?? slug;
  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <Card title="Enrolments">
        <ul className="space-y-2">{data?.enrolments.map((e) => (
          <li key={e.id} className="rounded-xl bg-ink/[0.03] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{e.student_name}</b> · {name(e.programme_slug)}<span className="block text-xs text-ink/60">Instructor: {e.instructor_name ?? "not assigned"}</span></span>
              <span className="flex items-center gap-2"><Badge s={e.status} /><Btn small kind="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Close" : "Manage"}</Btn></span></div>
            {open === e.id && <div className="mt-3 grid gap-3 md:grid-cols-2">
              <form className="space-y-2" onSubmit={(ev) => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.currentTarget)); run(() => api(`/api/app/admin/enrolments/${e.id}`, { method: "PATCH", body: { instructorId: f.instructorId || null, status: f.status } }), "Saved.", reload); }}>
                <Field label="Instructor"><select name="instructorId" defaultValue={e.instructor_id ?? ""} className={inputCls}><option value="">Not assigned</option>{instructors.data?.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
                <Field label="Status"><select name="status" defaultValue={e.status} className={inputCls}>{["active", "paused", "completed", "withdrawn"].map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Btn small type="submit" disabled={busy}>Save</Btn>
              </form>
              <form className="space-y-2" onSubmit={(ev) => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>; run(() => api(`/api/app/admin/enrolments/${e.id}/timetable`, { method: "POST", body: { weekday: Number(f.weekday), startTime: f.startTime, durationMin: Number(f.durationMin), effectiveFrom: f.from || undefined } }), "Weekly time saved; classes for the next 14 days were created and both were told.", reload); }}>
                <p className="text-xs font-bold">Fixed weekly class time</p>
                <div className="grid grid-cols-2 gap-2">
                  <select name="weekday" aria-label="Day" className={inputCls}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
                  <input name="startTime" type="time" required aria-label="Start time (Lagos)" className={inputCls} />
                  <select name="durationMin" aria-label="Length" className={inputCls}><option value={45}>45 min</option><option value={60}>60 min</option></select>
                  <input name="from" type="date" aria-label="Starting from" className={inputCls} />
                </div>
                <Btn small type="submit" disabled={busy}>Set weekly time</Btn>
              </form>
            </div>}
          </li>
        ))}</ul>
        {data && !data.enrolments.length && <Empty>No enrolments yet. Students who pay online are enrolled automatically.</Empty>}
        <Msg text={msg.text} kind={msg.kind} />
      </Card>
      <Card title="Enrol a student">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); run(() => api("/api/app/admin/enrolments", { method: "POST", body: { ...f, instructorId: f.instructorId || null } }), "Enrolled.", reload); }}>
          <Field label="Student"><select name="studentId" required className={inputCls}>{students.data?.users.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}</select></Field>
          <Field label="Programme"><select name="programme" className={inputCls}>{PROGRAMMES.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
          <Field label="Instructor"><select name="instructorId" className={inputCls}><option value="">Assign later</option>{instructors.data?.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
          <Btn type="submit" disabled={busy}>Enrol</Btn>
        </form>
      </Card>
    </div>
  );
}

function Orders() {
  const [st, setSt] = useState("");
  const { data, reload } = useLoad<{ orders: { id: string; reference: string; createdAt: string; programme: string; plan: string; method: string; totalNaira: number; paidNaira: number; outstandingNaira: number; status: string; name: string; email: string; phone: string | null; accountId: string | null; parts: { seq: number; naira: number; due: string; status: string }[] }[] }>(`/api/app/admin/orders?limit=100${st ? `&status=${st}` : ""}`);
  const { busy, msg, run } = useAction();
  return (
    <Card title="Registrations and orders" action={<select aria-label="Status" value={st} onChange={(e) => setSt(e.target.value)} className="rounded-xl border border-ink/15 px-2 py-1 text-sm"><option value="">All</option><option value="pending">Unpaid</option><option value="part_paid">Part paid</option><option value="paid">Paid</option></select>}>
      <ul className="space-y-2">{data?.orders.map((o) => (
        <li key={o.id} className="rounded-xl bg-ink/[0.03] p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span><b>{o.name}</b> · {o.programme} · {o.plan === "parts" ? "3 parts" : "full"} · {o.method}<span className="block text-xs text-ink/60">{o.email}{o.phone ? ` · ${o.phone}` : ""} · {o.reference} · {when(o.createdAt)}</span></span>
            <span className="text-right"><Badge s={o.status} /><span className="block text-xs">paid {naira(o.paidNaira)} / {naira(o.totalNaira)}</span><span className="block text-xs">{o.accountId ? "has a learning account" : "no account yet"}</span></span></div>
          <div className="mt-2 flex flex-wrap gap-2">{o.parts.filter((p) => p.status !== "paid").map((p) => (
            <Btn key={p.seq} small kind="ghost" disabled={busy} onClick={() => { const ref = prompt(`Bank reference for part ${p.seq} (${naira(p.naira)}), optional:`); if (ref !== null) run(() => api(`/api/app/admin/orders/${o.reference}/payments`, { method: "POST", body: { part: p.seq, bankReference: ref } }), `Part ${p.seq} recorded as paid.`, reload); }}>Confirm bank payment, part {p.seq} ({naira(p.naira)})</Btn>
          ))}</div>
        </li>
      ))}</ul>
      {data && !data.orders.length && <Empty>No orders.</Empty>}
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

function Academics() {
  const { data } = useLoad<{ academics: { assignmentCompletionPct: number | null; avgAssignmentPct: number | null; avgQuizPct: number | null; avgAssessmentPct: number | null; lessonsCompleted: number; programmesCompleted: number; last30Days: { completed: number; missed: number; cancelled: number; attendancePct: number | null } }; needsAttention: { enrolmentId: string; student: string; programme: string; instructor: string | null; reasons: string[] }[] }>("/api/app/admin/academics");
  const pend = useLoad<{ sessions: { id: string; lagosTime: string; programmeName: string; student: { fullName: string }; instructor: { fullName: string } | null }[] }>("/api/app/admin/sessions/pending-outcomes");
  const a = data?.academics;
  return (
    <div className="space-y-5">
      {a && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Assignments submitted on time" value={a.assignmentCompletionPct === null ? null : `${a.assignmentCompletionPct}%`} />
        <Stat label="Average scores" value={a.avgAssignmentPct === null ? "n/a" : `${a.avgAssignmentPct}%`} note={`quizzes ${a.avgQuizPct ?? "n/a"}% · assessments ${a.avgAssessmentPct ?? "n/a"}%`} />
        <Stat label="Attendance (30 days)" value={a.last30Days.attendancePct === null ? null : `${a.last30Days.attendancePct}%`} note={`${a.last30Days.completed} done · ${a.last30Days.missed} missed · ${a.last30Days.cancelled} cancelled`} />
        <Stat label="Lessons completed" value={a.lessonsCompleted} note={`${a.programmesCompleted} programmes completed`} />
      </div>}
      <Card title="Students needing attention">
        <ul className="space-y-1 text-sm">{data?.needsAttention.map((n) => <li key={n.enrolmentId} className="rounded-xl bg-ink/[0.03] p-2"><b>{n.student}</b> · {n.programme} · {n.instructor ?? "no instructor"}<span className="block text-xs text-brand-red">{n.reasons.join(", ")}</span></li>)}</ul>
        {data && !data.needsAttention.length && <Empty>No warning signs right now.</Empty>}
      </Card>
      <Card title="Classes without a recorded outcome">
        <ul className="space-y-1 text-sm">{pend.data?.sessions.map((s) => <li key={s.id}>{s.lagosTime} · {s.student.fullName} · {s.programmeName} · {s.instructor?.fullName ?? "no instructor"}</li>)}</ul>
        {pend.data && !pend.data.sessions.length && <Empty>All attendance is recorded.</Empty>}
      </Card>
    </div>
  );
}

function Finance() {
  const { data } = useLoad<{ finance: { revenueNaira: number; payments: number; outstandingNaira: number; overdueNaira: number; oneTimePaid: number; instalmentOrders: number; awaitingBankConfirmation: number; unpaidCheckouts: number; byMonth: { month: string; naira: number; payments: number }[] } }>("/api/app/admin/finance");
  const pays = useLoad<{ payments: { id: string; method: string; naira: number; paidAt: string; reference: string; programme: string; part: number | null; name: string }[] }>("/api/app/admin/payments?limit=50");
  const f = data?.finance;
  return (
    <div className="space-y-5">
      {f && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total revenue" value={naira(f.revenueNaira)} note={`${f.payments} payments`} />
        <Stat label="Outstanding balances" value={naira(f.outstandingNaira)} note={`${naira(f.overdueNaira)} overdue`} />
        <Stat label="Paid in full / in parts" value={`${f.oneTimePaid} / ${f.instalmentOrders}`} />
        <Stat label="Unpaid checkouts" value={f.unpaidCheckouts} note={`${f.awaitingBankConfirmation} bank transfers to confirm`} />
      </div>}
      {f && <Card title="Revenue by month"><ul className="text-sm">{f.byMonth.map((m) => <li key={m.month} className="flex justify-between border-b border-ink/10 py-1"><span>{m.month}</span><b>{naira(m.naira)}</b></li>)}</ul>{!f.byMonth.length && <Empty>No payments yet.</Empty>}</Card>}
      <Card title="Recent payments"><ul className="text-sm">{pays.data?.payments.map((p) => <li key={p.id} className="flex justify-between gap-2 border-b border-ink/10 py-1"><span>{p.name} · {p.programme}{p.part ? ` · part ${p.part}` : ""} · {p.method}<span className="block text-xs text-ink/60">{p.reference} · {when(p.paidAt)}</span></span><b>{naira(p.naira)}</b></li>)}</ul></Card>
    </div>
  );
}

function Instructors() {
  const { data } = useLoad<{ instructors: { id: string; full_name: string; email: string; status: string; students: number; completed: number; missed: number; pending_outcomes: number; avg_rating: number | null }[] }>("/api/app/admin/instructors");
  return (
    <Card title="Instructors">
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink/60"><th className="py-1">Instructor</th><th>Active students</th><th>Completed</th><th>Missed</th><th>To record</th><th>Rating</th></tr></thead>
        <tbody>{data?.instructors.map((i) => <tr key={i.id} className="border-t border-ink/10"><td className="py-2"><b>{i.full_name}</b> <Badge s={i.status} /><span className="block text-xs text-ink/60">{i.email}</span></td><td>{i.students}</td><td>{i.completed}</td><td>{i.missed}</td><td>{i.pending_outcomes}</td><td>{i.avg_rating ?? "n/a"}</td></tr>)}</tbody></table></div>
      {data && !data.instructors.length && <Empty>No instructors yet. Add and approve them in Recruitment.</Empty>}
    </Card>
  );
}

function Materials() {
  return <MaterialsManager admin programmes={PROGRAMMES.map((p) => ({ slug: p.slug, name: p.name }))} />;
}

function Courses() {
  const [slug, setSlug] = useState(PROGRAMMES[0].slug);
  const { data, reload } = useLoad<{ courses: { id: string; title: string; position: number; lessons: { id: string; title: string; position: number }[] }[] }>(`/api/app/programmes/${slug}/courses`);
  const { busy, msg, run } = useAction();
  return (
    <Card title="Courses and lessons" action={<select aria-label="Programme" value={slug} onChange={(e) => setSlug(e.target.value)} className="rounded-xl border border-ink/15 px-2 py-1 text-sm">{PROGRAMMES.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>}>
      <p className="mb-3 text-xs text-ink/60">Lessons drive each student&apos;s progress bar. Students and instructors see the courses of their programme.</p>
      <ol className="space-y-3">{data?.courses.map((c) => (
        <li key={c.id} className="rounded-xl bg-ink/[0.03] p-3 text-sm">
          <b className="font-display">{c.title}</b>
          <ol className="ml-5 mt-1 list-decimal">{c.lessons.map((l) => <li key={l.id}>{l.title}</li>)}</ol>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget; run(() => api(`/api/app/admin/courses/${c.id}/lessons`, { method: "POST", body: { title: f.title, position: c.lessons.length + 1 } }), "Lesson added.", () => { form.reset(); reload(); }); }}>
            <input name="title" required aria-label="New lesson title" placeholder="New lesson title" className={`${inputCls} mt-0`} /><Btn small type="submit" disabled={busy}>Add lesson</Btn>
          </form>
        </li>
      ))}</ol>
      {data && !data.courses.length && <Empty>No courses yet for this programme.</Empty>}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget; run(() => api("/api/app/admin/courses", { method: "POST", body: { programme: slug, title: f.title, position: (data?.courses.length ?? 0) + 1 } }), "Course added.", () => { form.reset(); reload(); }); }}>
        <input name="title" required aria-label="New course title" placeholder="New course title" className={`${inputCls} mt-0`} /><Btn type="submit" disabled={busy}>Add course</Btn>
      </form>
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

function Platform() {
  const { data } = useLoad<{ platform: Record<string, number>; errors: { at: string; route: string; message: string }[]; website: { note: string } }>("/api/app/admin/platform");
  const audit = useLoad<{ entries: { at: string; action: string; actor_name: string | null; target_type: string | null }[] }>("/api/app/admin/audit?limit=50");
  const p = data?.platform;
  return (
    <div className="space-y-5">
      {p && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active users (7 days)" value={p.users_active_7d} note={`${p.sign_ins_7d} sign-ins`} />
        <Stat label="Errors" value={p.errors_24h} note={`last 24 h · ${p.errors_7d} in 7 days`} />
        <Stat label="Activity (7 days)" value={p.submissions_7d} note={`submissions · ${p.messages_7d} messages · ${p.ai_questions_7d} AI questions`} />
        <Stat label="Suspended accounts" value={p.suspended_accounts} />
      </div>}
      {data && <p className="rounded-2xl bg-paper p-3 text-sm">{data.website.note}</p>}
      <Card title="Recent errors"><ul className="text-xs">{data?.errors.map((e, i) => <li key={i} className="border-b border-ink/10 py-1">{when(e.at)} · {e.route} · {e.message.slice(0, 160)}</li>)}</ul>{data && !data.errors.length && <Empty>No errors.</Empty>}</Card>
      <Card title="Audit log"><ul className="text-xs">{audit.data?.entries.map((e, i) => <li key={i} className="border-b border-ink/10 py-1">{when(e.at)} · <b>{e.action}</b> · {e.actor_name ?? "system"}{e.target_type ? ` · ${e.target_type}` : ""}</li>)}</ul></Card>
    </div>
  );
}

// Admit a student who paid by transfer, cash or any route outside the website. The server creates the
// registration, order and instalments at the catalogue price, records what was paid, issues the
// registration number and sends the admission and access emails, exactly as an online payment would.
function Admit() {
  const approved = useLoad<{ candidates: { id: string; fullName: string; status: string }[] }>("/api/app/admin/recruitment?stage=approved");
  const instructors = (approved.data?.candidates ?? []).filter((c) => c.status === "active");
  const [plan, setPlan] = useState<"full" | "parts">("full");
  const [prog, setProg] = useState(PROGRAMMES[0]?.slug ?? "");
  const { busy, msg, run } = useAction();
  const price = PROGRAMMES.find((p) => p.slug === prog)?.price ?? 0;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Student details">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
          run(() => api("/api/app/admin/admit", { method: "POST", body: { ...f, paidParts: plan === "full" ? 1 : Number(f.paidParts), instructorId: f.instructorId || null } }),
            `${f.firstName} ${f.surname} was admitted. Their registration number, admission confirmation and sign-in link have been emailed to ${f.email}.`, () => form.reset());
        }}>
          <Field label="First name"><input name="firstName" required autoComplete="off" className={inputCls} /></Field>
          <Field label="Surname"><input name="surname" required autoComplete="off" className={inputCls} /></Field>
          <Field label="Email"><input name="email" type="email" required autoComplete="off" className={inputCls} /></Field>
          <Field label="Phone"><input name="phone" autoComplete="off" className={inputCls} /></Field>
          <Field label="Country"><input name="country" defaultValue="Nigeria" className={inputCls} /></Field>
          <Field label="Programme"><select name="programme" value={prog} onChange={(e) => setProg(e.target.value)} className={inputCls}>{PROGRAMMES.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
          <Field label="Payment plan"><select name="plan" value={plan} onChange={(e) => setPlan(e.target.value as "full" | "parts")} className={inputCls}><option value="full">Paid in full</option><option value="parts">Paying in 3 parts</option></select></Field>
          {plan === "parts" ? <Field label="Parts already paid"><select name="paidParts" className={inputCls}><option value="1">Part 1 (50%)</option><option value="2">Parts 1 and 2 (80%)</option><option value="3">All 3 parts</option></select></Field> : <div className="hidden sm:block" />}
          <Field label="Payment reference (bank or receipt)"><input name="paymentReference" placeholder="e.g. UBA transfer ref" className={inputCls} /></Field>
          <Field label="Instructor"><select name="instructorId" className={inputCls}><option value="">Assign later</option>{instructors.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3 border-t border-ink/[0.07] pt-4">
            <Btn type="submit" disabled={busy}>{busy ? "Admitting…" : "Admit student"}</Btn>
            <span className="text-xs text-ink/55">Catalogue price: {naira(price)}</span>
          </div>
          <div className="sm:col-span-2"><Msg text={msg.text} kind={msg.kind} /></div>
        </form>
      </Card>
      <Card title="What happens">
        <ol className="space-y-3 text-sm text-ink/75">
          {["The registration and order are recorded at the programme's catalogue price, with the payment you confirm here.",
            "A registration number (SMA/yy/000001) is issued and the student account is created.",
            "The student receives the admission confirmation email and a separate sign-in link to their learning space.",
            "If you choose an instructor, the enrolment is assigned at once. Otherwise assign one under Enrolments.",
            "The action is recorded in the audit log under your name."].map((t, i) => (
            <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo/[0.08] text-xs font-semibold text-indigo">{i + 1}</span><span>{t}</span></li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg bg-brand-orange/10 p-3 text-xs text-ink/70">Only admit a student once the payment is confirmed in the bank account. Students who pay online through the website are admitted automatically.</p>
      </Card>
    </div>
  );
}

const TITLES: Record<Tab, [string, string?]> = {
  overview: ["Academy overview", "The state of admissions, teaching and finance today."],
  admit: ["Admit a student", "For a student who paid outside the website, or could not complete the online form."],
  admissions: ["Admissions", "Intake status and capacity for each programme."],
  users: ["People", "Every account. Add staff, send sign-in links, suspend or reactivate."],
  recruitment: ["Faculty recruitment", "Instructor candidates move through verification before they can teach."],
  enrolments: ["Enrolments", "Assign instructors and fixed weekly class times."],
  orders: ["Orders", "Registrations and instalments."],
  academics: ["Academics", "Attendance, coursework and students needing attention."],
  finance: ["Finance", "Payments received and outstanding."],
  instructors: ["Instructors", "Teaching activity and ratings."],
  courses: ["Courses", "Programme curricula."],
  materials: ["Materials", "Approve and publish learning materials."],
  platform: ["Platform health", "Errors, activity and the audit log."],
};

export function AdminDashboard({ me }: { me: Me }) {
  const [tab, setTab] = useTab(TABS, "overview");
  const nav: NavItem<Tab>[] = [
    { id: "overview", label: "Overview", icon: "home" },
    { id: "admit", label: "Admit a student", icon: "plus" },
    { id: "admissions", label: "Admissions", icon: "school" },
    { id: "users", label: "People", icon: "users" },
    { id: "recruitment", label: "Recruitment", icon: "check" },
    { id: "enrolments", label: "Enrolments", icon: "calendar" },
    { id: "orders", label: "Orders", icon: "clipboard" },
    { id: "academics", label: "Academics", icon: "book" },
    { id: "finance", label: "Finance", icon: "cash" },
    { id: "instructors", label: "Instructors", icon: "chart" },
    { id: "courses", label: "Courses", icon: "folder" },
    { id: "materials", label: "Materials", icon: "folder" },
    { id: "platform", label: "Platform", icon: "shield" },
  ];
  const [title, sub] = TITLES[tab];
  return (
    <AppShell me={me} nav={nav} tab={tab} setTab={setTab}>
      <PageTitle title={title} sub={sub} action={tab !== "admit" ? <Btn kind="ghost" small onClick={() => setTab("admit")}>+ Admit a student</Btn> : undefined} />
      {tab === "overview" && <Overview />}
      {tab === "admit" && <Admit />}
      {tab === "admissions" && <AdmissionsAdmin />}
      {tab === "users" && <Users />}
      {tab === "recruitment" && <RecruitmentAdmin />}
      {tab === "enrolments" && <Enrolments />}
      {tab === "orders" && <Orders />}
      {tab === "academics" && <Academics />}
      {tab === "finance" && <Finance />}
      {tab === "instructors" && <Instructors />}
      {tab === "courses" && <Courses />}
      {tab === "materials" && <Materials />}
      {tab === "platform" && <Platform />}
    </AppShell>
  );
}

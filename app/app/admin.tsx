"use client";
// Admin dashboard: the academy's command centre, in tabs.
import { Fragment, useState } from "react";
import type { Me } from "./page";
import { AppShell, NotificationsPage, type NavItem } from "./shell";
import { PROGRAMMES } from "@/lib/config";
import { statusLabel, type PublicStatus } from "@/lib/admissions";
import { api, Badge, Btn, Card, Empty, Field, inputCls, Msg, naira, PageTitle, Stat, useAction, useLoad, useNow, useTab, when } from "./ui";
import { MaterialsManager } from "./shared";
import { AdmissionsAdmin, RecruitmentAdmin } from "./admissions-admin";
import { AssistantEnquiries, CallRequests } from "./desk-admin";
import { CurrencySettings, Monitoring } from "./monitoring-admin";
import { MfaSettings } from "./mfa";
import { OwnerConsole } from "./owner";
import { RetentionSettings } from "./security-admin";

const TABS = ["overview", "students", "instructors", "programmes", "admissions", "payments", "records", "allocation", "attendance", "assessments", "materials", "content", "reports", "notifications", "security", "owner"] as const;
type Tab = (typeof TABS)[number];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type U = { id: string; email: string; role: string; status: string; fullName: string; studentNo: string | null; lastLoginAt: string | null; adminRole?: string | null };


// Institutional overview: the figures in one dense table, and the items that need an administrator's action.
function Overview({ go }: { go: (t: Tab) => void }) {
  const { data } = useLoad<{ overview: Record<string, number> }>("/api/app/admin/overview");
  const fin = useLoad<{ finance: { revenueNaira: number; outstandingNaira: number; overdueNaira: number; awaitingBankConfirmation: number } }>("/api/app/admin/finance");
  const rec = useLoad<{ candidates: { id: string; verification: string; profileSubmittedAt?: string | null }[] }>("/api/app/admin/recruitment");
  const o = data?.overview;
  if (!o) return <Empty>Loading…</Empty>;
  const f = fin.data?.finance;
  const toVerify = (rec.data?.candidates ?? []).filter((c) => c.profileSubmittedAt && c.verification !== "approved" && c.verification !== "rejected" && c.verification !== "suspended").length;
  const actions: [string, number, Tab][] = [
    ["Students awaiting an instructor", o.awaiting_instructor, "allocation"], ["Enrolments awaiting a weekly class time", o.awaiting_timetable, "allocation"],
    ["Classes without a recorded outcome", o.pending_outcomes, "attendance"], ["Bank transfers to confirm", f?.awaitingBankConfirmation ?? 0, "payments"],
    ["Instructor profiles submitted for verification", toVerify, "instructors"],
  ];
  const rows: [string, string, string][] = [
    ["Students", String(o.students), `${o.active_students} active`], ["Instructors", String(o.instructors), `${o.active_instructors} active`],
    ["Programmes", String(o.programmes), `${o.courses} courses published`], ["Enrolments", String(o.enrolments), `${o.ongoing} ongoing · ${o.completed} completed`],
    ["Paid registrations (30 days)", String(o.paid_registrations_30d), `${o.unpaid_registrations_30d} unpaid`],
    ...(f ? [["Revenue to date", naira(f.revenueNaira), ""], ["Outstanding balances", naira(f.outstandingNaira), `${naira(f.overdueNaira)} overdue`]] as [string, string, string][] : []),
  ];
  return (
    <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[1.3fr_1fr]">
      <Card title="Institution at a glance">
        <table className="w-full text-left text-[0.95rem]"><tbody>{rows.map(([k, v, n]) => <tr key={k} className="border-b border-ink/[0.07] last:border-0"><th scope="row" className="py-2.5 pr-3 font-medium text-ink/75">{k}</th><td className="py-2.5 pr-3 text-right font-display text-lg font-semibold tabular-nums">{v}</td><td className="py-2.5 text-sm text-ink/70">{n}</td></tr>)}</tbody></table>
      </Card>
      <Card title="Needs your action">
        <ul className="divide-y divide-ink/[0.07]">{actions.map(([k, n, t]) => (
          <li key={k} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${n ? "bg-brand-orange" : "bg-ink/20"}`} aria-hidden="true" />{k}</span>
            <span className="flex items-center gap-3"><b className="tabular-nums">{n}</b>{n > 0 && <Btn small kind="ghost" onClick={() => go(t)}>Open</Btn>}</span>
          </li>
        ))}</ul>
      </Card>
    </div>
  );
}

// Attendance across the Academy for a chosen period, with the classes still awaiting an outcome.
function Attendance() {
  const [days, setDays] = useState(14);
  const [status, setStatus] = useState("");
  const now = useNow();
  const day = (n: number) => new Date(now + n * 86400_000 + 3600_000).toISOString().slice(0, 10);
  const { data } = useLoad<{ sessions: { id: string; lagosTime: string; programmeName: string; status: string; student: { fullName: string }; instructor: { fullName: string } | null }[] }>(now ? `/api/app/admin/sessions?from=${day(-days)}&to=${day(1)}${status ? `&status=${status}` : ""}` : null);
  const list = (data?.sessions ?? []).filter((x) => status || x.status !== "scheduled");
  const count = (st: string) => list.filter((x) => x.status === st).length;
  return (
    <Card title="Class attendance" action={<div className="flex flex-wrap gap-2">
      <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputCls} mt-0 w-auto`}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
      <select aria-label="Outcome" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} mt-0 w-auto`}><option value="">All outcomes</option><option value="completed">Completed</option><option value="missed">Missed</option><option value="cancelled">Cancelled</option><option value="scheduled">Awaiting outcome</option></select>
    </div>}>
      <p className="mb-3 text-[0.95rem] text-ink/75">{count("completed")} completed · {count("missed")} missed · {count("cancelled")} cancelled</p>
      {list.length ? <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-[0.95rem]">
        <thead><tr className="border-b border-ink/10 text-sm text-ink/70"><th className="px-2 py-2 font-semibold">Date</th><th className="px-2 py-2 font-semibold">Student</th><th className="px-2 py-2 font-semibold">Instructor</th><th className="px-2 py-2 font-semibold">Programme</th><th className="px-2 py-2 font-semibold">Outcome</th></tr></thead>
        <tbody>{list.map((x) => <tr key={x.id} className="border-b border-ink/[0.06] last:border-0"><td className="px-2 py-2.5">{x.lagosTime}</td><td className="px-2 py-2.5 font-semibold">{x.student.fullName}</td><td className="px-2 py-2.5">{x.instructor?.fullName ?? "None"}</td><td className="px-2 py-2.5">{x.programmeName}</td><td className="px-2 py-2.5"><Badge s={x.status === "scheduled" ? "pending" : x.status} /></td></tr>)}</tbody>
      </table></div> : <Empty>No classes in this period.</Empty>}
    </Card>
  );
}

// Coursework across the Academy: assignments, quizzes and assessments with their status and marks.
function Assessments() {
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const { data } = useLoad<{ coursework: { id: string; kind: string; title: string; studentName: string; programmeName: string; dueText: string; status: string; scorePct: number | null }[] }>("/api/app/admin/coursework");
  const list = (data?.coursework ?? []).filter((x) => (!kind || x.kind === kind) && (!q || `${x.title} ${x.studentName} ${x.programmeName}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Card title="Coursework and assessments" action={<div className="flex flex-wrap gap-2">
      <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputCls} mt-0 w-auto`}><option value="">All types</option><option value="assignment">Assignments</option><option value="quiz">Quizzes</option><option value="assessment">Assessments</option></select>
      <input aria-label="Search coursework" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, student or programme" className={`${inputCls} mt-0 w-64`} />
    </div>}>
      {list.length ? <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-[0.95rem]">
        <thead><tr className="border-b border-ink/10 text-sm text-ink/70"><th className="px-2 py-2 font-semibold">Title</th><th className="px-2 py-2 font-semibold">Type</th><th className="px-2 py-2 font-semibold">Student</th><th className="px-2 py-2 font-semibold">Programme</th><th className="px-2 py-2 font-semibold">Due</th><th className="px-2 py-2 font-semibold">Status</th><th className="px-2 py-2 text-right font-semibold">Mark</th></tr></thead>
        <tbody>{list.map((x) => <tr key={x.kind + x.id} className="border-b border-ink/[0.06] last:border-0"><td className="px-2 py-2.5 font-semibold">{x.title}</td><td className="px-2 py-2.5 capitalize">{x.kind}</td><td className="px-2 py-2.5">{x.studentName}</td><td className="px-2 py-2.5">{x.programmeName}</td><td className="px-2 py-2.5 text-ink/75">{x.dueText}</td><td className="px-2 py-2.5"><Badge s={x.status} /></td><td className="px-2 py-2.5 text-right tabular-nums">{x.scorePct === null ? "–" : `${x.scorePct}%`}</td></tr>)}</tbody>
      </table></div> : <Empty>{data ? "No coursework matches." : "Loading…"}</Empty>}
    </Card>
  );
}

// A segmented control for the sub-views of one section (no nested menus).
function Segments<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return <div role="tablist" className="mb-5 inline-flex flex-wrap rounded-lg border border-ink/15 p-0.5">{items.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={`rounded-md px-4 py-2 text-sm font-semibold ${value === v ? "bg-indigo text-white" : "text-ink/75 hover:text-ink"}`}>{l}</button>)}</div>;
}

// Administrator groups (server: src/server/lms/permissions.ts). Only a Super Administrator can change them.
const ADMIN_GROUPS: [string, string][] = [["super", "Super Administrator"], ["admissions", "Admissions"], ["finance", "Finance"], ["academic", "Academic Administration"],
  ["faculty", "Faculty Management"], ["support", "Student Support"], ["reporting", "Read-only Reporting"]];

function Users({ fixedRole, title = "Users", addRoles = ["instructor", "admin", "student"], access = null, meId }: { fixedRole?: string; title?: string; addRoles?: string[]; access?: Access; meId?: string }) {
  const [role, setRole] = useState(fixedRole ?? "");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const { data, reload } = useLoad<{ users: U[] }>(`/api/app/admin/users?limit=100${role ? `&role=${role}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const users = (data?.users ?? []).filter((u) => !status || u.status === status);
  const { busy, msg, run } = useAction();
  return (
    <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-[2fr_1fr]">
      <Card title={`${title}${data ? ` (${users.length})` : ""}`} action={<div className="flex flex-wrap gap-2">
        {!fixedRole && <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className={`${inputCls} mt-0 w-auto`}><option value="">All roles</option><option value="student">Students</option><option value="instructor">Instructors</option><option value="admin">Administrators</option></select>}
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} mt-0 w-auto`}><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
        <input aria-label="Search by name, email or number" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, number" className={`${inputCls} mt-0 w-56`} />
      </div>}>
        <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-[0.95rem]"><thead><tr className="border-b border-ink/10 text-sm text-ink/70"><th className="px-2 py-2 font-semibold">Name</th>{!fixedRole && <th className="px-2 py-2 font-semibold">Role</th>}<th className="px-2 py-2 font-semibold">Status</th><th className="px-2 py-2 font-semibold">Last sign-in</th><th className="px-2 py-2"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{users.map((u) => (<Fragment key={u.id}>
            <tr className="border-b border-ink/[0.06] last:border-0"><td className="px-2 py-2.5"><b>{u.fullName}</b><span className="block text-sm text-ink/70">{u.email}{u.studentNo ? ` · ${u.studentNo}` : ""}</span></td>{!fixedRole && <td className="px-2 py-2.5"><Badge s={u.role} /></td>}<td className="px-2 py-2.5"><Badge s={u.status} /></td>
              <td className="px-2 py-2.5 text-sm">{u.lastLoginAt ? when(u.lastLoginAt) : "Never"}</td>
              <td className="space-x-1 whitespace-nowrap px-2 py-2.5 text-right">
                <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/users/${u.id}/invite`, { method: "POST" }), `Sign-in link sent to ${u.email}.`)}>Send link</Btn>
                <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/users/${u.id}`, { method: "PATCH", body: { status: u.status === "active" ? "suspended" : "active" } }), "Updated.", reload)}>{u.status === "active" ? "Suspend" : "Reactivate"}</Btn>
              </td></tr>
            {u.id !== meId && (access?.owner || (access?.role === "super" && u.role !== "student")) && <tr><td colSpan={9} className="px-2 pb-2 text-right text-sm">
              {access?.owner
                ? <Btn small kind="ghost" disabled={busy} onClick={() => { const reason = prompt(`Revoke access permanently for ${u.fullName}? They can never sign in again; NO records are deleted (classes, attendance, work, grades, payments and the audit log are kept). Reason (required):`); if (reason?.trim()) run(async () => { const r = await api<{ activeEnrolmentsToReassign?: number }>(`/api/app/owner/users/${u.id}/remove`, { method: "POST", body: { reason } }); if (r.activeEnrolmentsToReassign) alert(`Access revoked. ${r.activeEnrolmentsToReassign} enrolment(s) still need a new instructor: see Academics > Enrolments (the Owner console lists them).`); }, "Access revoked permanently. Records kept.", reload); }}>Revoke access permanently</Btn>
                : <Btn small kind="ghost" disabled={busy} onClick={() => { const reason = prompt(`Ask the owner to revoke ${u.fullName}'s access permanently (records are kept). Reason (required):`); if (reason?.trim()) run(() => api(`/api/app/admin/users/${u.id}/removal-requests`, { method: "POST", body: { reason } }), "Request sent to the owner.", reload); }}>Request access revocation</Btn>}
            </td></tr>}
            {u.role === "admin" && <tr className="border-b border-ink/[0.06]"><td colSpan={9} className="px-2 pb-3 text-sm">
              <span className="mr-2 text-ink/70">Administrator group:</span>
              <select aria-label={`Administrator group for ${u.fullName}`} value={u.adminRole ?? ""} disabled={busy}
                onChange={(e) => { if (e.target.value) run(() => api(`/api/app/admin/users/${u.id}`, { method: "PATCH", body: { adminRole: e.target.value } }), "Group saved. That person was signed out so the change applies at once.", reload); }}
                className={`${inputCls} mt-0 inline-block w-auto py-1`}>
                {!u.adminRole && <option value="">Not assigned (full access, as before)</option>}
                {ADMIN_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <Btn small kind="ghost" disabled={busy} onClick={() => { if (confirm(`Remove two-step sign-in from ${u.fullName}? They will be signed out everywhere and must set it up again.`)) run(() => api(`/api/app/admin/users/${u.id}/mfa-reset`, { method: "POST" }), "Two-step sign-in reset.", reload); }}>Reset two-step sign-in</Btn>
            </td></tr>}</Fragment>
          ))}</tbody></table></div>
        {data && !users.length && <Empty>No one matches.</Empty>}
        <Msg text={msg.text} kind={msg.kind} />
      </Card>
      <Card title="Add a person">
        <p className="mb-3 text-sm text-ink/60">For a paying student, use <b>Admit a student</b> so the payment, registration number and enrolment are recorded too.</p>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget; run(() => api("/api/app/admin/users", { method: "POST", body: f }), f.role === "instructor" ? "Added. They were emailed an invitation to sign in and complete their faculty profile; verify and approve them in Recruitment." : "Created. A sign-in link was emailed.", () => { form.reset(); reload(); }); }}>
          <Field label="Full name"><input name="fullName" required className={inputCls} /></Field>
          <Field label="Email"><input name="email" type="email" required className={inputCls} /></Field>
          <Field label="Role"><select name="role" className={inputCls}>{addRoles.map((r) => <option key={r} value={r}>{r === "instructor" ? "Instructor (candidate)" : r === "admin" ? "Administrator" : "Student (account only)"}</option>)}</select></Field>
          <Field label="Phone (optional)"><input name="phone" className={inputCls} /></Field>
          {addRoles.includes("admin") && <Field label="Administrator group (administrators only)"><select name="adminRole" defaultValue="reporting" className={inputCls}>{ADMIN_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}
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
    <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-[2fr_1fr]">
      <Card title="Enrolments">
        <ul className="space-y-2">{data?.enrolments.map((e) => (
          <li key={e.id} className="rounded-lg border border-ink/10 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{e.student_name}</b> · {name(e.programme_slug)}<span className="block text-sm text-ink/60">Instructor: {e.instructor_name ?? "not assigned"}</span></span>
              <span className="flex items-center gap-2"><Badge s={e.status} /><Btn small kind="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Close" : "Manage"}</Btn></span></div>
            {open === e.id && <div className="mt-3 grid gap-3 md:grid-cols-2">
              <form className="space-y-2" onSubmit={(ev) => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.currentTarget)); run(() => api(`/api/app/admin/enrolments/${e.id}`, { method: "PATCH", body: { instructorId: f.instructorId || null, status: f.status } }), "Saved.", reload); }}>
                <Field label="Instructor"><select name="instructorId" defaultValue={e.instructor_id ?? ""} className={inputCls}><option value="">Not assigned</option>{instructors.data?.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
                <Field label="Status"><select name="status" defaultValue={e.status} className={inputCls}>{["active", "paused", "completed", "withdrawn"].map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Btn small type="submit" disabled={busy}>Save</Btn>
              </form>
              <form className="space-y-2" onSubmit={(ev) => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>; run(() => api(`/api/app/admin/enrolments/${e.id}/timetable`, { method: "POST", body: { weekday: Number(f.weekday), startTime: f.startTime, durationMin: Number(f.durationMin), effectiveFrom: f.from || undefined } }), "Weekly time saved; classes for the next 14 days were created and both were told.", reload); }}>
                <p className="text-sm font-bold">Fixed weekly class time</p>
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
    <Card title="Registrations and orders" action={<select aria-label="Status" value={st} onChange={(e) => setSt(e.target.value)} className={`${inputCls} mt-0 w-auto`}><option value="">All</option><option value="pending">Unpaid</option><option value="part_paid">Part paid</option><option value="paid">Paid</option></select>}>
      <ul className="space-y-2">{data?.orders.map((o) => (
        <li key={o.id} className="rounded-lg border border-ink/10 p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span><b>{o.name}</b> · {o.programme} · {o.plan === "parts" ? "3 parts" : "full"} · {o.method}<span className="block text-sm text-ink/60">{o.email}{o.phone ? ` · ${o.phone}` : ""} · {o.reference} · {when(o.createdAt)}</span></span>
            <span className="text-right"><Badge s={o.status} /><span className="block text-sm">paid {naira(o.paidNaira)} / {naira(o.totalNaira)}</span><span className="block text-sm">{o.accountId ? "has a learning account" : "no account yet"}</span></span></div>
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
        <ul className="space-y-1 text-sm">{data?.needsAttention.map((n) => <li key={n.enrolmentId} className="rounded-lg border border-ink/10 p-3"><b>{n.student}</b> · {n.programme} · {n.instructor ?? "no instructor"}<span className="block text-sm text-brand-red">{n.reasons.join(", ")}</span></li>)}</ul>
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
      <Card title="Recent payments"><ul className="text-sm">{pays.data?.payments.map((p) => <li key={p.id} className="flex justify-between gap-2 border-b border-ink/10 py-1"><span>{p.name} · {p.programme}{p.part ? ` · part ${p.part}` : ""} · {p.method}<span className="block text-sm text-ink/60">{p.reference} · {when(p.paidAt)}</span></span><b>{naira(p.naira)}</b></li>)}</ul></Card>
    </div>
  );
}

function Instructors() {
  const { data } = useLoad<{ instructors: { id: string; full_name: string; email: string; status: string; students: number; completed: number; missed: number; pending_outcomes: number; avg_rating: number | null }[] }>("/api/app/admin/instructors");
  return (
    <Card title="Instructors">
      <div className="relative overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-sm text-ink/60"><th className="py-1">Instructor</th><th>Active students</th><th>Completed</th><th>Missed</th><th>To record</th><th>Rating</th></tr></thead>
        <tbody>{data?.instructors.map((i) => <tr key={i.id} className="border-t border-ink/10"><td className="py-2"><b>{i.full_name}</b> <Badge s={i.status} /><span className="block text-sm text-ink/60">{i.email}</span></td><td>{i.students}</td><td>{i.completed}</td><td>{i.missed}</td><td>{i.pending_outcomes}</td><td>{i.avg_rating ?? "n/a"}</td></tr>)}</tbody></table></div>
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
    <Card title="Courses and lessons" action={<select aria-label="Programme" value={slug} onChange={(e) => setSlug(e.target.value)} className={`${inputCls} mt-0 w-auto`}>{PROGRAMMES.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>}>
      <p className="mb-3 text-sm text-ink/60">Lessons drive each student&apos;s progress bar. Students and instructors see the courses of their programme.</p>
      <ol className="space-y-3">{data?.courses.map((c) => (
        <li key={c.id} className="rounded-lg border border-ink/10 p-4 text-sm">
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

// Sends a test email to the signed-in admin and shows Resend's answer.
function EmailCheck() {
  const [res, setRes] = useState<{ sent: boolean; to: string; reason: string; ms: number; from: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await api("/api/app/admin/test-email", { method: "POST" })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Card title="Email check" action={<Btn small disabled={busy} onClick={go}>{busy ? "Sending…" : "Send a test email"}</Btn>}>
      <p className="text-sm text-ink/65">Sends a test to your own address straight away and shows what Resend answered.</p>
      {res && (res.sent
        ? <p className="mt-3 rounded-lg bg-indigo/[0.06] p-3 text-sm"><b>Accepted by Resend in {(res.ms / 1000).toFixed(1)} s</b> and sent to {res.to} from {res.from}. If it does not arrive within a minute, the delay is at the receiving mailbox: check spam, and try a Gmail address to compare.</p>
        : <p className="mt-3 rounded-lg bg-brand-red/10 p-3 text-sm text-brand-red"><b>Not sent.</b> {res.reason}</p>)}
      <Msg text={err} />
    </Card>
  );
}

function Platform() {
  const { data } = useLoad<{ platform: Record<string, number>; errors: { at: string; route: string; message: string }[]; website: { note: string } }>("/api/app/admin/platform");
  const audit = useLoad<{ entries: { at: string; action: string; actor_name: string | null; target_type: string | null }[] }>("/api/app/admin/audit?limit=50");
  const p = data?.platform;
  return (
    <div className="space-y-5">
      <EmailCheck />
      {p && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active users (7 days)" value={p.users_active_7d} note={`${p.sign_ins_7d} sign-ins`} />
        <Stat label="Errors" value={p.errors_24h} note={`last 24 h · ${p.errors_7d} in 7 days`} />
        <Stat label="Activity (7 days)" value={p.submissions_7d} note={`submissions · ${p.messages_7d} messages · ${p.ai_questions_7d} AI questions`} />
        <Stat label="Suspended accounts" value={p.suspended_accounts} />
      </div>}
      {data && <p className="rounded-2xl bg-ink/[0.03] p-3 text-sm">{data.website.note}</p>}
      <Card title="Recent errors"><ul className="text-sm">{data?.errors.map((e, i) => <li key={i} className="border-b border-ink/10 py-1">{when(e.at)} · {e.route} · {e.message.slice(0, 160)}</li>)}</ul>{data && !data.errors.length && <Empty>No errors.</Empty>}</Card>
      <Card title="Audit log"><ul className="text-sm">{audit.data?.entries.map((e, i) => <li key={i} className="border-b border-ink/10 py-1">{when(e.at)} · <b>{e.action}</b> · {e.actor_name ?? "system"}{e.target_type ? ` · ${e.target_type}` : ""}</li>)}</ul></Card>
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
  const progObj = PROGRAMMES.find((p) => p.slug === prog);
  const price = progObj?.price ?? 0;
  const fullOnly = !!progObj?.fullPaymentOnly;
  const effPlan = fullOnly ? "full" : plan;
  return (
    <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Student details">
        <form className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
          run(() => api("/api/app/admin/admit", { method: "POST", body: { ...f, plan: effPlan, paidParts: effPlan === "full" ? 1 : Number(f.paidParts), instructorId: f.instructorId || null } }),
            `${f.firstName} ${f.surname} was admitted. Their registration number, admission confirmation and sign-in link have been emailed to ${f.email}.`, () => form.reset());
        }}>
          <Field label="First name"><input name="firstName" required autoComplete="off" className={inputCls} /></Field>
          <Field label="Surname"><input name="surname" required autoComplete="off" className={inputCls} /></Field>
          <Field label="Email"><input name="email" type="email" required autoComplete="off" className={inputCls} /></Field>
          <Field label="Phone"><input name="phone" autoComplete="off" className={inputCls} /></Field>
          <Field label="Country"><input name="country" className={inputCls} /></Field>
          <Field label="Programme"><select name="programme" value={prog} onChange={(e) => setProg(e.target.value)} className={inputCls}>{PROGRAMMES.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
          <Field label="Payment plan">{fullOnly ? <p className="py-2.5 text-sm text-ink/75">Paid in full: {progObj?.name} is not offered in instalments.</p> : <select name="plan" value={plan} onChange={(e) => setPlan(e.target.value as "full" | "parts")} className={inputCls}><option value="full">Paid in full</option><option value="parts">Paying in 3 parts</option></select>}</Field>
          {effPlan === "parts" ? <Field label="Parts already paid"><select name="paidParts" className={inputCls}><option value="1">Part 1 (50%)</option><option value="2">Parts 1 and 2 (80%)</option><option value="3">All 3 parts</option></select></Field> : <div className="hidden sm:block" />}
          <Field label="Payment reference (bank or receipt)"><input name="paymentReference" placeholder="e.g. UBA transfer ref" className={inputCls} /></Field>
          <Field label="Instructor"><select name="instructorId" className={inputCls}><option value="">Assign later</option>{instructors.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3 border-t border-ink/[0.07] pt-4">
            <Btn type="submit" disabled={busy}>{busy ? "Admitting…" : "Admit student"}</Btn>
            <span className="text-sm text-ink/65">Catalogue price: {naira(price)}</span>
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
            <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo/[0.08] text-sm font-semibold text-indigo">{i + 1}</span><span>{t}</span></li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg bg-brand-orange/10 p-3 text-sm text-ink/70">Only admit a student once the payment is confirmed in the bank account. Students who pay online through the website are admitted automatically.</p>
      </Card>
    </div>
  );
}

// Turns rows into a CSV file and downloads it (built in the browser from data the admin can already see).
function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => { const t = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Ov = { students: number; active_students: number; instructors: number; active_instructors: number; enrolments: number; ongoing: number; completed: number; courses: number; awaiting_instructor: number; awaiting_timetable: number; unpaid_registrations_30d: number; paid_registrations_30d: number; pending_outcomes: number; programmes: number };
type Fin = { revenueNaira: number; payments: number; outstandingNaira: number; overdueNaira: number; oneTimePaid: number; instalmentOrders: number; awaitingBankConfirmation: number; unpaidCheckouts: number; byMonth: { month: string; naira: number; payments?: number }[] };
type Acad = { assignmentCompletionPct: number | null; avgAssignmentPct: number | null; avgQuizPct: number | null; avgAssessmentPct: number | null; lessonsCompleted: number; programmesCompleted: number; last30Days: { completed: number; missed: number; cancelled: number; attendancePct: number | null } };

function Reports() {
  const ov = useLoad<{ overview: Ov }>("/api/app/admin/overview");
  const fin = useLoad<{ finance: Fin }>("/api/app/admin/finance");
  const ac = useLoad<{ academics: Acad }>("/api/app/admin/academics");
  const { busy, msg, run } = useAction();
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v}%`);
  const o = ov.data?.overview, f = fin.data?.finance, a = ac.data?.academics;
  const rows: [string, [string, string][]][] = [
    ["Enrolment", o ? [["Students (active)", `${o.students} (${o.active_students})`], ["Instructors (active)", `${o.instructors} (${o.active_instructors})`], ["Enrolments ongoing", String(o.ongoing)], ["Programmes completed", String(o.completed)], ["Paid registrations, last 30 days", String(o.paid_registrations_30d)], ["Unpaid registrations, last 30 days", String(o.unpaid_registrations_30d)]] : []],
    ["Finance", f ? [["Revenue to date", naira(f.revenueNaira)], ["Payments recorded", String(f.payments)], ["Outstanding balances", naira(f.outstandingNaira)], ["Overdue", naira(f.overdueNaira)], ["Bank transfers awaiting confirmation", String(f.awaitingBankConfirmation)]] : []],
    ["Teaching and learning", a ? [["Classes held, last 30 days", String(a.last30Days.completed)], ["Classes missed, last 30 days", String(a.last30Days.missed)], ["Attendance, last 30 days", pct(a.last30Days.attendancePct)], ["Assignment completion", pct(a.assignmentCompletionPct)], ["Average assignment mark", pct(a.avgAssignmentPct)], ["Average quiz mark", pct(a.avgQuizPct)], ["Average assessment mark", pct(a.avgAssessmentPct)], ["Topics completed by students", String(a.lessonsCompleted)]] : []],
  ];
  const dl = (name: string, path: string, key: string) => run(async () => { const d = await api<Record<string, Record<string, unknown>[]>>(path); downloadCsv(name, d[key] ?? []); }, `${name}.csv downloaded.`);
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card title="Summary">
        {rows.map(([group, items]) => (
          <div key={group} className="mb-5 last:mb-0">
            <h3 className="mb-1 text-sm font-semibold text-ink/70">{group}</h3>
            <table className="w-full text-sm"><tbody className="divide-y divide-ink/10">{items.map(([k, v]) => <tr key={k}><th scope="row" className="py-2 pr-4 text-left font-normal text-ink/75">{k}</th><td className="py-2 text-right font-semibold tabular-nums">{v}</td></tr>)}</tbody></table>
          </div>
        ))}
        {!o && <Empty>Loading…</Empty>}
        {f && f.byMonth.length > 0 && <>
          <h3 className="mb-1 mt-6 text-sm font-semibold text-ink/70">Revenue by month</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-ink/60"><th className="py-2 font-medium">Month</th><th className="py-2 text-right font-medium">Received</th></tr></thead><tbody className="divide-y divide-ink/10">{f.byMonth.map((m) => <tr key={m.month}><td className="py-2">{m.month}</td><td className="py-2 text-right font-semibold tabular-nums">{naira(m.naira)}</td></tr>)}</tbody></table>
        </>}
      </Card>
      <Card title="Downloads (CSV)">
        <p className="mb-4 text-sm text-ink/70">Open in Excel or Google Sheets. Files contain personal data: store and share them carefully.</p>
        <ul className="space-y-2">
          {([["Enrolments", "/api/app/admin/enrolments", "enrolments"], ["Payments", "/api/app/admin/payments", "payments"], ["Orders", "/api/app/admin/orders", "orders"], ["Students", "/api/app/admin/users?role=student&limit=500", "users"], ["Instructors", "/api/app/admin/instructors", "instructors"]] as const).map(([n, path, key]) => (
            <li key={n} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 px-4 py-3 text-sm"><span className="font-semibold">{n}</span><Btn small kind="ghost" disabled={busy} onClick={() => dl(n.toLowerCase(), path, key)}>Download</Btn></li>
          ))}
        </ul>
        <Msg text={msg.text} kind={msg.kind} />
      </Card>
    </div>
  );
}

// The parts of the public website that are controlled from administration. Programme names, prices and page wording
// are part of the website itself and change with a site update, so they are listed but not editable here.
function WebsiteContent({ go }: { go: (t: Tab) => void }) {
  const adm = useLoad<{ programmes: Record<string, PublicStatus & { listed?: boolean }> }>("/api/admissions");
  const fac = useLoad<{ faculty: { id: string; fullName: string; programmes: string[] }[] }>("/api/faculty");
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Admission status on programme pages" action={<Btn small kind="ghost" onClick={() => go("admissions")}>Manage</Btn>}>
        <table className="w-full text-sm"><thead><tr className="text-left text-ink/60"><th className="py-2 font-medium">Programme</th><th className="py-2 font-medium">Shown to visitors</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{PROGRAMMES.map((p) => { const a = adm.data?.programmes?.[p.slug]; return <tr key={p.slug}><td className="py-2 pr-3">{p.name}</td><td className="py-2">{a ? (a.listed === false ? "Hidden from the website" : statusLabel(a).title) : "…"}</td></tr>; })}</tbody></table>
      </Card>
      <Card title="Faculty page" action={<Btn small kind="ghost" onClick={() => go("instructors")}>Manage</Btn>}>
        <p className="mb-3 text-sm text-ink/70">Only verified instructors who agreed to be listed appear on the public Faculty page.</p>
        {fac.data && fac.data.faculty.length === 0 && <Empty>No instructor profiles are published yet.</Empty>}
        <ul className="divide-y divide-ink/10 text-sm">{fac.data?.faculty.map((m) => <li key={m.id} className="flex items-center justify-between gap-3 py-2"><span className="font-semibold">{m.fullName}</span><span className="text-ink/60">{m.programmes.length} programme{m.programmes.length === 1 ? "" : "s"}</span></li>)}</ul>
      </Card>
      <Card title="Programme curricula" action={<Btn small kind="ghost" onClick={() => go("programmes")}>Manage</Btn>}>
        <p className="text-sm text-ink/70">Modules and topics you add under Programmes appear in students&apos; learning space and drive their progress.</p>
      </Card>
      <Card title="Fixed website content">
        <p className="text-sm text-ink/70">Programme names, descriptions, prices, the homepage and the legal pages are part of the website itself. They change through a website update, so a mistake cannot be published by accident from this dashboard.</p>
      </Card>
    </div>
  );
}

const TITLES: Record<Tab, [string, string?]> = {
  overview: ["Institutional overview", "Figures across the Academy, and what needs action."],
  students: ["Students", "Monitor progress and engagement, contact students, and manage accounts. Admit a student who paid outside the website from Admissions."],
  instructors: ["Instructors", "Verification of new instructors, and teaching activity."],
  programmes: ["Programmes", "Each programme's modules and topics, its investment in each currency, and the exchange rates used on the website."],
  admissions: ["Admissions", "Admit students, and set each programme's intake, capacity and the status shown on the website."],
  payments: ["Payments", "Payments received, balances outstanding, and every order."],
  records: ["Academic records", "Completion, marks and students needing attention."],
  allocation: ["Instructor allocation", "Assign instructors and fixed weekly class times to enrolments."],
  attendance: ["Attendance", "Class outcomes across the Academy."],
  assessments: ["Assessments", "Assignments, quizzes and assessments across the Academy."],
  materials: ["Learning materials", "Approve and publish materials submitted by instructors."],
  content: ["Website content", "What the public website shows that is controlled from here, and where to change it."],
  reports: ["Reports", "Figures from the Academy's records, with downloads for your own analysis."],
  notifications: ["Notifications", ""],
  security: ["Security and audit", "Accounts, sign-in access, email delivery, errors and the audit log."],
  owner: ["Owner console", "Platform owner only: set-up, administrator groups, permanent removals, approvals and the full audit log."],
};

// Which dashboard sections an administrator group sees. DISPLAY ONLY: the server checks every request (permissions.ts).
type Access = { role: string | null; owner?: boolean; areas: { read: string[]; write: string[] } } | null;
const TAB_AREAS: Partial<Record<Tab, string[]>> = {
  overview: ["overview"], students: ["records", "support", "academic"], instructors: ["faculty"], programmes: ["academic", "finance"],
  admissions: ["admissions"], payments: ["finance", "orders"], records: ["academic", "records"], allocation: ["academic"], attendance: ["academic"],
  assessments: ["academic"], materials: ["academic"], content: ["academic", "admissions"], reports: ["overview"], owner: ["owner"],
};
const mayRead = (access: Access, areas: string[]) => (areas.includes("owner") ? !!access?.owner : !access || areas.some((a) => access.areas.read.includes(a)));

export function AdminDashboard({ me, access = null }: { me: Me; access?: Access }) {
  const [tab, setTab] = useTab(TABS, "overview");
  const [admSeg, setAdmSeg] = useState<"admit" | "intake" | "calls" | "enquiries">("admit");
  const [paySeg, setPaySeg] = useState<"summary" | "orders">("summary");
  const [insSeg, setInsSeg] = useState<"verification" | "activity" | "accounts">("verification");
  const [stuSeg, setStuSeg] = useState<"monitoring" | "accounts">("monitoring");
  const [progSeg, setProgSeg] = useState<"content" | "investment">("content");
  const allNav: NavItem<Tab>[] = [
    { id: "overview", label: "Overview", icon: "home" },
    { id: "students", label: "Students", icon: "users" },
    { id: "instructors", label: "Instructors", icon: "check" },
    { id: "programmes", label: "Programmes", icon: "school" },
    { id: "admissions", label: "Admissions", icon: "plus" },
    { id: "payments", label: "Payments", icon: "cash" },
    { id: "records", label: "Academic records", icon: "book" },
    { id: "allocation", label: "Instructor allocation", icon: "calendar" },
    { id: "attendance", label: "Attendance", icon: "list" },
    { id: "assessments", label: "Assessments", icon: "clipboard" },
    { id: "materials", label: "Learning materials", icon: "folder" },
    { id: "content", label: "Website content", icon: "school" },
    { id: "reports", label: "Reports", icon: "chart" },
    { id: "notifications", label: "Notifications", icon: "bell" },
    { id: "security", label: "Security and audit", icon: "shield" },
    { id: "owner", label: "Owner console", icon: "shield" },
  ];
  const nav = allNav.filter((n) => !TAB_AREAS[n.id] || mayRead(access, TAB_AREAS[n.id]!));
  const [title, sub] = TITLES[tab];
  return (
    <AppShell me={me} nav={nav} tab={tab} setTab={setTab} primary={8}>
      {tab === "notifications" ? <NotificationsPage ids={TABS as unknown as string[]} onGo={(t) => setTab(t as Tab)} /> : <PageTitle title={title} sub={sub} action={tab === "students" ? <Btn small onClick={() => { setAdmSeg("admit"); setTab("admissions"); }}>Admit a student</Btn> : undefined} />}
      {tab === "overview" && <Overview go={setTab} />}
      {tab === "students" && <>
        <Segments value={stuSeg} onChange={setStuSeg} items={[["monitoring", "Monitoring"], ["accounts", "Accounts"]]} />
        {stuSeg === "monitoring" ? <Monitoring /> : <Users fixedRole="student" title="Students" addRoles={["student"]} access={access} meId={me.id} />}
      </>}
      {tab === "instructors" && <>
        <Segments value={insSeg} onChange={setInsSeg} items={[["verification", "Verification"], ["activity", "Teaching activity"], ["accounts", "Accounts"]]} />
        {insSeg === "verification" ? <RecruitmentAdmin /> : insSeg === "activity" ? <Instructors /> : <Users fixedRole="instructor" title="Instructor accounts" addRoles={["instructor"]} />}
      </>}
      {tab === "programmes" && <>
        <Segments value={progSeg} onChange={setProgSeg} items={[["content", "Modules and topics"], ["investment", "Investment and currency"]]} />
        {progSeg === "content" ? <Courses /> : <CurrencySettings />}
      </>}
      {tab === "admissions" && <>
        <Segments value={admSeg} onChange={setAdmSeg} items={[["admit", "Admit a student"], ["intake", "Intake and capacity"], ["calls", "Call requests"], ["enquiries", "Assistant enquiries"]]} />
        {admSeg === "admit" ? <Admit /> : admSeg === "intake" ? <AdmissionsAdmin /> : admSeg === "calls" ? <CallRequests /> : <AssistantEnquiries />}
      </>}
      {tab === "payments" && <>
        <Segments value={paySeg} onChange={setPaySeg} items={[["summary", "Payments and balances"], ["orders", "Orders"]]} />
        {paySeg === "summary" ? <Finance /> : <Orders />}
      </>}
      {tab === "records" && <Academics />}
      {tab === "allocation" && <Enrolments />}
      {tab === "attendance" && <Attendance />}
      {tab === "assessments" && <Assessments />}
      {tab === "materials" && <Materials />}
      {tab === "content" && <WebsiteContent go={setTab} />}
      {tab === "reports" && <Reports />}
      {tab === "owner" && <OwnerConsole />}
      {tab === "security" && <div className="space-y-6"><MfaSettings />{mayRead(access, ["people"]) && <Users title="All accounts" access={access} meId={me.id} />}{mayRead(access, ["security"]) && <><RetentionSettings /><Platform /></>}</div>}
    </AppShell>
  );
}

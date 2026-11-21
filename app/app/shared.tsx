"use client";
// Pieces used by more than one dashboard: messages, profile editor, progress.
import { useState } from "react";
import type { Me } from "./page";
import { api, Avatar, Bar, Btn, Card, Empty, Field, inputCls, Msg, upload, useAction, useLoad, when } from "./ui";

type Contact = { id: string; fullName: string; programme: string; unread: number; lastMessage: string | null };
export function Messages() {
  const { data, reload } = useLoad<{ contacts: Contact[]; unread: number }>("/api/app/messages");
  const [withId, setWith] = useState<string | null>(null);
  const conv = useLoad<{ with: { fullName: string }; messages: { id: string; mine: boolean; body: string; createdAt: string }[] }>(withId ? `/api/app/messages/${withId}` : null);
  const [text, setText] = useState("");
  const { busy, msg, run } = useAction();
  return (
    <Card title={`Messages${data?.unread ? ` (${data.unread} new)` : ""}`}>
      {!data?.contacts.length && <Empty>No one to message yet. Your instructor appears here once assigned.</Empty>}
      <div className="flex flex-wrap gap-2">
        {data?.contacts.map((c) => <button key={c.id} onClick={() => { setWith(c.id); setTimeout(reload, 500); }} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${withId === c.id ? "bg-indigo text-white" : "bg-ink/[0.03]"}`}>{c.fullName}{c.unread ? ` • ${c.unread}` : ""}</button>)}
      </div>
      {withId && (
        <div className="mt-3">
          <ul className="max-h-72 space-y-2 overflow-auto rounded-xl bg-ink/[0.03] p-3" aria-live="polite">
            {conv.data?.messages.map((m) => <li key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "ml-auto bg-indigo text-white" : "bg-white"}`}>{m.body}<span className={`block text-[10px] ${m.mine ? "text-white/70" : "text-ink/50"}`}>{when(m.createdAt)}</span></li>)}
            {!conv.data?.messages.length && <li className="text-sm text-ink/60">No messages yet. Say hello.</li>}
          </ul>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(() => api(`/api/app/messages/${withId}`, { method: "POST", body: { body: text } }), "", () => { setText(""); conv.reload(); }); }}>
            <label className="sr-only" htmlFor="msg">Message</label>
            <input id="msg" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} className={`${inputCls} mt-0`} placeholder="Write a message" />
            <Btn type="submit" disabled={busy}>Send</Btn>
          </form>
          <Msg text={msg.text} kind={msg.kind} />
        </div>
      )}
    </Card>
  );
}

export function ProfileEditor({ me, onSaved }: { me: Me; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const { busy, msg, run } = useAction();
  const teacher = me.role !== "student";
  return (
    <Card title="My profile" action={<Btn small kind="ghost" onClick={() => setOpen(!open)}>{open ? "Close" : "Edit"}</Btn>}>
      <div className="flex items-center gap-3">
        <Avatar src={me.photo} name={me.fullName} size={56} />
        <div className="text-sm"><b className="font-display text-base">{me.fullName}</b>{me.studentNo && <p>Student ID: {me.studentNo}</p>}<p className="text-ink/70">{me.email}{me.phone ? ` · ${me.phone}` : ""}</p></div>
      </div>
      {me.bio && <p className="mt-2 text-sm text-ink/75">{me.bio}</p>}
      {teacher && me.specialization && <p className="mt-1 text-sm"><b>Specialisation:</b> {me.specialization}</p>}
      {teacher && !!me.qualifications.length && <p className="mt-1 text-sm"><b>Qualifications:</b> {me.qualifications.join(", ")}</p>}
      {teacher && Object.entries(me.links).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer" className="mr-3 text-sm font-semibold text-brand-red underline">{k}</a>)}
      {open && (
        <form className="mt-3 space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          const body: Record<string, unknown> = { fullName: f.fullName, phone: f.phone, bio: f.bio };
          if (teacher) Object.assign(body, { specialization: f.specialization, qualifications: f.qualifications.split(",").map((s) => s.trim()).filter(Boolean), links: { linkedin: f.linkedin, portfolio: f.portfolio } });
          run(() => api("/api/me", { method: "PATCH", body }), "Saved.", onSaved);
        }}>
          <Field label="Full name"><input name="fullName" defaultValue={me.fullName} required className={inputCls} /></Field>
          <Field label="Phone"><input name="phone" defaultValue={me.phone ?? ""} className={inputCls} /></Field>
          <Field label="About me"><textarea name="bio" defaultValue={me.bio ?? ""} rows={3} className={inputCls} /></Field>
          {teacher && <>
            <Field label="Specialisation"><input name="specialization" defaultValue={me.specialization ?? ""} className={inputCls} /></Field>
            <Field label="Qualifications (comma-separated)"><input name="qualifications" defaultValue={me.qualifications.join(", ")} className={inputCls} /></Field>
            <Field label="LinkedIn (https://…)"><input name="linkedin" defaultValue={me.links.linkedin ?? ""} className={inputCls} /></Field>
            <Field label="Portfolio (https://…)"><input name="portfolio" defaultValue={me.links.portfolio ?? ""} className={inputCls} /></Field>
          </>}
          <Field label="Profile photo (png, jpg, webp, up to 3 MB)"><input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 text-sm" onChange={(e) => { const file = e.target.files?.[0]; if (file) run(() => upload("/api/me/photo", file), "Photo updated.", onSaved); }} /></Field>
          <Btn type="submit" disabled={busy}>Save</Btn>
          <Msg text={msg.text} kind={msg.kind} />
        </form>
      )}
    </Card>
  );
}

export type Progress = { enrolmentId: string; programmeName: string; overall: number; lessons: { done: number; total: number; pct: number | null }; assignments: { submitted: number; total: number; overdue: number; avgScorePct: number | null; pct: number | null };
  quizzes: { done: number; total: number; avgScorePct: number | null; pct: number | null }; assessments: { avgScorePct: number | null }; attendance: { attended: number; missed: number; pct: number | null }; needsAttention: string[] };
const pc = (v: number | null) => (v === null ? "n/a" : `${v}%`);
export function ProgressView({ p }: { p: Progress }) {
  return (
    <div className="space-y-2">
      <p className="font-display font-bold">{p.programmeName}: {p.overall}% overall</p>
      <Bar label={`Lessons (${p.lessons.done}/${p.lessons.total})`} pct={p.lessons.pct} />
      <Bar label={`Assignments submitted (${p.assignments.submitted}/${p.assignments.total})`} pct={p.assignments.pct} />
      <Bar label={`Quizzes completed (${p.quizzes.done}/${p.quizzes.total})`} pct={p.quizzes.pct} />
      <Bar label={`Attendance (${p.attendance.attended} attended, ${p.attendance.missed} missed)`} pct={p.attendance.pct} />
      <p className="text-xs text-ink/70">Average scores: assignments {pc(p.assignments.avgScorePct)}, quizzes {pc(p.quizzes.avgScorePct)}, assessments {pc(p.assessments.avgScorePct)}</p>
      {!!p.needsAttention.length && <p className="rounded-xl bg-brand-red/10 p-2 text-xs text-brand-red">Needs attention: {p.needsAttention.join(", ")}</p>}
    </div>
  );
}

// Materials: list, add (with optional file and AI text), approve (admins), delete. Instructors' additions wait for approval.
export function MaterialsManager({ admin, programmes }: { admin: boolean; programmes: { slug: string; name: string }[] }) {
  const { data, reload } = useLoad<{ resources: { id: string; programmeName: string; title: string; kind: string; approved: boolean; url: string | null; file: string | null; fileName: string | null; hasText: boolean }[] }>("/api/app/resources");
  const { busy, msg, run } = useAction();
  return (
    <Card title="Learning materials">
      <ul className="space-y-2 text-sm">{data?.resources.map((r) => (
        <li key={r.id} className="rounded-xl bg-ink/[0.03] p-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{r.title}</b> · {r.programmeName} · {r.kind}{r.hasText ? " · used by the assistant" : ""}{r.file ? <> · <a href={r.file} className="underline">{r.fileName}</a></> : null}</span>
            <span className="flex flex-wrap gap-1">{r.approved ? <span className="rounded-full bg-indigo px-2 py-0.5 text-xs font-bold text-white">approved</span> : admin ? <Btn small disabled={busy} onClick={() => run(() => api(`/api/app/resources/${r.id}`, { method: "PATCH", body: { approved: true } }), "Approved.", reload)}>Approve</Btn> : <span className="rounded-full bg-brand-orange/20 px-2 py-0.5 text-xs font-bold">awaiting approval</span>}
              <label className="cursor-pointer rounded-full border-2 border-indigo/30 px-3 py-1 text-xs font-semibold text-indigo">{r.file ? "Replace file" : "Attach file"}<input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => upload(`/api/app/resources/${r.id}/file`, f), "File attached.", reload); }} /></label>
              <Btn small kind="ghost" disabled={busy} onClick={() => { if (confirm("Delete this material?")) run(() => api(`/api/app/resources/${r.id}`, { method: "DELETE" }), "Deleted.", reload); }}>Delete</Btn></span></div>
        </li>
      ))}</ul>
      {data && !data.resources.length && <Empty>No materials yet.</Empty>}
      <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-brand-red">Add a material</summary>
        <form className="mt-2 space-y-3" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget; run(() => api("/api/app/resources", { method: "POST", body: f }), admin ? "Added." : "Added. An admin will approve it before students see it.", () => { form.reset(); reload(); }); }}>
          <Field label="Programme"><select name="programme" className={inputCls}>{programmes.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
          <Field label="Title"><input name="title" required className={inputCls} /></Field>
          <Field label="Type"><select name="kind" className={inputCls}><option>document</option><option>video</option><option>link</option><option>exercise</option></select></Field>
          <Field label="Link (https://…, optional)"><input name="url" className={inputCls} /></Field>
          <Field label="Text for the AI assistant (optional)"><textarea name="textContent" rows={4} className={inputCls} placeholder="Paste the key content so the assistant can use it" /></Field>
          <Btn type="submit" disabled={busy || !programmes.length}>Add</Btn>
          <p className="text-xs text-ink/60">Attach a file after adding (PDF, Office, zip or images, up to 25 MB).</p>
        </form>
      </details>
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

"use client";
// The weekly study checklist. Items backed by records (lesson, assignment, test, AI revision) are ticked only by the
// records themselves; the student ticks the rest, and instructors can add tasks. Past weeks are read-only.
import { useState } from "react";
import { api, Btn, Card, Empty, inputCls, Msg, useAction, useLoad } from "./ui";

export type WeekItem = { key: string; title: string; detail: string; source: "record" | "student" | "instructor"; done: boolean; notSet: boolean; completedAt: string | null; evidence: string | null; note: string | null; assignedBy: string | null };
export type Week = { enrolmentId: string; programme: string; programmeName: string; weekStart: string; current: boolean; classesAttended: number; items: WeekItem[]; done: number; total: number };

const weekLabel = (d: string) => `Week of ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`;
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

function Tick({ done, muted }: { done: boolean; muted?: boolean }) {
  return (
    <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${done ? "border-indigo bg-indigo text-white" : muted ? "border-dashed border-ink/25" : "border-ink/35 bg-white"}`}>
      {done && <svg viewBox="0 0 16 16" className="h-3 w-3"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
  );
}

function Items({ w, onToggle, onRemove, busy }: { w: Week; onToggle?: (key: string, done: boolean) => void; onRemove?: (key: string) => void; busy?: boolean }) {
  const pct = w.total ? Math.round((100 * w.done) / w.total) : 0;
  return (
    <>
      <div className="flex items-center justify-between gap-3 text-sm"><span className="text-ink/70">{w.done} of {w.total} done{w.classesAttended ? ` · ${w.classesAttended} class${w.classesAttended > 1 ? "es" : ""} attended` : ""}</span><b>{pct}%</b></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${w.programmeName} weekly checklist`}><div className="h-full rounded-full bg-indigo" style={{ width: `${pct}%` }} /></div>
      <ul className="mt-4 divide-y divide-ink/[0.07]">
        {w.items.map((i) => {
          const canTick = !!onToggle && w.current && i.source !== "record";
          const body = (
            <>
              <Tick done={i.done} muted={i.notSet} />
              <span className="min-w-0 flex-1">
                <span className={`block font-semibold ${i.notSet ? "text-ink/55" : ""}`}>{i.title}{i.source === "instructor" && <span className="ml-2 rounded-md bg-brand-orange/15 px-1.5 py-0.5 text-[11px] font-semibold text-ink">From {i.assignedBy ?? "your instructor"}</span>}</span>
                <span className="block text-sm text-ink/65">{i.evidence ?? i.detail}{i.note ? ` · “${i.note}”` : ""}</span>
              </span>
            </>
          );
          return (
            <li key={i.key} className="flex items-start gap-2 py-2.5">
              {canTick
                ? <button type="button" disabled={busy} onClick={() => onToggle!(i.key, !i.done)} aria-pressed={i.done} className="flex flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo disabled:opacity-60">{body}</button>
                : <div className="flex flex-1 items-start gap-3">{body}</div>}
              {onRemove && i.source === "instructor" && !i.done && w.current && <button type="button" onClick={() => onRemove(i.key)} className="text-sm font-semibold text-brand-red underline">Remove</button>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// Student dashboard: this week's checklist for each programme.
export function StudentWeekly() {
  const [week, setWeek] = useState<string | null>(null);
  const d = useLoad<{ weekStart: string; thisWeek: string; checklists: Week[] }>(`/api/app/student/weekly${week ? `?week=${week}` : ""}`);
  const { busy, msg, run } = useAction();
  if (d.error) return <Msg text={d.error} />;
  if (!d.data) return <Empty>Loading your weekly checklist…</Empty>;
  if (!d.data.checklists.length) return null;
  const ws = d.data.weekStart;
  const nav = (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => setWeek(shift(ws, -7))} className="rounded-md px-2 py-1 text-sm font-semibold text-indigo hover:bg-indigo/[0.06]" aria-label="Previous week">←</button>
      <button type="button" onClick={() => setWeek(null)} disabled={ws === d.data.thisWeek} className="rounded-md px-2 py-1 text-sm font-semibold text-indigo hover:bg-indigo/[0.06] disabled:text-ink/40">This week</button>
      <button type="button" onClick={() => setWeek(shift(ws, 7))} disabled={ws >= d.data.thisWeek} className="rounded-md px-2 py-1 text-sm font-semibold text-indigo hover:bg-indigo/[0.06] disabled:text-ink/30" aria-label="Next week">→</button>
    </div>
  );
  return (
    <Card title="Weekly study checklist" action={nav}>
      <p className="-mt-1 mb-4 text-sm text-ink/70">{weekLabel(ws)}. Your 10–20 hours of independent study, item by item. Lessons, assignments, tests and AI revision are recorded from your work; tick the rest yourself.{ws !== d.data.thisWeek && " Past weeks cannot be changed."}</p>
      <div className={`grid gap-6 ${d.data.checklists.length > 1 ? "xl:grid-cols-2" : ""}`}>
        {d.data.checklists.map((w) => (
          <div key={w.enrolmentId} className="min-w-0">
            {d.data!.checklists.length > 1 && <p className="mb-2 font-semibold">{w.programmeName}</p>}
            <Items w={w} busy={busy} onToggle={(key, done) => run(() => api("/api/app/student/weekly", { method: "POST", body: { enrolmentId: w.enrolmentId, key, done } }), "", d.reload)} />
          </div>
        ))}
      </div>
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

// Instructor (can add tasks) and admin (read-only): one student's checklist.
export function StaffWeekly({ enrolmentId, canAssign }: { enrolmentId: string; canAssign?: boolean }) {
  const [week, setWeek] = useState<string | null>(null);
  const d = useLoad<{ checklist: Week }>(`/api/app/weekly/${enrolmentId}${week ? `?week=${week}` : ""}`);
  const { busy, msg, run } = useAction();
  const [title, setTitle] = useState(""), [detail, setDetail] = useState("");
  const w = d.data?.checklist;
  return (
    <Card title="Weekly checklist" action={w && <div className="flex items-center gap-1">
      <button type="button" onClick={() => setWeek(shift(w.weekStart, -7))} className="rounded-md px-2 py-1 text-sm font-semibold text-indigo" aria-label="Previous week">←</button>
      <button type="button" onClick={() => setWeek(null)} disabled={w.current} className="rounded-md px-2 py-1 text-sm font-semibold text-indigo disabled:text-ink/40">This week</button>
    </div>}>
      {d.error && <Msg text={d.error} />}
      {!w ? <Empty>Loading…</Empty> : <>
        <p className="-mt-1 mb-3 text-sm text-ink/70">{weekLabel(w.weekStart)}</p>
        <Items w={w} busy={busy} onRemove={canAssign ? (key) => run(() => api(`/api/app/instructor/weekly/${enrolmentId}/tasks/${key.slice(5)}`, { method: "DELETE" }), "Task removed.", d.reload) : undefined} />
        {canAssign && w.current && (
          <form className="mt-4 grid gap-2 border-t border-ink/10 pt-4" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/app/instructor/weekly/${enrolmentId}/tasks`, { method: "POST", body: { title, detail } }), "Task added. The student has been notified.", () => { setTitle(""); setDetail(""); d.reload(); }); }}>
            <label className="text-sm font-semibold">Add a task for this week<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} required placeholder="e.g. Rebuild the pipeline from Thursday's class" className={inputCls} /></label>
            <label className="text-sm font-semibold">Details (optional)<textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={600} rows={2} className={inputCls} /></label>
            <div><Btn small type="submit" disabled={busy || !title.trim()}>Add task</Btn></div>
          </form>
        )}
      </>}
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}

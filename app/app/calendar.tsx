"use client";
// The academic calendar: an "Upcoming" list grouped by day, and a month grid. Events come from real records only
// (class sessions, assignment and assessment deadlines). All dates are shown in Lagos time (WAT).
import { useMemo, useState } from "react";
import { Icon } from "./shell";
import { Card, Empty } from "./ui";

export type CalEvent = { id: string; at: string; title: string; kind: "class" | "assignment" | "quiz" | "assessment"; meta?: string; status?: string; onOpen?: () => void };

const TZ = "Africa/Lagos";
const ymd = (iso: string | number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayTitle = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const KIND: Record<CalEvent["kind"], { label: string; dot: string; icon: string }> = {
  class: { label: "Live class", dot: "bg-indigo", icon: "play" },
  assignment: { label: "Assignment due", dot: "bg-brand-orange", icon: "clipboard" },
  quiz: { label: "Quiz due", dot: "bg-plum", icon: "check" },
  assessment: { label: "Assessment due", dot: "bg-brand-red", icon: "school" },
};
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function EventRow({ e }: { e: CalEvent }) {
  const k = KIND[e.kind];
  const body = (
    <>
      <span className="w-14 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-ink">{time(e.at)}</span>
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${k.dot}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{e.title}</span>
        <span className="block text-sm text-ink/70">{k.label}{e.meta ? ` · ${e.meta}` : ""}{e.status ? ` · ${e.status}` : ""}</span>
      </span>
    </>
  );
  return e.onOpen
    ? <li><button onClick={e.onOpen} className="flex w-full gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-ink/[0.03]">{body}</button></li>
    : <li className="flex gap-3 px-2 py-2.5">{body}</li>;
}

export function UpcomingList({ events, now, limit, empty = "Nothing scheduled." }: { events: CalEvent[]; now: number; limit?: number; empty?: string }) {
  const list = events.filter((e) => now > 0 && Date.parse(e.at) >= now - 60 * 60_000).sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit);
  const days = list.reduce<[string, CalEvent[]][]>((acc, e) => {
    const k = ymd(e.at);
    const last = acc[acc.length - 1];
    if (last && last[0] === k) last[1].push(e); else acc.push([k, [e]]);
    return acc;
  }, []);
  if (!list.length) return <Empty>{empty}</Empty>;
  return (
    <div className="space-y-3">
      {days.map(([k, es]) => (
        <div key={k}>
          <p className="border-b border-ink/10 pb-1 text-sm font-semibold text-ink/75">{k === ymd(now) ? "Today" : dayTitle(k)}</p>
          <ul className="mt-1">{es.map((e) => <EventRow key={e.id} e={e} />)}</ul>
        </div>
      ))}
    </div>
  );
}

function Month({ events, now }: { events: CalEvent[]; now: number }) {
  const today = ymd(now);
  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [picked, setPicked] = useState<string>(today);
  const byDay = useMemo(() => events.reduce<Record<string, CalEvent[]>>((m, e) => { (m[ymd(e.at)] ??= []).push(e); return m; }, {}), [events]);
  const [y, m] = cursor.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${cursor}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (d: number) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); setCursor(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`); };
  const label = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const sel = byDay[picked] ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => shift(-1)} aria-label="Previous month" className="grid h-10 w-10 place-items-center rounded-lg border border-ink/15 hover:border-indigo hover:text-indigo"><Icon name="left" /></button>
          <p className="font-display text-lg font-semibold" aria-live="polite">{label}</p>
          <button onClick={() => shift(1)} aria-label="Next month" className="grid h-10 w-10 place-items-center rounded-lg border border-ink/15 hover:border-indigo hover:text-indigo"><Icon name="right" /></button>
        </div>
        <div role="grid" aria-label={label} className="grid grid-cols-7 overflow-hidden rounded-lg border border-ink/10 text-sm">
          {WEEK.map((d) => <div key={d} role="columnheader" className="border-b border-ink/10 bg-ink/[0.03] py-2 text-center font-semibold text-ink/75">{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={`x${i}`} className="min-h-14 border-b border-r border-ink/[0.06] bg-ink/[0.015] sm:min-h-20" />;
            const es = byDay[d] ?? [];
            const isToday = d === today, isPicked = d === picked;
            return (
              <button key={d} role="gridcell" aria-selected={isPicked} aria-label={`${dayTitle(d)}${es.length ? `, ${es.length} event${es.length > 1 ? "s" : ""}` : ""}`} onClick={() => setPicked(d)}
                className={`min-h-14 border-b border-r border-ink/[0.06] p-1.5 text-left align-top transition sm:min-h-20 ${isPicked ? "bg-indigo/[0.07] ring-2 ring-inset ring-indigo" : "hover:bg-ink/[0.03]"}`}>
                <span className={`inline-grid h-7 w-7 place-items-center rounded-full text-sm ${isToday ? "bg-indigo font-semibold text-white" : "text-ink"}`}>{Number(d.slice(8))}</span>
                <span className="mt-1 flex flex-wrap gap-1">{es.slice(0, 4).map((e) => <span key={e.id} className={`h-2 w-2 rounded-full ${KIND[e.kind].dot}`} aria-hidden="true" />)}</span>
                <span className="hidden truncate text-xs text-ink/75 sm:block">{es[0] ? es[0].title : ""}</span>
              </button>
            );
          })}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/75">{Object.values(KIND).map((k) => <li key={k.label} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${k.dot}`} aria-hidden="true" />{k.label}</li>)}</ul>
      </div>
      <div>
        <p className="font-display text-base font-semibold">{picked === today ? "Today" : dayTitle(picked)}</p>
        {sel.length ? <ul className="mt-2">{[...sel].sort((a, b) => a.at.localeCompare(b.at)).map((e) => <EventRow key={e.id} e={e} />)}</ul> : <p className="mt-2 text-[0.95rem] text-ink/70">Nothing on this day.</p>}
      </div>
    </div>
  );
}

export function AcademicCalendar({ events, now, title = "Calendar" }: { events: CalEvent[]; now: number; title?: string }) {
  const [view, setView] = useState<"upcoming" | "month">("upcoming");
  return (
    <Card title={title} action={
      <div role="tablist" aria-label="Calendar view" className="inline-flex rounded-lg border border-ink/15 p-0.5">
        {(["upcoming", "month"] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === v ? "bg-indigo text-white" : "text-ink/75 hover:text-ink"}`}>{v === "upcoming" ? "Upcoming events" : "Month"}</button>)}
      </div>}>
      {view === "upcoming" ? <UpcomingList events={events} now={now} empty="There are no upcoming events." /> : now > 0 ? <Month events={events} now={now} /> : null}
    </Card>
  );
}

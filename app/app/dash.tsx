"use client";
// Shared dashboard building blocks (Institutional Dashboard stage): the welcome section, statistic cards, progress ring,
// month calendar, attention list, activity feed and the "not yet available" state. Every figure they show is passed in
// from a real API response; when there is nothing to show they say so. Nothing here invents data.
import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "./shell";
import { useNow } from "./ui";

const TZ = "Africa/Lagos";
export const lagosHour = (now: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date(now)));
export const greeting = (now: number) => { const h = lagosHour(now); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;
export const todayLabel = (now: number) => new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });

// The welcome section: greeting (or a given title), the person's context, optional actions and an optional figure beside it.
export function WelcomeHero({ name, title, sub, eyebrow, actions, aside }: { name: string; title?: ReactNode; sub?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; aside?: ReactNode }) {
  const now = useNow();
  return (
    <section className="mb-6 grid gap-5 rounded-2xl border border-ink/[0.07] bg-white p-6 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center" data-dashboard-hero>
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-semibold text-brand-orange">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-ink sm:text-[2.1rem]">
          {title ?? <>{now ? greeting(now) : "Welcome"}, <span className="text-indigo">{firstName(name)}</span></>}
        </h1>
        {sub && <div className="mt-2 max-w-2xl text-[0.95rem] text-ink/70">{sub}</div>}
        {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
      </div>
      {aside && <div className="w-fit max-w-full">{aside}</div>}
    </section>
  );
}

// A statistic card. `value` must come from data; pass null while loading or when unavailable (shows a dash).
export function StatCard({ icon, label, value, note, tone = "plain", onClick }: {
  icon: string; label: string; value: ReactNode | null; note?: ReactNode; tone?: "plain" | "indigo" | "orange" | "alert"; onClick?: () => void;
}) {
  const tile = tone === "indigo" ? "bg-indigo text-white" : tone === "orange" ? "bg-brand-orange/20 text-ink" : tone === "alert" ? "bg-brand-red/10 text-brand-red" : "bg-ink/[0.03] text-indigo";
  const inner = (
    <>
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tile}`}><Icon name={icon} className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="block font-display text-[1.6rem] font-semibold leading-none tabular-nums text-ink">{value ?? "–"}</span>
        <span className="mt-1.5 block text-sm font-medium text-ink/70">{label}</span>
        {note && <span className="mt-0.5 block text-xs text-ink/55">{note}</span>}
      </span>
    </>
  );
  const cls = "flex w-full items-center gap-4 rounded-2xl border border-ink/[0.07] bg-white p-4 text-left sm:p-5";
  return onClick
    ? <button onClick={onClick} className={`${cls} transition hover:border-indigo/30 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-indigo`}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}
export const StatGrid = ({ children }: { children: ReactNode }) => <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-stat-grid>{children}</div>;

// A circular progress indicator. pct null = not enough data yet (shown as such, never as 0%).
export function ProgressRing({ pct, label, sub, size = 132 }: { pct: number | null; label: string; sub?: ReactNode; size?: number }) {
  const r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <figure className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={pct === null ? `${label}: not available yet` : `${label}: ${v}%`} className="shrink-0">
        <circle cx="60" cy="60" r={r} fill="white" stroke="currentColor" strokeWidth="10" className="text-ink/10" />
        {v > 0 && <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" className="text-brand-orange"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 60 60)" />}
        <text x="60" y="66" textAnchor="middle" className="fill-ink font-display text-[22px] font-semibold">{pct === null ? "–" : `${v}%`}</text>
      </svg>
      <figcaption><span className="block font-display font-semibold text-ink">{label}</span>{sub && <span className="block text-sm text-ink/65">{sub}</span>}</figcaption>
    </figure>
  );
}

// A titled panel, the standard dashboard surface.
export function Panel({ title, action, children, className = "" }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-ink/[0.07] bg-white p-5 sm:p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-[1.05rem] font-semibold text-ink">{title}</h2>{action}</div>
      {children}
    </section>
  );
}
export const LinkBtn = ({ children, onClick }: { children: ReactNode; onClick: () => void }) =>
  <button onClick={onClick} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo hover:underline">{children}<Icon name="right" className="h-4 w-4" /></button>;

// "Needs attention": counts from real records, each opening the section where it is handled.
export function AttentionList({ items, empty = "Nothing needs attention right now." }: { items: { label: string; count: number | null; onOpen?: () => void; tone?: "orange" | "red" }[]; empty?: string }) {
  const shown = items.filter((i) => i.count !== null);
  if (!shown.length) return <p className="text-[0.95rem] text-ink/70">{empty}</p>;
  return (
    <ul className="divide-y divide-ink/[0.06]">
      {shown.map((i) => (
        <li key={i.label} className="flex items-center justify-between gap-3 py-3">
          <span className="flex min-w-0 items-center gap-3 text-[0.95rem]">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${i.count ? (i.tone === "red" ? "bg-brand-red" : "bg-brand-orange") : "bg-ink/15"}`} aria-hidden="true" />
            <span className="truncate">{i.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <b className="font-display tabular-nums">{i.count}</b>
            {!!i.count && i.onOpen && <button onClick={i.onOpen} className="min-h-8 rounded-lg border border-ink/15 px-3 text-sm font-semibold hover:border-indigo hover:text-indigo">Open</button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// A compact feed of dated items (notifications, audit events, messages).
export function ActivityFeed({ items, empty }: { items: { id: string; title: ReactNode; body?: ReactNode; at: string; unread?: boolean; onOpen?: () => void }[]; empty: string }) {
  if (!items.length) return <p className="text-[0.95rem] text-ink/70">{empty}</p>;
  const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return (
    <ul className="space-y-1">
      {items.map((i) => {
        const body = (
          <>
            <span className={`mt-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${i.unread ? "bg-indigo text-white" : "bg-ink/[0.03] text-indigo"}`}><Icon name="bell" className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{i.title}{i.unread && <span className="sr-only"> (unread)</span>}</span>
              {i.body && <span className="block truncate text-sm text-ink/70">{i.body}</span>}
              <span className="block text-xs text-ink/55">{time(i.at)}</span>
            </span>
          </>
        );
        return <li key={i.id}>{i.onOpen
          ? <button onClick={i.onOpen} className="flex w-full gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-ink/[0.03]">{body}</button>
          : <div className="flex gap-3 px-2 py-2">{body}</div>}</li>;
      })}
    </ul>
  );
}

// A month calendar. Dates with real events (classes, deadlines) are marked; months can be browsed.
export function MiniCalendar({ events, onPick }: { events: { at: string }[]; onPick?: (dayKey: string) => void }) {
  const now = useNow();
  const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = now ? ymd(new Date(now)) : "";
  const [offset, setOffset] = useState(0);
  const marked = useMemo(() => new Set(events.map((e) => ymd(new Date(e.at)))), [events]);
  if (!now) return null;
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const title = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const key = (d: number) => `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <b className="font-display text-ink">{title}</b>
        <span className="flex gap-1">
          <button onClick={() => setOffset(offset - 1)} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-lg border border-ink/10 hover:border-indigo hover:text-indigo"><Icon name="left" className="h-4 w-4" /></button>
          <button onClick={() => setOffset(offset + 1)} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-lg border border-ink/10 hover:border-indigo hover:text-indigo"><Icon name="right" className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-ink/50">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1 text-center text-sm">
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const k = key(i + 1), has = marked.has(k), isToday = k === today;
          const cls = `relative grid h-9 place-items-center rounded-lg tabular-nums ${isToday ? "bg-indigo font-semibold text-white" : has ? "bg-brand-orange/15 font-semibold text-ink" : "text-ink/75"}`;
          return onPick && has
            ? <button key={k} onClick={() => onPick(k)} className={`${cls} hover:ring-1 hover:ring-indigo`} aria-label={`${k}: has scheduled items`}>{i + 1}</button>
            : <span key={k} className={cls}>{i + 1}{has && !isToday && <span className="sr-only"> (scheduled)</span>}</span>;
        })}
      </div>
    </div>
  );
}

// For a capability that does not exist yet: says so plainly. No figures, no buttons that do nothing.
export function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink/20 bg-ink/[0.03] p-4" data-unavailable>
      <p className="flex items-center gap-2 font-semibold text-ink"><span className="rounded-md bg-ink/10 px-2 py-0.5 text-xs font-semibold text-ink/70">Not available yet</span>{title}</p>
      <div className="mt-1.5 text-sm text-ink/70">{children}</div>
    </div>
  );
}

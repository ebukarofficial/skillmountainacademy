"use client";
import { PORTALS } from "./portals";
// The signed-in application frame, modelled on an academic learning environment: a compact white header (logo,
// context, calendar, messages, notifications, profile), a brand-colour navigation bar, and a white content area.
// On phones the navigation becomes a drawer. Each dashboard passes its own sections; the server decides the role.
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import logo from "@/assets/sma-logo.png";
import { api, Avatar, goTo, useLoad, VerifiedBadge, when } from "./ui";
import type { Me } from "./page";

const PATHS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  book: "M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 1 2-2h13v3H6a2 2 0 0 1-2-1z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  chat: "M4 5h16v11H8l-4 4z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  check: "M4 12l5 5L20 6",
  cash: "M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v6M18 9v6",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  clipboard: "M9 4h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 13l2 2 4-4",
  school: "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5",
  plus: "M12 5v14M5 12h14",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  logout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H4",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  down: "M6 9l6 6 6-6",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  table: "M3 5h18v14H3zM3 10h18M3 15h18M9 5v14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  play: "M8 5v14l11-7z",
};
export function Icon({ name, className = "h-[18px] w-[18px]" }: { name: keyof typeof PATHS | string; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={PATHS[name] ?? PATHS.home} /></svg>;
}

export type NavItem<T extends string> = { id: T; label: string; icon: string; badge?: number };
type Note = { id: string; kind: string; title: string; body: string | null; created_at: string; read_at: string | null; link: string | null; priority?: string };

// Where a notice leads: the first of these sections that the signed-in role actually has.
const TARGETS: [RegExp, string[]][] = [
  [/^assignment\./, ["assignments", "coursework", "marking"]], [/^quiz\./, ["assessments", "coursework", "marking"]], [/^message/, ["messages"]],
  [/^(meet|session|reminder|timetable)\./, ["calendar", "sessions", "classes"]], [/^attendance\./, ["attendance", "sessions"]],
  [/^student\.assigned/, ["students"]], [/^instructor\.assigned/, ["home", "overview"]], [/^payment/, ["profile", "payments"]],
  [/^programme\.completed/, ["progress", "programme"]], [/^recruitment\./, ["instructors", "recruitment"]], [/^verification\./, ["profile"]],
];
export const targetOf = (kind: string, ids: string[]) => TARGETS.find(([re]) => re.test(kind))?.[1].find((t) => ids.includes(t)) ?? null;

export function useNotifications() {
  const r = useLoad<{ notifications: Note[]; unread: number }>("/api/app/notifications");
  const { reload } = r;
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]);
  return r;
}
export type { Note };

function Notifications({ onOpen, onAll }: { onOpen: (n: Note) => void; onAll: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const { data, reload } = useNotifications();
  const list = [...(data?.notifications ?? [])].sort((a, b) => Number(!!a.read_at) - Number(!!b.read_at) || Number(b.priority === "urgent") - Number(a.priority === "urgent")).slice(0, 12);
  const openOne = async (n: Note) => {
    if (!n.read_at) await api("/api/app/notifications/read", { method: "POST", body: { ids: [n.id] } }).catch(() => undefined);
    reload(); setOpen(false); onOpen(n);
  };
  return (
    <div className="relative">
      <button aria-expanded={open} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`} onClick={() => setOpen(!open)} className={`relative grid h-10 w-10 place-items-center rounded-lg transition hover:bg-ink/5 ${open ? "text-indigo" : "text-ink/70 hover:text-ink"}`}>
        <Icon name="bell" className="h-[22px] w-[22px]" />
        {!!data?.unread && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-red px-1 text-[10px] font-bold text-white">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(26rem,94vw)] overflow-hidden rounded-xl border border-ink/10 bg-white shadow-xl shadow-ink/10">
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
            <b className="font-display text-sm">Notifications</b>
            {!!data?.unread && <button className="text-sm font-semibold text-indigo hover:underline" onClick={() => api("/api/app/notifications/read", { method: "POST", body: { all: true } }).then(reload)}>Mark all as read</button>}
          </div>
          <ul className="max-h-[26rem] divide-y divide-ink/[0.07] overflow-auto">
            {list.map((n) => (
              <li key={n.id}>
                <button onClick={() => openOne(n)} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-ink/[0.03] ${n.read_at ? "" : "bg-indigo/[0.035]"}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : n.priority === "urgent" ? "bg-brand-red" : "bg-indigo"}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-indigo">{n.title}{!n.read_at && <span className="sr-only"> (unread)</span>}</span>
                    {n.body && <span className="mt-0.5 block text-sm leading-snug text-ink/70">{n.body}</span>}
                    <span className="mt-1 block text-xs text-ink/55">{n.priority === "urgent" && !n.read_at ? "Urgent · " : ""}{when(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
            {data && !list.length && <li className="px-4 py-8 text-center text-sm text-ink/60">You are all caught up.</li>}
          </ul>
          {onAll && <button onClick={() => { setOpen(false); onAll(); }} className="block w-full border-t border-ink/10 px-4 py-3 text-center text-sm font-semibold text-indigo hover:bg-ink/[0.03]">View all notifications</button>}
        </div>
      )}
    </div>
  );
}

const CONTEXT = { student: "Learning space", instructor: "Faculty workspace", admin: "Administration" } as const;

export function AppShell<T extends string>({ me, nav, tab, setTab, children, context, primary = 8 }: {
  me: Me; nav: NavItem<T>[]; tab: T; setTab: (t: T) => void; children: ReactNode;
  context?: string; // shown beside the logo (a student's programme, for example)
  primary?: number; // how many sections show in the bar before the rest go under "More"
}) {
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  async function signOut() { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); goTo(me.role === "admin" ? PORTALS.admin : me.role === "instructor" ? PORTALS.instructor : PORTALS.student); }
  const ids = nav.map((n) => n.id as string);
  const has = (id: string) => ids.includes(id);
  const go = (t: T) => { setTab(t); setDrawer(false); setMore(false); setMenu(false); window.scrollTo({ top: 0 }); };
  const openNotice = (n: Note) => {
    if (n.link && /^https:\/\/meet\.google\.com\//.test(n.link)) { window.open(n.link, "_blank", "noopener"); return; }
    const t = targetOf(n.kind, ids);
    if (t) go(t as T);
  };
  const number = me.role === "student" ? me.studentNo : me.staffNo;
  const shown = nav.slice(0, primary), rest = nav.slice(primary);
  const restActive = rest.some((n) => n.id === tab);
  const quick = (id: string, icon: string, label: string) => has(id) && (
    <button onClick={() => go(id as T)} aria-label={label} title={label} className={`relative hidden h-10 w-10 place-items-center rounded-lg transition hover:bg-ink/5 sm:grid ${tab === id ? "text-indigo" : "text-ink/70 hover:text-ink"}`}>
      <Icon name={icon} className="h-[22px] w-[22px]" />
      {!!nav.find((n) => n.id === id)?.badge && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-brand-orange ring-2 ring-white" aria-hidden="true" />}
    </button>
  );
  const item = (n: NavItem<T>, mobile = false) => (
    <button key={n.id} onClick={() => go(n.id)} aria-current={tab === n.id ? "page" : undefined}
      className={mobile
        ? `flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[0.95rem] font-medium ${tab === n.id ? "bg-indigo/[0.07] font-semibold text-indigo" : "text-ink/80 hover:bg-ink/[0.04]"}`
        : `relative flex shrink-0 items-center gap-1.5 px-3.5 py-3.5 text-[0.95rem] font-medium transition ${tab === n.id ? "text-white" : "text-white/80 hover:text-white"}`}>
      {mobile && <Icon name={n.icon} />}
      <span>{n.label}</span>
      {!!n.badge && <span className={`rounded-full px-1.5 text-[11px] font-bold ${mobile ? "bg-indigo text-white" : "bg-brand-orange text-ink"}`}>{n.badge}<span className="sr-only"> new</span></span>}
      {!mobile && tab === n.id && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-brand-orange" aria-hidden="true" />}
    </button>
  );
  return (
    <div className="min-h-screen overflow-x-clip bg-ink/[0.03]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink/70 hover:bg-ink/5 lg:hidden" aria-label="Open menu" onClick={() => setDrawer(true)}><Icon name="menu" className="h-6 w-6" /></button>
            <button onClick={() => go(nav[0].id)} aria-label="Home" className="shrink-0"><Image src={logo} alt="Skill Mountain Academy" unoptimized className="h-9 w-auto" /></button>
            <span className="hidden h-7 w-px bg-ink/15 sm:block" aria-hidden="true" />
            <p className="hidden truncate font-display text-base font-semibold text-ink sm:block">{context ?? CONTEXT[me.role]}</p>
          </div>
          <div className="flex items-center gap-1">
            {quick("calendar", "calendar", "Calendar")}
            {quick("messages", "mail", "Messages")}
            <Notifications onOpen={openNotice} onAll={has("notifications") ? () => go("notifications" as T) : null} />
            <span className="mx-1 hidden h-7 w-px bg-ink/15 sm:block" aria-hidden="true" />
            <div className="relative">
              <button onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Account menu" className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition hover:bg-ink/5">
                <Avatar src={me.photo} name={me.fullName} size={36} />
                <span className="hidden items-center gap-1 text-sm font-semibold text-ink md:flex">{me.fullName}{me.verified && <VerifiedBadge />}</span>
                <Icon name="down" className="hidden h-4 w-4 text-ink/50 md:block" />
              </button>
              {menu && (
                <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-ink/10 bg-white shadow-xl shadow-ink/10">
                  <div className="border-b border-ink/10 px-4 py-3 text-sm"><p className="font-semibold">{me.fullName}</p><p className="truncate text-ink/65">{me.email}</p>{number && <p className="mt-1 text-ink/65">{number}</p>}</div>
                  {has("profile") && <button onClick={() => go("profile" as T)} className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-ink/[0.04]"><Icon name="user" /> My profile</button>}
                  <button onClick={signOut} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-brand-red hover:bg-brand-red/[0.05]"><Icon name="logout" /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <nav aria-label="Sections" className="hidden bg-indigo lg:block">
        <div className="mx-auto flex max-w-7xl items-stretch px-3">
          {shown.map((n) => item(n))}
          {rest.length > 0 && (
            <div className="relative">
              <button onClick={() => setMore(!more)} aria-expanded={more} className={`relative flex h-full items-center gap-1 px-3.5 text-[0.95rem] font-medium ${restActive ? "text-white" : "text-white/80 hover:text-white"}`}>
                {restActive ? nav.find((n) => n.id === tab)?.label : "More"} <Icon name="down" className="h-4 w-4" />
                {restActive && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-brand-orange" aria-hidden="true" />}
              </button>
              {more && (
                <div className="absolute left-0 z-50 mt-0 w-64 overflow-hidden rounded-b-xl border border-ink/10 bg-white py-1 shadow-xl shadow-ink/10">
                  {rest.map((n) => item(n, true))}
                </div>
              )}
            </div>
          )}
        </div>
      </nav>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="relative flex h-full w-80 max-w-[88vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
              <Image src={logo} alt="Skill Mountain Academy" unoptimized className="h-8 w-auto" />
              <button className="grid h-10 w-10 place-items-center rounded-lg text-ink/70 hover:bg-ink/5" aria-label="Close menu" onClick={() => setDrawer(false)}><Icon name="close" /></button>
            </div>
            <div className="border-b border-ink/10 px-4 py-3 text-sm"><p className="font-semibold">{me.fullName}</p><p className="text-ink/65">{context ?? CONTEXT[me.role]}{number ? ` · ${number}` : ""}</p></div>
            <nav aria-label="Sections" className="flex-1 space-y-0.5 overflow-auto p-2">{nav.map((n) => item(n, true))}</nav>
            <button onClick={signOut} className="flex items-center gap-2 border-t border-ink/10 px-5 py-4 text-sm font-semibold text-brand-red"><Icon name="logout" /> Sign out</button>
          </aside>
        </div>
      )}
      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

// Every notification, newest first; unread ones are marked, and each opens the activity it refers to.
export function NotificationsPage({ ids, onGo }: { ids: string[]; onGo: (tab: string) => void }) {
  const { data, reload } = useNotifications();
  const [only, setOnly] = useState(false);
  const list = (data?.notifications ?? []).filter((n) => !only || !n.read_at);
  const read = (id: string) => api("/api/app/notifications/read", { method: "POST", body: { ids: [id] } }).catch(() => undefined);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="font-display text-2xl font-semibold text-ink sm:text-[1.75rem]">Notifications</h1><p className="mt-1 text-[0.95rem] text-ink/70">Class changes, coursework, feedback, messages and payments.</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setOnly(!only)} className="min-h-9 rounded-lg border border-ink/20 px-3 text-sm font-semibold hover:border-indigo hover:text-indigo">{only ? "Show all" : "Show unread only"}</button>
          {!!data?.unread && <button onClick={() => api("/api/app/notifications/read", { method: "POST", body: { all: true } }).then(reload)} className="min-h-9 rounded-lg bg-indigo px-3 text-sm font-semibold text-white hover:bg-navy">Mark all as read</button>}
        </div>
      </div>
      <section className="rounded-xl border border-ink/10 bg-white p-5 sm:p-6">
        {list.length ? <ul className="divide-y divide-ink/[0.07]">{list.map((n) => {
          const t = targetOf(n.kind, ids);
          return (
            <li key={n.id} className="flex flex-wrap items-start gap-3 py-3">
              <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? "border border-ink/30" : n.priority === "urgent" ? "bg-brand-red" : "bg-indigo"}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{n.title} <span className="text-sm font-normal text-ink/70">{n.read_at ? "· read" : n.priority === "urgent" ? "· urgent, unread" : "· unread"}</span></p>
                {n.body && <p className="text-[0.95rem] text-ink/75">{n.body}</p>}
                <p className="text-sm text-ink/65">{when(n.created_at)}</p>
              </div>
              <div className="flex gap-2">
                {!n.read_at && <button onClick={() => read(n.id).then(reload)} className="min-h-9 rounded-lg border border-ink/20 px-3 text-sm font-semibold hover:border-indigo hover:text-indigo">Mark read</button>}
                {t && <button onClick={async () => { if (!n.read_at) await read(n.id); reload(); onGo(t); }} className="min-h-9 rounded-lg bg-indigo px-3 text-sm font-semibold text-white hover:bg-navy">Open</button>}
              </div>
            </li>
          );
        })}</ul> : <p className="text-[0.95rem] text-ink/70">{only ? "No unread notifications." : "You have no notifications yet."}</p>}
      </section>
    </>
  );
}

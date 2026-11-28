"use client";
import { PORTALS } from "./portals";
// The signed-in application frame: see AppShell below. Each dashboard passes its own sections; the server decides
// the role and checks every request.
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import logo from "@/assets/sma-logo.png";
import { api, Avatar, goTo, useLoad, useNow, VerifiedBadge, when } from "./ui";
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
const ROLE = { student: "Student", instructor: "Faculty", admin: "Administrator" } as const;

// The signed-in application frame (Institutional Dashboard stage): a white sidebar with the logo, the person's profile,
// the sections of their role and a help link; an ivory workspace with a slim header (where you are, today's date,
// calendar, messages, notifications and the account menu). On tablets and phones the sidebar becomes a drawer.
// The sections are decided by each dashboard from the server's view of the person; the server checks every request.
export function AppShell<T extends string>({ me, nav, tab, setTab, children, context, roleLabel }: {
  me: Me; nav: NavItem<T>[]; tab: T; setTab: (t: T) => void; children: ReactNode;
  context?: string; // shown under the name (a student's programme, for example)
  roleLabel?: string; // the person's role as the server reports it (an administrator's group, "Owner")
  primary?: number; // kept for compatibility: every section is listed in the sidebar
}) {
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const now = useNow(60_000);
  async function signOut() { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); goTo(me.role === "admin" ? PORTALS.admin : me.role === "instructor" ? PORTALS.instructor : PORTALS.student); }
  async function signOutAll() { if (!confirm("Sign out of every device, including this one?")) return; await api("/api/auth/logout-all", { method: "POST" }).catch(() => undefined); goTo(me.role === "admin" ? PORTALS.admin : me.role === "instructor" ? PORTALS.instructor : PORTALS.student); }
  const ids = nav.map((n) => n.id as string);
  const has = (id: string) => ids.includes(id);
  const go = (t: T) => { setTab(t); setDrawer(false); setMenu(false); window.scrollTo({ top: 0 }); };
  const openNotice = (n: Note) => {
    if (n.link && /^https:\/\/meet\.google\.com\//.test(n.link)) { window.open(n.link, "_blank", "noopener"); return; }
    const t = targetOf(n.kind, ids);
    if (t) go(t as T);
  };
  const number = me.role === "student" ? me.studentNo : me.staffNo;
  const current = nav.find((n) => n.id === tab);
  const where = context ?? CONTEXT[me.role];
  const quick = (id: string, icon: string, label: string) => has(id) && (
    <button onClick={() => go(id as T)} aria-label={label} title={label} className={`relative hidden h-10 w-10 place-items-center rounded-xl transition hover:bg-white sm:grid ${tab === id ? "bg-white text-indigo" : "text-ink/70 hover:text-ink"}`}>
      <Icon name={icon} className="h-[21px] w-[21px]" />
      {!!nav.find((n) => n.id === id)?.badge && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-brand-orange ring-2 ring-paper" aria-hidden="true" />}
    </button>
  );
  const item = (n: NavItem<T>) => (
    <button key={n.id} onClick={() => go(n.id)} aria-current={tab === n.id ? "page" : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.93rem] font-medium transition ${tab === n.id ? "bg-indigo text-white shadow-sm shadow-indigo/20" : "text-ink/75 hover:bg-ink/[0.03] hover:text-ink"}`}>
      <Icon name={n.icon} className={`h-[18px] w-[18px] shrink-0 ${tab === n.id ? "text-white" : "text-ink/50 group-hover:text-indigo"}`} />
      <span className="min-w-0 flex-1 truncate">{n.label}</span>
      {!!n.badge && <span className={`rounded-full px-1.5 text-[11px] font-bold ${tab === n.id ? "bg-brand-orange text-ink" : "bg-brand-orange/20 text-ink"}`}>{n.badge}<span className="sr-only"> new</span></span>}
    </button>
  );
  const sidebar = (mobile: boolean) => (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <button onClick={() => go(nav[0].id)} aria-label="Home"><Image src={logo} alt="Skill Mountain Academy" unoptimized className="h-9 w-auto" /></button>
        {mobile && <button className="grid h-10 w-10 place-items-center rounded-lg text-ink/70 hover:bg-ink/5" aria-label="Close menu" onClick={() => setDrawer(false)}><Icon name="close" /></button>}
      </div>
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-ink/[0.03] p-3" data-profile>
        <Avatar src={me.photo} name={me.fullName} size={44} />
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate font-display text-[0.95rem] font-semibold text-ink">{me.fullName}{me.verified && <VerifiedBadge />}</p>
          <p className="mt-0.5"><span className="inline-block rounded-md bg-indigo/[0.08] px-2 py-0.5 text-xs font-semibold text-indigo">{roleLabel ?? ROLE[me.role]}</span></p>
          {number && <p className="mt-0.5 truncate text-xs text-ink/55">{number}</p>}
        </div>
      </div>
      <nav aria-label="Sections" className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">{nav.map((n) => item(n))}</nav>
      <div className="space-y-2 border-t border-ink/[0.07] p-4">
        {has("messages") && <button onClick={() => go("messages" as T)} className="w-full rounded-xl bg-paper px-4 py-3 text-left text-sm"><span className="block font-semibold text-ink">Need help?</span><span className="block text-ink/65">{me.role === "student" ? "Message your instructor or the Academy." : "Open your messages."}</span></button>}
        <button onClick={signOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-red hover:bg-brand-red/[0.05]"><Icon name="logout" /> Sign out</button>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen overflow-x-clip bg-paper">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-ink/[0.07] bg-white lg:block">{sidebar(false)}</aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="relative h-full w-80 max-w-[88vw] bg-white shadow-xl">{sidebar(true)}</aside>
        </div>
      )}
      <div className="lg:pl-72" data-shell="sidebar">
        <header className="sticky top-0 z-30 border-b border-ink/[0.06] bg-paper/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[88rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink/70 hover:bg-white lg:hidden" aria-label="Open menu" onClick={() => setDrawer(true)}><Icon name="menu" className="h-6 w-6" /></button>
              <button onClick={() => go(nav[0].id)} aria-label="Home" className="shrink-0 lg:hidden"><Image src={logo} alt="Skill Mountain Academy" unoptimized className="h-8 w-auto" /></button>
              <p className="hidden min-w-0 truncate text-sm text-ink/60 sm:block" aria-label="You are here"><span>{where}</span>{current && <> <span aria-hidden="true">/</span> <b className="font-semibold text-ink">{current.label}</b></>}</p>
            </div>
            <div className="flex items-center gap-1">
              {now > 0 && <span className="mr-2 hidden text-sm text-ink/60 xl:block">{new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" })}</span>}
              {quick("calendar", "calendar", "Calendar")}
              {quick("messages", "mail", "Messages")}
              <Notifications onOpen={openNotice} onAll={has("notifications") ? () => go("notifications" as T) : null} />
              <div className="relative ml-1">
                <button onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Account menu" className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition hover:bg-white">
                  <Avatar src={me.photo} name={me.fullName} size={34} />
                  <Icon name="down" className="hidden h-4 w-4 text-ink/50 sm:block" />
                </button>
                {menu && (
                  <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-ink/10 bg-white shadow-xl shadow-ink/10">
                    <div className="border-b border-ink/10 px-4 py-3 text-sm"><p className="font-semibold">{me.fullName}</p><p className="truncate text-ink/65">{me.email}</p>{number && <p className="mt-1 text-ink/65">{number}</p>}</div>
                    {has("profile") && <button onClick={() => go("profile" as T)} className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-ink/[0.04]"><Icon name="user" /> My profile</button>}
                    <button onClick={signOut} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-brand-red hover:bg-brand-red/[0.05]"><Icon name="logout" /> Sign out</button>
                    <button onClick={signOutAll} className="flex w-full items-center gap-2 px-4 py-3 text-sm text-ink/75 hover:bg-ink/[0.04]"><Icon name="logout" /> Sign out of all devices</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
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

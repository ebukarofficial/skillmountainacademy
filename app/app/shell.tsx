"use client";
// The signed-in application frame: a sidebar of sections (a drawer on phones), a top bar with notifications and
// the account menu, and the content area. Each dashboard passes its own sections; the server decides the role.
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import logoWhite from "@/assets/sma-logo-white.png";
import { api, Avatar, goTo, useLoad, when } from "./ui";
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
};
export function Icon({ name, className = "h-[18px] w-[18px]" }: { name: keyof typeof PATHS | string; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={PATHS[name] ?? PATHS.home} /></svg>;
}

export type NavItem<T extends string> = { id: T; label: string; icon: string; badge?: number };
type Note = { id: string; kind: string; title: string; body: string | null; created_at: string; read_at: string | null; link: string | null; priority?: string };

// Where a notice leads inside the app.
const TAB_FOR: [RegExp, string][] = [
  [/^(assignment|quiz)\./, "coursework"], [/^message/, "messages"], [/^(meet|session|reminder|timetable)\./, "classes"],
  [/^student\.assigned/, "students"], [/^attendance\./, "schedule"], [/^instructor\.assigned/, "home"], [/^payment/, "account"], [/^programme\.completed/, "progress"],
];

function Notifications({ onOpen }: { onOpen: (tab: string | null, link: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const { data, reload } = useLoad<{ notifications: Note[]; unread: number }>("/api/app/notifications");
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]);
  const list = [...(data?.notifications ?? [])].sort((a, b) => Number(!!a.read_at) - Number(!!b.read_at) || Number(b.priority === "urgent") - Number(a.priority === "urgent"));
  const openOne = async (n: Note) => {
    if (!n.read_at) await api("/api/app/notifications/read", { method: "POST", body: { ids: [n.id] } }).catch(() => undefined);
    reload(); setOpen(false);
    onOpen(TAB_FOR.find(([re]) => re.test(n.kind))?.[1] ?? null, n.link);
  };
  return (
    <div className="relative">
      <button aria-expanded={open} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`} onClick={() => setOpen(!open)} className="relative grid h-10 w-10 place-items-center rounded-full text-ink/70 transition hover:bg-ink/5 hover:text-ink">
        <Icon name="bell" className="h-5 w-5" />
        {!!data?.unread && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-red px-1 text-[10px] font-bold text-white">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,92vw)] overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-2xl shadow-ink/15">
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
            <b className="font-display text-sm">Notifications</b>
            {!!data?.unread && <button className="text-xs font-semibold text-indigo hover:underline" onClick={() => api("/api/app/notifications/read", { method: "POST", body: { all: true } }).then(reload)}>Mark all as read</button>}
          </div>
          <ul className="max-h-[26rem] divide-y divide-ink/[0.06] overflow-auto">
            {list.map((n) => (
              <li key={n.id}>
                <button onClick={() => openOne(n)} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-ink/[0.03] ${n.read_at ? "" : "bg-indigo/[0.04]"}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : n.priority === "urgent" ? "bg-brand-red" : "bg-indigo"}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">{n.title}{n.priority === "urgent" && !n.read_at && <span className="rounded bg-brand-red/10 px-1.5 text-[10px] font-bold uppercase text-brand-red">Urgent</span>}</span>
                    {n.body && <span className="mt-0.5 block text-[0.8rem] leading-snug text-ink/65">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-ink/45">{when(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
            {data && !list.length && <li className="px-4 py-8 text-center text-sm text-ink/55">You are all caught up.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

const ROLE_LABEL = { student: "Student", instructor: "Faculty", admin: "Administration" } as const;

export function AppShell<T extends string>({ me, nav, tab, setTab, children }: { me: Me; nav: NavItem<T>[]; tab: T; setTab: (t: T) => void; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  async function signOut() { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); goTo(me.role === "student" ? "/app/login/" : "/app/staff/"); }
  const go = (t: T) => { setTab(t); setDrawer(false); };
  const openFromNotice = (t: string | null, link: string | null) => {
    if (link && /^https:\/\/meet\.google\.com\//.test(link)) { window.open(link, "_blank", "noopener"); return; }
    if (t && nav.some((n) => n.id === t)) go(t as T);
  };
  const number = me.role === "student" ? me.studentNo : me.staffNo;
  const side = (
    <nav aria-label="Sections" className="flex h-full flex-col bg-indigo text-white">
      <div className="flex items-center justify-between px-5 pb-6 pt-5">
        <Image src={logoWhite} alt="Skill Mountain Academy" unoptimized className="h-9 w-auto" />
        <button className="grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 lg:hidden" aria-label="Close menu" onClick={() => setDrawer(false)}><Icon name="close" /></button>
      </div>
      <p className="px-5 pb-2 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/45">{ROLE_LABEL[me.role]}</p>
      <ul className="flex-1 space-y-0.5 overflow-auto px-3">
        {nav.map((n) => (
          <li key={n.id}>
            <button onClick={() => go(n.id)} aria-current={tab === n.id ? "page" : undefined}
              className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${tab === n.id ? "bg-white/[0.12] text-white" : "text-white/70 hover:bg-white/[0.06] hover:text-white"}`}>
              {tab === n.id && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-brand-orange" aria-hidden="true" />}
              <Icon name={n.icon} />
              <span className="flex-1">{n.label}</span>
              {!!n.badge && <span className="rounded-full bg-brand-orange px-1.5 text-[10px] font-bold text-ink">{n.badge}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="m-3 rounded-xl bg-white/[0.06] p-3">
        <div className="flex items-center gap-3">
          <Avatar src={me.photo} name={me.fullName} size={36} />
          <div className="min-w-0 text-xs"><p className="truncate font-semibold text-white">{me.fullName}</p>{number && <p className="truncate text-white/55">{number}</p>}</div>
        </div>
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen bg-paper lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{side}</aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="relative h-full w-72 max-w-[85vw]">{side}</aside>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-ink/[0.07] bg-white/85 backdrop-blur">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-8">
          <div className="flex items-center gap-2">
            <button className="grid h-10 w-10 place-items-center rounded-lg text-ink/70 hover:bg-ink/5 lg:hidden" aria-label="Open menu" onClick={() => setDrawer(true)}><Icon name="menu" className="h-5 w-5" /></button>
            <p className="font-display text-sm font-semibold text-ink/80">{nav.find((n) => n.id === tab)?.label}</p>
          </div>
          <div className="flex items-center gap-1">
            <Notifications onOpen={openFromNotice} />
            <div className="relative">
              <button onClick={() => setMenu(!menu)} aria-expanded={menu} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition hover:bg-ink/5">
                <Avatar src={me.photo} name={me.fullName} size={32} />
                <span className="hidden text-sm font-semibold text-ink sm:block">{me.fullName.split(" ")[0]}</span>
              </button>
              {menu && (
                <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-ink/10 bg-white shadow-xl shadow-ink/10">
                  <div className="border-b border-ink/10 px-4 py-3 text-sm"><p className="font-semibold">{me.fullName}</p><p className="truncate text-xs text-ink/55">{me.email}</p>{number && <p className="mt-1 text-xs text-ink/55">{number}</p>}</div>
                  {nav.some((n) => n.id === "account") && <button onClick={() => { setMenu(false); go("account" as T); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-ink/[0.04]"><Icon name="user" /> My account</button>}
                  <button onClick={signOut} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-brand-red hover:bg-brand-red/[0.05]"><Icon name="logout" /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}

"use client";
// /app/: the signed-in dashboard. One page that shows the right dashboard for the user's role (the server enforces roles).
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import logo from "@/assets/sma-logo.png";
import { api, Badge, goTo, useLoad, when } from "./ui";
import { StudentDashboard } from "./student";
import { InstructorDashboard } from "./instructor";
import { AdminDashboard } from "./admin";

export type Me = { id: string; email: string; role: "student" | "instructor" | "admin"; fullName: string; phone: string | null; bio: string | null; photo: string | null; studentNo: string | null; specialization: string | null; qualifications: string[]; links: Record<string, string> };

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useLoad<{ notifications: { id: string; title: string; body: string; created_at: string; read_at: string | null; link: string | null }[]; unread: number }>("/api/app/notifications");
  return (
    <div className="relative">
      <button aria-expanded={open} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`} onClick={() => setOpen(!open)} className="relative grid h-10 w-10 place-items-center rounded-full bg-paper">
        <span aria-hidden="true">🔔</span>
        {!!data?.unread && <span className="absolute -right-1 -top-1 rounded-full bg-brand-red px-1.5 text-xs font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,90vw)] rounded-2xl bg-paper p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between"><b className="font-display">Notifications</b>
            <button className="text-xs font-semibold text-brand-red underline" onClick={() => api("/api/app/notifications/read", { method: "POST", body: { all: true } }).then(reload)}>Mark all read</button></div>
          <ul className="max-h-96 space-y-2 overflow-auto">
            {(data?.notifications ?? []).map((n) => (
              <li key={n.id} className={`rounded-xl p-2 text-sm ${n.read_at ? "" : "bg-cream"}`}><b>{n.title}</b><p className="text-ink/70">{n.body}</p><p className="text-xs text-ink/50">{when(n.created_at)}</p></li>
            ))}
            {!data?.notifications.length && <li className="text-sm text-ink/60">Nothing yet.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AppHome() {
  const { data, error } = useLoad<{ user: Me }>("/api/me");
  const me = data?.user;
  async function signOut() { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); goTo("/app/login/"); }
  return (
    <>
      <header className="sticky top-0 z-40 bg-cream/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" unoptimized className="h-9 w-auto" /></Link>
          {me && <div className="flex items-center gap-3">
            <Notifications />
            <span className="hidden text-sm sm:block"><b>{me.fullName}</b> <Badge s={me.role} /></span>
            <button onClick={signOut} className="rounded-full border-2 border-indigo/30 px-4 py-2 text-sm font-semibold text-indigo">Sign out</button>
          </div>}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 pb-16">
        {error && <p role="alert" className="mt-10 text-center text-brand-red">{error}</p>}
        {!me && !error && <p className="mt-10 text-center text-ink/60" role="status">Loading your dashboard…</p>}
        {me?.role === "student" && <StudentDashboard me={me} />}
        {me?.role === "instructor" && <InstructorDashboard me={me} />}
        {me?.role === "admin" && <AdminDashboard />}
      </main>
    </>
  );
}

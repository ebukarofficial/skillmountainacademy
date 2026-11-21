"use client";
// Small building blocks for the dashboards: API calls, cards, buttons, badges, fields and file uploads.
// Colours come only from the existing tokens in app/globals.css.
import Image from "next/image";
import { useCallback, useEffect, useState, type ReactNode } from "react";

export class ApiFail extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(path, { method: init.method ?? "GET", credentials: "same-origin", headers: init.body !== undefined ? { "content-type": "application/json" } : undefined, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const j = await r.json().catch(() => ({ ok: false, message: "Something went wrong. Please try again." }));
  if (r.status === 401 && !path.startsWith("/api/auth/")) {
    // Back to the entry page, remembering where the person was going (bookmarked pages work after signing in).
    const here = window.location.pathname + window.location.search;
    goTo(`/app/login/${here.startsWith("/app/") && here !== "/app/" ? `?next=${encodeURIComponent(here)}` : ""}`);
    throw new ApiFail(401, "Please sign in.");
  }
  if (!r.ok || j.ok === false) throw new ApiFail(r.status, j.message || "Something went wrong. Please try again.");
  return j as T;
}

// Full page navigation (used after sign-in/out so every cached view is dropped).
export const goTo = (path: string) => window.location.assign(new URL(path, window.location.origin).href);

// The current time, refreshed every 30 seconds (kept out of render so pages stay pure).
export function useNow(every = 30_000) {
  const [now, setNow] = useState(0);
  useEffect(() => { const tick = () => setNow(Date.now()); const t0 = setTimeout(tick, 0); const t = setInterval(tick, every); return () => { clearTimeout(t0); clearInterval(t); }; }, [every]);
  return now;
}

// A user's photo (served by the API to signed-in users), or their initial.
export function Avatar({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  return src
    ? <Image src={src} alt="" width={size} height={size} unoptimized className="rounded-full object-cover" style={{ width: size, height: size }} />
    : <span className="grid shrink-0 place-items-center rounded-full bg-indigo font-display font-semibold text-cream" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>{name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>;
}

// Uploads a file as the raw request body (the server streams it to storage).
export async function upload<T = Record<string, unknown>>(path: string, file: File): Promise<T> {
  const r = await fetch(`${path}?name=${encodeURIComponent(file.name)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
  const j = await r.json().catch(() => ({ message: "Upload failed." }));
  if (!r.ok || j.ok === false) throw new ApiFail(r.status, j.message || "Upload failed.");
  return j as T;
}

// Loads data and reloads on demand. Errors are shown, never thrown at the page.
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let off = false;
    api<T>(path).then((d) => { if (!off) { setData(d); setError(""); } }).catch((e: Error) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [path, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, reload };
}

export function Card({ title, children, action, className = "" }: { title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-ink/[0.07] bg-white p-5 shadow-sm shadow-ink/5 sm:p-6 ${className}`}>
      {(title || action) && <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-display text-[0.95rem] font-semibold tracking-tight text-ink">{title}</h2>{action}</div>}
      {children}
    </section>
  );
}

export function Btn({ children, onClick, kind = "primary", type = "button", disabled, small }: { children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "dark"; type?: "button" | "submit"; disabled?: boolean; small?: boolean }) {
  const k = kind === "primary" ? "bg-indigo text-white shadow-sm shadow-indigo/20 hover:bg-navy" : kind === "dark" ? "bg-ink text-white hover:bg-navy" : "border border-ink/15 bg-white text-ink hover:border-indigo/40 hover:text-indigo";
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-display font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo disabled:opacity-50 ${small ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"} ${k}`}>{children}</button>;
}

const TONES: Record<string, string> = {
  pending: "bg-brand-orange/20 text-ink", open: "bg-brand-orange/20 text-ink", scheduled: "bg-indigo/10 text-indigo", submitted: "bg-indigo/10 text-indigo", in_progress: "bg-indigo/10 text-indigo",
  submitted_late: "bg-brand-orange/25 text-ink", graded: "bg-indigo text-white", completed: "bg-indigo text-white", paid: "bg-indigo text-white", active: "bg-indigo text-white",
  overdue: "bg-brand-red/15 text-brand-red", missed: "bg-brand-red/15 text-brand-red", cancelled: "bg-ink/10 text-ink/70", rescheduled: "bg-ink/10 text-ink/70", suspended: "bg-brand-red/15 text-brand-red",
  part_paid: "bg-brand-orange/20 text-ink", due: "bg-brand-orange/20 text-ink", added: "bg-indigo/10 text-indigo",
  approved: "bg-indigo text-white", rejected: "bg-brand-red/15 text-brand-red", application_received: "bg-ink/10 text-ink", under_review: "bg-indigo/10 text-indigo",
  assessment_pending: "bg-brand-orange/20 text-ink", interview_pending: "bg-brand-orange/20 text-ink", upcoming: "bg-indigo/10 text-indigo", closed: "bg-ink/10 text-ink/70", full: "bg-brand-red/15 text-brand-red",
};
export const Badge = ({ s }: { s: string }) => <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[0.7rem] font-semibold capitalize ${TONES[s] ?? "bg-ink/[0.06] text-ink/80"}`}>{s.replace(/_/g, " ")}</span>;

export const inputCls = "mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink/40 focus:border-indigo focus:ring-4 focus:ring-indigo/10";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-[0.8rem] font-semibold text-ink/80">{label}{children}</label>;
}

export function Bar({ pct, label }: { pct: number | null; label: string }) {
  const v = pct ?? 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-ink/70"><span>{label}</span><span className="font-semibold text-ink">{pct === null ? "n/a" : `${v}%`}</span></div>
      <div className="mt-1.5 h-1.5 rounded-full bg-ink/[0.07]" role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}><div className="h-1.5 rounded-full bg-indigo" style={{ width: `${Math.min(100, v)}%` }} /></div>
    </div>
  );
}

export function Msg({ text, kind = "error" }: { text: string; kind?: "error" | "ok" }) {
  if (!text) return null;
  return <p role={kind === "error" ? "alert" : "status"} className={`mt-2 text-sm font-medium ${kind === "error" ? "text-brand-red" : "text-indigo"}`}>{text}</p>;
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-ink/60">{children}</p>;
export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
export const naira = (n: number) => "₦" + Math.round(n).toLocaleString("en-NG");

// Runs an action, shows its error or success message, then reloads.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "error" | "ok" }>({ text: "", kind: "ok" });
  const run = useCallback(async (fn: () => Promise<unknown>, okText = "", after?: () => void) => {
    setBusy(true); setMsg({ text: "", kind: "ok" });
    try { await fn(); setMsg({ text: okText, kind: "ok" }); after?.(); } catch (e) { setMsg({ text: (e as Error).message, kind: "error" }); } finally { setBusy(false); }
  }, []);
  return { busy, msg, run };
}

// A headline figure: label, value and an optional note.
export function Stat({ label, value, note, tone = "plain" }: { label: string; value: ReactNode; note?: ReactNode; tone?: "plain" | "alert" }) {
  return (
    <div className="rounded-2xl border border-ink/[0.07] bg-white p-5 shadow-sm shadow-ink/5">
      <p className="text-xs font-semibold text-ink/55">{label}</p>
      <p className={`mt-2 font-display text-3xl font-semibold tracking-tight ${tone === "alert" ? "text-brand-red" : "text-ink"}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-ink/55">{note}</p>}
    </div>
  );
}

// Page heading inside the app.
export function PageTitle({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[1.7rem]">{title}</h1>{sub && <div className="mt-1 text-sm text-ink/60">{sub}</div>}</div>
      {action}
    </div>
  );
}

// Reads ?tab= once (so links from emails and notifications open the right section) and keeps the address in step.
export function useTab<T extends string>(tabs: readonly T[], first: T): [T, (t: T) => void] {
  const [tab, setTabState] = useState<T>(first);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as T | null;
    if (!t || !tabs.includes(t)) return;
    const id = setTimeout(() => setTabState(t), 0);
    return () => clearTimeout(id);
  }, [tabs]);
  const setTab = useCallback((t: T) => {
    setTabState(t);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", t);
    window.history.replaceState(null, "", u.pathname + u.search);
    window.scrollTo({ top: 0 });
  }, []);
  return [tab, setTab];
}

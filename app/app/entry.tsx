"use client";
// The two private entry points: students (/app/login/) and staff (/app/staff/). Both use the same passwordless
// link; the role always comes from the server account, never from which page was used.
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import logo from "@/assets/sma-logo.png";
import logoWhite from "@/assets/sma-logo-white.png";
import { Turnstile, turnstileAvailable } from "../turnstile";
import { api, inputCls, Msg } from "./ui";

const KEY = "sma-entry-email";
// Only same-site learning-space paths are kept as a return address.
export const safeNext = (v: string | null) => (v && /^\/app\/[^/]/.test(v) && !v.startsWith("//") && !/^\/app\/(login|staff)\b/.test(v) ? v : null);

const COPY = {
  student: {
    eyebrow: "Students",
    title: "Welcome to your learning space.",
    lede: "Your classes, coursework, materials and instructor, in one place.",
    points: ["Your next class and its Google Meet link", "Assignments, quizzes and feedback", "Messages with your instructor", "Your progress, payments and registration number"],
    form: "Enter the email address you used for your admission. We will send you a secure, single-use link.",
    other: { href: "/app/staff/", text: "Faculty and staff entrance" },
  },
  staff: {
    eyebrow: "Faculty and staff",
    title: "Staff workspace",
    lede: "Teaching, admissions and academy administration.",
    points: ["Schedules, attendance and marking", "Admissions and enrolments", "Recruitment and faculty records", "Finance and platform health"],
    form: "Enter your staff email address. We will send you a secure, single-use link.",
    other: { href: "/app/login/", text: "Student entrance" },
  },
} as const;

export function EntryPage({ kind }: { kind: "student" | "staff" }) {
  const c = COPY[kind];
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState("");
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      try { setEmail(localStorage.getItem(KEY) ?? ""); } catch { /* private mode */ }
      setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
    }, 0);
    return () => clearTimeout(t);
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return setErr("Please complete the security check.");
    setBusy(true); setErr("");
    try {
      const r = await api<{ message: string }>("/api/auth/request", { method: "POST", body: { email, turnstileToken: token, next } });
      try { localStorage.setItem(KEY, email.trim().toLowerCase()); } catch { /* private mode */ }
      setSent(r.message);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-indigo p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-plum/60 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-navy blur-3xl" />
        <Link href="/" aria-label="Skill Mountain Academy home" className="relative"><Image src={logoWhite} alt="Skill Mountain Academy" unoptimized className="h-11 w-auto" /></Link>
        <div className="relative mt-auto max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-orange">{c.eyebrow}</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight">{c.title}</h2>
          <p className="mt-3 text-white/70">{c.lede}</p>
          <ul className="mt-8 space-y-3">{c.points.map((p) => <li key={p} className="flex items-center gap-3 text-sm text-white/85"><span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-brand-orange" aria-hidden="true">✓</span>{p}</li>)}</ul>
        </div>
        <p className="relative mt-12 text-xs text-white/45">Skill Mountain Academy · Abuja, Nigeria · online worldwide</p>
      </section>
      <section className="flex flex-col justify-center bg-paper px-5 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" aria-label="Skill Mountain Academy home" className="lg:hidden"><Image src={logo} alt="Skill Mountain Academy" unoptimized className="h-10 w-auto" /></Link>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-brand-red lg:mt-0">{c.eyebrow}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">{kind === "student" ? "Enter your learning space" : "Enter the staff workspace"}</h1>
          <p className="mt-3 text-sm text-ink/65">{c.form}</p>
          {sent ? (
            <div role="status" className="mt-8 rounded-2xl border border-ink/[0.07] bg-white p-5 shadow-sm shadow-ink/5">
              <p className="font-semibold text-ink">Check your email</p>
              <p className="mt-1 text-sm text-ink/70">{sent} The link works once and expires shortly. Check your spam folder if it has not arrived within a few minutes.</p>
              <button onClick={() => { setSent(""); setToken(""); }} className="mt-4 text-sm font-semibold text-indigo hover:underline">Use a different email</button>
            </div>
          ) : !turnstileAvailable() ? (
            <p className="mt-8 rounded-2xl border border-ink/[0.07] bg-white p-5 text-sm">Sign-in is not available right now. Please contact admission@skillmountainacademy.com.</p>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-5">
              <label className="block text-sm font-semibold text-ink">Email address
                <input name="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </label>
              <Turnstile action="login" onToken={setToken} />
              <Msg text={err} />
              <button disabled={busy} className="w-full rounded-xl bg-indigo py-3 font-display text-sm font-semibold text-white shadow-lg shadow-indigo/20 transition hover:bg-navy disabled:opacity-60">{busy ? "Sending…" : "Email me a secure link"}</button>
            </form>
          )}
          <div className="mt-10 space-y-2 border-t border-ink/[0.07] pt-6 text-sm text-ink/60">
            {kind === "student" && <p>Not admitted yet? <Link href="/admissions/" className="font-semibold text-indigo hover:underline">Apply for admission</Link></p>}
            <p><Link href={c.other.href} className="font-semibold text-ink/70 hover:text-indigo">{c.other.text}</Link></p>
          </div>
        </div>
      </section>
    </main>
  );
}

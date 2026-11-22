"use client";
// The three private entrances: students (/app/student/login/), instructors (/app/instructor/login/) and
// administrators (/app/login/). The server only sends a link when the account's role matches the entrance.
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import logo from "@/assets/sma-logo.png";
import logoWhite from "@/assets/sma-logo-white.png";
import bgStudent from "@/assets/photos/banner-students.webp";
import bgInstructor from "@/assets/photos/photo-web.webp";
import bgAdmin from "@/assets/photos/photo-cloud.webp";
import { pickQuote, QUOTES } from "@/lib/quotes";
import { Turnstile, turnstileAvailable } from "../turnstile";
import { api, inputCls, Msg } from "./ui";
import { PORTAL_KEY, type Portal } from "./portals";
export { lastPortal, PORTALS, type Portal } from "./portals";

const KEY = "sma-entry-email";
// Only same-site learning-space paths are kept as a return address.
export const safeNext = (v: string | null) => (v && /^\/app\/[^/]/.test(v) && !v.startsWith("//") && !/^\/app\/(login|staff|confirm|student\/login|instructor\/login)\b/.test(v) ? v : null);

const COPY = {
  student: {
    eyebrow: "Students",
    form: "Enter the email address you used for your admission. We will send you a secure, single-use link.",
    other: { href: "/app/instructor/login/", text: "Faculty entrance" },
  },
  instructor: {
    eyebrow: "Faculty",
    form: "Enter your faculty email address. We will send you a secure, single-use link.",
    other: { href: "/app/student/login/", text: "Student entrance" },
  },
  admin: {
    eyebrow: "Administration",
    form: "Administrators only. Enter your email address and we will send you a secure, single-use link.",
    other: null,
  },
} as const;

const BG = { student: bgStudent, instructor: bgInstructor, admin: bgAdmin } as const;
const QUOTE_KEY = "sma-quote";

const H1: Record<Portal, string> = { student: "Enter your learning space", instructor: "Enter the faculty workspace", admin: "Administrator sign-in" };

export function EntryPage({ kind }: { kind: Portal }) {
  const c = COPY[kind];
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  const [quote, setQuote] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      // A different quotation on every visit (chosen in the browser, so the page itself stays static).
      let last: number | null = null;
      try { const v = localStorage.getItem(QUOTE_KEY); last = v === null ? null : Number(v); } catch { /* private mode */ }
      const q = pickQuote(Number.isInteger(last) ? last : null);
      setQuote(q);
      try { localStorage.setItem(QUOTE_KEY, String(q)); } catch { /* private mode */ }
      try { setEmail(localStorage.getItem(KEY) ?? ""); } catch { /* private mode */ }
      setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
      setExpired(new URLSearchParams(window.location.search).get("expired"));
    }, 0);
    return () => clearTimeout(t);
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return setErr("Please complete the security check.");
    setBusy(true); setErr("");
    try {
      const r = await api<{ message: string }>("/api/auth/request", { method: "POST", body: { email, turnstileToken: token, next, portal: kind } });
      try { localStorage.setItem(KEY, email.trim().toLowerCase()); localStorage.setItem(PORTAL_KEY, kind); } catch { /* private mode */ }
      setSent(r.message);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-indigo p-12 text-white lg:flex lg:flex-col">
        <Image src={BG[kind]} alt="" aria-hidden="true" fill priority sizes="55vw" className="pointer-events-none object-cover opacity-[0.16] mix-blend-luminosity grayscale" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-indigo via-indigo/70 to-indigo/30" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-plum/50 blur-3xl" />
        <Link href="/" aria-label="Skill Mountain Academy home" className="relative"><Image src={logoWhite} alt="Skill Mountain Academy" unoptimized className="h-11 w-auto" /></Link>
        <figure className={`relative mt-auto max-w-xl transition-opacity duration-700 ${quote === null ? "opacity-0" : "opacity-100"}`} aria-live="polite">
          <span aria-hidden="true" className="block font-display text-4xl leading-none text-brand-orange">“</span>
          <blockquote className="mt-2 font-display text-3xl font-medium leading-snug tracking-tight">{quote !== null ? QUOTES[quote].text : ""}</blockquote>
          <figcaption className="mt-6 flex items-center gap-3 text-sm text-white/70"><span aria-hidden="true" className="h-px w-8 bg-brand-orange" />{quote !== null ? QUOTES[quote].by : ""}</figcaption>
        </figure>
      </section>
      <section className="flex flex-col justify-center bg-paper px-5 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" aria-label="Skill Mountain Academy home" className="lg:hidden"><Image src={logo} alt="Skill Mountain Academy" unoptimized className="h-10 w-auto" /></Link>
          <p className="mt-8 text-sm font-semibold text-brand-red lg:mt-0">{c.eyebrow}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">{H1[kind]}</h1>
          <p className="mt-3 text-sm text-ink/65">{c.form}</p>
          {expired && !sent && (
            <p role="status" className="mt-6 rounded-xl border border-brand-orange/40 bg-white px-4 py-3 text-sm text-ink/85">
              {expired === "idle" ? "You were signed out because there was no activity for a while. Request a new sign-in link to continue." : "Your session has ended. Request a new sign-in link to continue."}
              {kind === "student" && " If you are in a live class, stay in Google Meet: signing out here does not affect the class or your attendance."}
              {next && " You will return to the page you were on."}
            </p>
          )}
          {sent ? (
            <div role="status" className="mt-8 rounded-2xl border border-ink/[0.07] bg-white p-5 shadow-sm shadow-ink/5">
              <p className="font-semibold text-ink">Check your email</p>
              <p className="mt-1 text-sm text-ink/70">{sent} Check your spam folder if it has not arrived within a few minutes.</p>
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
          <div className={`mt-10 space-y-2 pt-6 text-sm text-ink/60 ${c.other ? "border-t border-ink/[0.07]" : ""}`}>
            {kind === "student" && <p>Not admitted yet? <Link href="/admissions/" className="font-semibold text-indigo hover:underline">Apply for admission</Link></p>}
            {c.other && <p><Link href={c.other.href} className="font-semibold text-ink/70 hover:text-indigo">{c.other.text}</Link></p>}
          </div>
        </div>
      </section>
    </main>
  );
}

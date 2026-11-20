"use client";
import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import logo from "@/assets/sma-logo.png";
import { Turnstile, turnstileAvailable } from "../../turnstile";
import { api, inputCls, Msg } from "../ui";

export default function Login() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") || "");
    if (!token) return setErr("Please complete the security check.");
    setBusy(true); setErr("");
    try { const r = await api<{ message: string }>("/api/auth/request", { method: "POST", body: { email, turnstileToken: token } }); setSent(r.message); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <main id="main" className="mx-auto max-w-md px-5 py-12">
      <Link href="/" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" unoptimized className="mx-auto h-12 w-auto" /></Link>
      <div className="mt-8 rounded-[2rem] bg-paper p-6 shadow-xl shadow-indigo/10 sm:p-8">
        <h1 className="font-display text-2xl font-extrabold">Sign in</h1>
        <p className="mt-1 text-sm text-ink/70">Students, instructors and staff. We email you a one-time sign-in link; there is no password.</p>
        {sent ? <p role="status" className="mt-5 rounded-2xl bg-cream p-4 text-sm">{sent} Check your inbox (and spam folder).</p>
          : !turnstileAvailable() ? <p className="mt-5 rounded-2xl bg-cream p-4 text-sm">Sign-in is not set up yet. Please contact admission@skillmountainacademy.com.</p>
          : <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block text-sm font-medium">Email address<input name="email" type="email" required autoComplete="email" className={inputCls} /></label>
              <Turnstile action="login" onToken={setToken} />
              <Msg text={err} />
              <button disabled={busy} className="brand-bg w-full rounded-full py-3 font-display font-semibold text-white disabled:opacity-60">{busy ? "Sending…" : "Email me a sign-in link"}</button>
            </form>}
      </div>
    </main>
  );
}

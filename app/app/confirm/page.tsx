"use client";
// The emailed link opens this page. Signing in needs a click (a POST), so email scanners that open links cannot use it.
import Image from "next/image";
import logo from "@/assets/sma-logo.png";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, goTo, Msg } from "../ui";
import { lastPortal, PORTALS, safeNext, type Portal } from "../entry";

// The emailed link says which entrance it belongs to (?p=), so each role is greeted in its own words.
const COPY: Record<Portal, { eyebrow: string; title: string; text: string; button: string }> = {
  student: { eyebrow: "Students", title: "Welcome back", text: "Press the button to finish signing in to your learning space on this device.", button: "Continue to your learning space" },
  instructor: { eyebrow: "Faculty", title: "Welcome back", text: "Press the button to finish signing in to the faculty workspace on this device.", button: "Continue to the faculty workspace" },
  admin: { eyebrow: "Administration", title: "Administrator sign-in", text: "Press the button to finish signing in to Academy administration on this device.", button: "Continue to administration" },
};

function Confirm() {
  const q = useSearchParams();
  const t = q.get("t") || "";
  const next = safeNext(q.get("next"));
  const p = (q.get("p") ?? "") in PORTALS ? (q.get("p") as Portal) : "student";
  const c = COPY[p];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try { await api("/api/auth/verify", { method: "POST", body: { token: t } }); goTo(next ?? "/app/"); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-paper px-5 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-ink/[0.07] bg-white p-8 text-center shadow-xl shadow-ink/5">
        <Image src={logo} alt="Skill Mountain Academy" unoptimized className="mx-auto h-10 w-auto" />
        <p className="mt-6 text-sm font-semibold text-brand-red">{c.eyebrow}</p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">{c.title}</h1>
        <p className="mt-2 text-sm text-ink/65">{c.text}</p>
        <button onClick={go} disabled={busy || !t} className="mt-6 w-full rounded-xl bg-indigo py-3 font-display text-sm font-semibold text-white shadow-lg shadow-indigo/20 transition hover:bg-navy disabled:opacity-60">{busy ? "Signing in…" : c.button}</button>
        <Msg text={err} />
        {err && <button onClick={() => goTo(q.get("p") ? PORTALS[p] : lastPortal())} className="mt-3 inline-block text-sm font-semibold text-indigo hover:underline">Request a new link</button>}
      </div>
    </main>
  );
}
export default function Page() { return <Suspense><Confirm /></Suspense>; }

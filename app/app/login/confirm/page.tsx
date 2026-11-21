"use client";
// The emailed link opens this page. Signing in needs a click (a POST), so email scanners that open links cannot use it.
import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/sma-logo.png";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, goTo, Msg } from "../../ui";
import { safeNext } from "../../entry";

function Confirm() {
  const q = useSearchParams();
  const t = q.get("t") || "";
  const next = safeNext(q.get("next"));
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
        <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm text-ink/65">Press the button to finish signing in on this device.</p>
        <button onClick={go} disabled={busy || !t} className="mt-6 w-full rounded-xl bg-indigo py-3 font-display text-sm font-semibold text-white shadow-lg shadow-indigo/20 transition hover:bg-navy disabled:opacity-60">{busy ? "Signing in…" : "Continue to your learning space"}</button>
        <Msg text={err} />
        {err && <Link href="/app/login/" className="mt-3 inline-block text-sm font-semibold text-indigo hover:underline">Request a new link</Link>}
      </div>
    </main>
  );
}
export default function Page() { return <Suspense><Confirm /></Suspense>; }

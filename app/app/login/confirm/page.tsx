"use client";
// The emailed link opens this page. Signing in needs a click (a POST), so email scanners that open links cannot use it.
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, goTo, Msg } from "../../ui";

function Confirm() {
  const t = useSearchParams().get("t") || "";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try { await api("/api/auth/verify", { method: "POST", body: { token: t } }); goTo("/app/"); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <main id="main" className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-[2rem] bg-paper p-6 text-center shadow-xl shadow-indigo/10 sm:p-8">
        <h1 className="font-display text-2xl font-extrabold">Welcome back</h1>
        <p className="mt-2 text-sm text-ink/70">Press the button to finish signing in on this device.</p>
        <button onClick={go} disabled={busy || !t} className="brand-bg mt-6 w-full rounded-full py-3 font-display font-semibold text-white disabled:opacity-60">{busy ? "Signing in…" : "Sign in to Skill Mountain Academy"}</button>
        <Msg text={err} />
        {err && <Link href="/app/login/" className="mt-3 inline-block text-sm font-semibold text-brand-red underline">Request a new link</Link>}
      </div>
    </main>
  );
}
export default function Page() { return <Suspense><Confirm /></Suspense>; }

"use client";
// Administrator two-step sign-in screens (Stage 2): the code prompt after the email link, and the setup/management card.
// Everything here is a convenience: the server refuses every administrator route until the code has been accepted.
import Image from "next/image";
import logo from "@/assets/sma-logo.png";
import { useState } from "react";
import { api, Btn, Card, goTo, inputCls, Msg, useAction, useLoad } from "./ui";

export function MfaChallenge() {
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/api/auth/mfa/verify", { method: "POST", body: recovery ? { recoveryCode: code } : { code } }); goTo("/app/"); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-paper px-5 py-16">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-ink/[0.07] bg-white p-8 shadow-xl shadow-ink/5">
        <Image src={logo} alt="Skill Mountain Academy" unoptimized className="mx-auto h-10 w-auto" />
        <h1 className="mt-6 text-center font-display text-2xl font-semibold">Two-step sign-in</h1>
        <p className="mt-2 text-center text-sm text-ink/70">{recovery ? "Enter one of your recovery codes. Each code works once." : "Enter the 6-digit code from your authenticator app."}</p>
        <label className="mt-6 block text-sm font-semibold">{recovery ? "Recovery code" : "Authenticator code"}
          <input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"}
            pattern={recovery ? undefined : "\\d{6}"} maxLength={recovery ? 20 : 6} className={`${inputCls} text-center font-mono text-lg tracking-widest`} />
        </label>
        <Msg text={err} />
        <button disabled={busy} className="mt-5 w-full rounded-xl bg-indigo py-3 font-display text-sm font-semibold text-white hover:bg-navy disabled:opacity-60">Continue</button>
        <button type="button" onClick={() => { setRecovery(!recovery); setCode(""); setErr(""); }} className="mt-3 w-full text-sm font-semibold text-indigo hover:underline">
          {recovery ? "Use my authenticator app instead" : "I cannot use my app: use a recovery code"}
        </button>
        <button type="button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined); goTo("/app/login/"); }}
          className="mt-2 w-full text-sm text-ink/65 hover:underline">Cancel and sign out</button>
      </form>
    </main>
  );
}

type Status = { configured: boolean; enabled: boolean; pendingSetup: boolean; recoveryCodesLeft: number; enforced: boolean };

function Codes({ codes }: { codes: string[] }) {
  return (
    <div className="mt-4 rounded-lg border border-brand-orange/40 bg-brand-orange/[0.06] p-4">
      <p className="font-semibold">Save these recovery codes now</p>
      <p className="mt-1 text-sm text-ink/75">Each code works once if you lose your phone. They will not be shown again. Store them somewhere safe and offline.</p>
      <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <button type="button" onClick={() => navigator.clipboard?.writeText(codes.join("\n")).catch(() => undefined)} className="mt-3 text-sm font-semibold text-indigo hover:underline">Copy codes</button>
    </div>
  );
}

// Setup and management. `forced` = shown full-page because the Academy requires it before administration can be used.
export function MfaSettings({ forced = false }: { forced?: boolean }) {
  const s = useLoad<Status>("/api/auth/mfa/status");
  const { busy, msg, run } = useAction();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const st = s.data;
  const body = !st ? <Msg text={s.error ?? ""} /> : !st.configured ? (
    <p className="text-sm text-ink/75">Two-step sign-in is not switched on for this server yet. The Academy must set the MFA_ENCRYPTION_KEY secret first.</p>
  ) : st.enabled ? (
    <div className="space-y-4">
      <p className="text-sm"><b className="font-semibold text-indigo">On.</b> You enter a code from your authenticator app after each email link. Recovery codes left: <b>{st.recoveryCodesLeft}</b>.</p>
      {codes && <Codes codes={codes} />}
      <label className="block max-w-xs text-sm font-semibold">Current code from your app<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} className={inputCls} /></label>
      <div className="flex flex-wrap gap-2">
        <Btn small kind="ghost" disabled={busy || code.length !== 6} onClick={() => run(async () => { const r = await api<{ recoveryCodes: string[] }>("/api/auth/mfa/recovery-codes", { method: "POST", body: { code } }); setCodes(r.recoveryCodes); setCode(""); }, "New recovery codes created. The old ones no longer work.", s.reload)}>Create new recovery codes</Btn>
        {!st.enforced && <Btn small kind="ghost" disabled={busy || code.length !== 6} onClick={() => { if (confirm("Turn off two-step sign-in? Other devices will be signed out.")) run(() => api("/api/auth/mfa/disable", { method: "POST", body: { code } }), "Two-step sign-in is off.", () => { setCode(""); s.reload(); }); }}>Turn off</Btn>}
      </div>
    </div>
  ) : (
    <div className="space-y-4">
      <p className="text-sm text-ink/75">Protect administration with a second step: after the email link, enter a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar). Someone who gets into your mailbox still cannot sign in.</p>
      {!setup ? (
        <Btn small disabled={busy} onClick={() => run(async () => setSetup(await api<{ secret: string; otpauthUrl: string }>("/api/auth/mfa/setup", { method: "POST" })), "")}>Set up two-step sign-in</Btn>
      ) : (
        <div className="space-y-3 rounded-lg border border-ink/10 bg-paper p-4">
          <p className="text-sm"><b className="font-semibold">1.</b> In your authenticator app choose <i>Add account</i> then <i>Enter a setup key</i>, and type this key (time-based):</p>
          <p className="break-all rounded bg-white px-3 py-2 font-mono text-sm tracking-wider" aria-label="Setup key">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
          <p className="text-sm">On a phone you can instead <a href={setup.otpauthUrl} className="font-semibold text-indigo underline">open the key in your authenticator app</a>.</p>
          <p className="text-sm"><b className="font-semibold">2.</b> Enter the 6-digit code the app shows:</p>
          <div className="flex flex-wrap items-end gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} aria-label="Code from the app" className={`${inputCls} max-w-[10rem] font-mono`} />
            <Btn small disabled={busy || code.length !== 6} onClick={() => run(async () => { const r = await api<{ recoveryCodes: string[] }>("/api/auth/mfa/enable", { method: "POST", body: { code } }); setCodes(r.recoveryCodes); setSetup(null); setCode(""); }, "Two-step sign-in is on. Other devices were signed out.", s.reload)}>Turn on</Btn>
          </div>
        </div>
      )}
      {codes && <Codes codes={codes} />}
    </div>
  );
  const card = <Card title="Two-step sign-in">{body}<Msg text={msg.text} kind={msg.kind} /></Card>;
  if (!forced) return card;
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-paper px-5 py-16">
      <div className="w-full max-w-xl space-y-4">
        <Image src={logo} alt="Skill Mountain Academy" unoptimized className="mx-auto h-10 w-auto" />
        <p className="text-center text-sm text-ink/75">The Academy requires two-step sign-in for administrators. Set it up to continue.</p>
        {card}
        {st?.enabled && <div className="text-center"><Btn onClick={() => goTo("/app/")}>Continue to administration</Btn></div>}
      </div>
    </main>
  );
}

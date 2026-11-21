"use client";
// Book a call: a short request form in a dialog. Saved by POST /api/bookings, emailed to Admissions, confirmed to the
// applicant by email. The Academy calls at the requested time or writes to arrange another; nothing calls automatically.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PROGRAMMES } from "@/lib/config";
import { Turnstile } from "./turnstile";

const input = "mt-1 w-full rounded-md border border-ink/15 bg-white px-3.5 py-2.5 text-base outline-none focus:border-indigo focus:ring-2 focus:ring-indigo/20";
const ZONES = (() => { try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; } catch { return []; } })();
const today = () => new Date().toISOString().slice(0, 10);

let openDialog: ((programme?: string) => void) | null = null;
export const openBookCall = (programme?: string) => openDialog?.(programme);

export function BookCallButton({ className, programme, children = "Book a call" }: { className?: string; programme?: string; children?: React.ReactNode }) {
  return <button type="button" className={className} onClick={() => openBookCall(programme)}>{children}</button>;
}

// Mounted once per page (in the footer area). Renders nothing until opened.
export function BookCallDialog() {
  const [open, setOpen] = useState(false);
  const [prog, setProg] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "Africa/Lagos"; } })();
  useEffect(() => { openDialog = (p) => { setProg(p ?? ""); setDone(false); setErr(""); setOpen(true); }; return () => { openDialog = null; }; }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    setTimeout(() => box.current?.querySelector<HTMLElement>("input,select,button")?.focus(), 30);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  if (!open) return null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!token) return setErr("Please complete the security check.");
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, turnstileToken: token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setErr(j.message || "Something went wrong. Please try again, or email admission@skillmountainacademy.com.");
      else setDone(true);
    } catch { setErr("We could not reach our server. Please try again."); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-end bg-ink/50 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="book-title" onClick={() => setOpen(false)}>
      <div ref={box} onClick={(e) => e.stopPropagation()} className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h2 id="book-title" className="font-(family-name:--font-serif) text-3xl font-medium">Book a call with Admissions</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink/70 hover:bg-ink/5">✕</button>
        </div>
        {done ? (
          <div role="status" className="mt-6 rounded-lg bg-[#f8f8f9] p-5">
            <p className="font-display font-semibold">Thank you. Your request has been received.</p>
            <p className="mt-1 text-ink/75">A confirmation is on its way to your email. A member of the Admissions team will contact you at the time you chose, or write to arrange another.</p>
            <button type="button" onClick={() => setOpen(false)} className="mt-4 rounded-full bg-indigo px-5 py-2.5 font-display text-sm font-semibold text-white">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Name<input name="name" required maxLength={120} autoComplete="name" className={input} /></label>
              <label className="block text-sm font-semibold">Email<input name="email" type="email" required maxLength={200} autoComplete="email" className={input} /></label>
              <label className="block text-sm font-semibold">Phone number<input name="phone" type="tel" required maxLength={30} autoComplete="tel" className={input} /></label>
              <label className="block text-sm font-semibold">Programme of interest
                <select name="programme" value={prog} onChange={(e) => setProg(e.target.value)} className={input}>
                  <option value="">Not sure yet</option>
                  {PROGRAMMES.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">Preferred date<input name="preferredDate" type="date" required min={today()} className={input} /></label>
              <label className="block text-sm font-semibold">Preferred time<input name="preferredTime" type="time" required className={input} /></label>
            </div>
            <label className="block text-sm font-semibold">Your time zone
              <select name="timezone" defaultValue={tz} className={input}>
                {(ZONES.length ? ZONES : [tz]).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">Reason for the call<textarea name="reason" required rows={3} maxLength={1000} className={input} placeholder="What would you like to discuss?" /></label>
            <Turnstile action="book_call" onToken={setToken} />
            {err && <p role="alert" className="rounded-md bg-brand-red/10 px-4 py-3 text-sm text-brand-red">{err}</p>}
            <p className="text-xs text-ink/60">We use these details only to arrange and hold this call. See our <a href="/privacy/" className="underline">Privacy Policy</a>.</p>
            <button disabled={busy} className="w-full rounded-full bg-indigo py-3.5 font-display font-semibold text-white transition hover:bg-navy disabled:opacity-60">{busy ? "Sending…" : "Request the call"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

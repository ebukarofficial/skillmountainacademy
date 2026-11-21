"use client";
// The on-site admissions assistant (replaces the WhatsApp chat button). Answers come from POST /api/assistant/ask,
// which uses only the Academy's approved programme and admissions information and hands off to Admissions when it
// does not know. The conversation stays in this browser tab; questions are logged for Admissions (see Privacy Policy).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BUSINESS } from "@/lib/config";
import { openBookCall } from "./book-call";

type Msg = { role: "user" | "assistant"; content: string; handoff?: boolean };
const SUGGEST = ["What does AI Automation cost?", "How long is Graphics Design?", "Can I pay in instalments?", "I live in the UK. Which currency do I pay in?"];
const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const conv = useRef<string>("");
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) setTimeout(() => field.current?.focus(), 30); }, [open]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    if (!conv.current) conv.current = newId();
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/assistant/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: conv.current, question, history }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setErr(j.message || "The assistant is unavailable. Please try again shortly.");
      else setMsgs((m) => [...m, { role: "assistant", content: j.answer, handoff: j.handoff }]);
    } catch { setErr("We could not reach our server. Please try again."); } finally { setBusy(false); }
  }
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const v = field.current?.value ?? ""; if (field.current) field.current.value = ""; void ask(v); };

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Ask Admissions" className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-indigo p-3.5 sm:px-5 sm:py-3 font-display text-sm font-semibold text-white shadow-xl shadow-ink/20 transition hover:bg-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5"><path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          <span className="hidden sm:inline">Ask Admissions</span>
        </button>
      )}
      {open && (
        <div role="dialog" aria-modal="false" aria-labelledby="assistant-title" className="fixed inset-x-3 bottom-3 z-[75] flex max-h-[min(40rem,88dvh)] flex-col overflow-hidden rounded-xl border border-ink/10 bg-white shadow-2xl shadow-ink/25 sm:inset-x-auto sm:right-4 sm:w-[24rem]">
          <div className="flex items-center justify-between gap-3 bg-indigo/90 px-4 py-3 text-white">
            <div><p id="assistant-title" className="font-display font-semibold">Admissions assistant</p><p className="text-xs text-white/75">Answers from the Academy&apos;s published information</p></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the assistant" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15">✕</button>
          </div>
          <div ref={list} className="flex-1 space-y-3 overflow-y-auto bg-paper px-4 py-4" aria-live="polite">
            {!msgs.length && (
              <div>
                <p className="rounded-lg bg-white p-3 text-sm leading-relaxed text-ink/80">Good day. I can answer questions about our programmes, fees, durations, admissions, payment and study. For anything I cannot answer, I will put you in touch with Admissions.</p>
                <div className="mt-3 flex flex-wrap gap-2">{SUGGEST.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-indigo/25 bg-white px-3 py-1.5 text-left text-xs font-semibold text-indigo hover:border-indigo">{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <p className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-indigo text-white" : "bg-white text-ink/85"}`}>{m.content}</p>
                {m.handoff && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => openBookCall()} className="rounded-full bg-indigo px-3 py-1.5 text-xs font-semibold text-white">Book a call</button>
                    <a href={`mailto:${BUSINESS.email}`} className="rounded-full border border-indigo/30 bg-white px-3 py-1.5 text-xs font-semibold text-indigo">Email Admissions</a>
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="text-sm text-ink/60" role="status">Writing a reply…</p>}
            {err && <p role="alert" className="rounded-md bg-brand-red/10 px-3 py-2 text-sm text-brand-red">{err}</p>}
          </div>
          <form onSubmit={submit} className="border-t border-ink/10 p-3">
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="assistant-q">Your question</label>
              <input id="assistant-q" ref={field} maxLength={600} placeholder="Type your question" autoComplete="off" className="min-w-0 flex-1 rounded-md border border-ink/15 px-3 py-2.5 text-sm outline-none focus:border-indigo focus:ring-2 focus:ring-indigo/20" />
              <button disabled={busy} className="rounded-md bg-indigo px-4 font-display text-sm font-semibold text-white disabled:opacity-60">Send</button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-ink/55">Questions are recorded so Admissions can follow up, and deleted after 180 days. Please do not share card or password details. <a href="/privacy/" className="underline">Privacy</a></p>
          </form>
        </div>
      )}
    </>
  );
}

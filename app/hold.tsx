"use client";
// Timed price hold on a programme page. Dormant: for a programme without a timedPrice it renders the normal price
// and makes no network request. With one, the Worker starts (or resumes) a 48-minute hold and this shows a calm
// countdown, the timed price and the regular price crossed out. When it ends: the regular price and "Offer ended".
// No fake scarcity, the timer is not announced every second, reduced motion is respected, and the exit prompt
// appears at most once per visit and never stops anyone leaving.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Programme } from "@/lib/config";
import { Price } from "./components";
import { Money } from "./currency";

type Hold = { offer: boolean; active: boolean; ended?: boolean; endsAt?: string | null; serverNow?: string; timedPrice?: number; regularPrice?: number };

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function useHold(p: Programme) {
  const [hold, setHold] = useState<Hold | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (p.timedPrice == null) return; // dormant
    let skew = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    fetch(`/api/hold?p=${encodeURIComponent(p.slug)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Hold | null) => {
        if (cancelled || !j?.offer) return;
        if (j.serverNow) skew = Date.parse(j.serverNow) - Date.now();
        setHold(j);
        if (j.active && j.endsAt) {
          const end = Date.parse(j.endsAt);
          const tick = () => {
            const ms = end - (Date.now() + skew);
            setLeft(ms);
            if (ms <= 0) { clearInterval(timer); setHold({ ...j, active: false, ended: true }); }
          };
          tick();
          timer = setInterval(tick, 1000);
        }
      })
      .catch(() => { /* no hold: the regular price shows */ });
    return () => { cancelled = true; clearInterval(timer); };
  }, [p.slug, p.timedPrice]);
  return { hold, left, active: !!hold?.active && left > 0 };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function HoldPrice({ p }: { p: Programme }) {
  const { hold, left, active } = useHold(p);
  const reduced = useReducedMotion();
  const minutes = Math.ceil(left / 60000);
  // Screen readers hear the time only at a few milestones, never every second.
  const milestone = active && [30, 10, 5, 1].includes(minutes) ? `${minutes} minute${minutes === 1 ? "" : "s"} left at the offer price.` : "";
  if (!hold?.offer || (!active && !hold.ended)) return <Price p={p} size="lg" />;
  if (!active) {
    return (
      <div>
        <Price p={p} size="lg" />
        <p data-offer-ended className="mt-2 rounded-2xl bg-cream px-4 py-2 text-sm text-ink/80">Offer ended. The regular price applies.</p>
      </div>
    );
  }
  return (
    <div data-hold-active>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <s className="text-ink/70 decoration-brand-red decoration-2"><Money naira={p.price} /></s>
        <span className="font-display text-3xl font-extrabold"><Money naira={p.timedPrice!} /></span>
      </div>
      <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-brand-red">
        <span>Offer price held for you for</span>
        <span role="timer" aria-live="off" className="rounded-full bg-indigo px-2.5 py-0.5 font-display tabular-nums text-white">{reduced ? `${minutes} min` : mmss(left)}</span>
      </p>
      <p className="sr-only" aria-live="polite">{milestone}</p>
      <ExitPrompt p={p} left={left} />
    </div>
  );
}

// One in-page reminder per visit: cursor leaving the top of the window (desktop), the back button, or returning
// to a tab that was hidden (mobile). "Not now" lets the visitor carry on, including going back.
function ExitPrompt({ p, left }: { p: Programme; left: number }) {
  const [open, setOpen] = useState(false);
  const shown = useRef(false);
  const viaBack = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const key = `sma-exit-${p.slug}`;

  const show = useCallback((back = false) => {
    if (shown.current) return false;
    try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
    shown.current = true;
    viaBack.current = back;
    setOpen(true);
    return true;
  }, [key]);

  useEffect(() => {
    let hidden = false;
    const leave = (e: MouseEvent) => { if (e.clientY <= 0 && !e.relatedTarget) show(); };
    const vis = () => { if (document.visibilityState === "hidden") hidden = true; else if (hidden) show(); };
    let pushed = false;
    try { if (!sessionStorage.getItem(key)) { history.pushState({ smaHold: true }, ""); pushed = true; } } catch { /* ignore */ }
    const pop = () => { if (!show(true)) history.back(); };
    document.addEventListener("mouseout", leave);
    document.addEventListener("visibilitychange", vis);
    if (pushed) window.addEventListener("popstate", pop, { once: true });
    return () => { document.removeEventListener("mouseout", leave); document.removeEventListener("visibilitychange", vis); window.removeEventListener("popstate", pop); };
  }, [key, show]);

  const close = useCallback(() => {
    setOpen(false);
    if (viaBack.current) history.back(); // they pressed back: let them go
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = dialog.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => [...(el?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])];
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); prev?.focus?.(); };
  }, [open, close]);

  if (!open || left <= 0) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/60 p-4" onClick={close}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="exit-title" aria-describedby="exit-desc" onClick={(e) => e.stopPropagation()} className="pop w-full max-w-md rounded-[2rem] bg-paper p-6 text-center shadow-2xl">
        <h2 id="exit-title" className="font-display text-2xl font-extrabold">Your offer price is still held</h2>
        <p id="exit-desc" className="mt-2 text-ink/75">{p.name} at <b><Money naira={p.timedPrice!} /></b> for about {Math.ceil(left / 60000)} more minute{Math.ceil(left / 60000) === 1 ? "" : "s"}. After that the regular price of <Money naira={p.price} /> applies.</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Link href={`/checkout/?p=${p.slug}`} className="brand-bg rounded-full py-3 font-display font-semibold text-white">Secure my seat</Link>
          <button type="button" onClick={close} className="rounded-full border-2 border-indigo py-3 font-display font-semibold text-indigo">Not now</button>
        </div>
      </div>
    </div>
  );
}

"use client";
// Inactivity sign-out (Stage 2). The SERVER enforces the limit (students: 10 minutes since the last genuine activity);
// this component only (1) reports genuine activity to the server, throttled, (2) warns a minute before the limit and
// (3) leaves the dashboard when the limit passes. Background requests (notification polling, refreshes) never report
// activity, and the warning itself never extends the session: only a click, key press, touch or scroll does.
import { useEffect, useRef, useState } from "react";
import { goTo } from "./ui";
import { expiredUrl } from "./portals";

const PING_EVERY_MS = 30_000;   // at most one activity report every 30 seconds
const WARN_MS = 60_000;         // show the warning in the last minute
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "touchmove", "input"] as const;

export type SessionInfo = { idleMinutes: number | null; now: string; lastActivityAt: string | null; expiresAt: string };

export function IdleGuard({ session }: { session: SessionInfo | null | undefined }) {
  const idleMs = session?.idleMinutes ? session.idleMinutes * 60_000 : null;
  const last = useRef(0);
  const serverNow = session?.now, serverLast = session?.lastActivityAt;
  const lastPing = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gone = useRef(false);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!idleMs) return;
    // The server's last activity, translated to this device's clock (so a wrong phone clock cannot shorten or lengthen it).
    const offset = serverNow ? Date.now() - Date.parse(serverNow) : 0;
    last.current = serverLast ? Date.parse(serverLast) + offset : Date.now();
    const expire = async () => {
      if (gone.current) return;
      gone.current = true;
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
      goTo(expiredUrl("idle"));
    };
    const ping = async () => {
      if (gone.current) return;
      pending.current = null;
      lastPing.current = Date.now();
      const r = await fetch("/api/auth/activity", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ago: Math.max(0, Date.now() - last.current) }) }).catch(() => null);
      if (r && r.status === 401) await expire(); // the server already ended it (for example after the device slept)
    };
    const onActivity = () => {
      if (gone.current) return;
      const now = Date.now();
      // Coming back after the limit (sleep, another tab): the session is over; do not try to revive it.
      if (now - last.current > idleMs) { void expire(); return; }
      last.current = now;
      setLeft(null);
      if (now - lastPing.current >= PING_EVERY_MS) void ping();
      else if (!pending.current) pending.current = setTimeout(ping, PING_EVERY_MS - (now - lastPing.current));
    };
    const tick = () => {
      const rest = idleMs - (Date.now() - last.current);
      if (rest <= 0) void expire();
      else setLeft(rest <= WARN_MS ? Math.ceil(rest / 1000) : null);
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(tick, 1000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [idleMs, serverNow, serverLast]);

  if (left === null) return null;
  return (
    <div role="alertdialog" aria-live="assertive" aria-label="Inactivity warning" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border border-brand-orange/40 bg-white p-4 shadow-xl shadow-ink/15 sm:inset-x-auto sm:right-6">
      <p className="font-semibold text-ink">You will be signed out in {left} second{left === 1 ? "" : "s"}</p>
      <p className="mt-1 text-sm text-ink/70">For your security, the learning space signs you out after {session?.idleMinutes} minutes without activity.</p>
      <button type="button" className="mt-3 rounded-lg bg-indigo px-4 py-2 text-sm font-semibold text-white hover:bg-navy">Stay signed in</button>
    </div>
  );
}

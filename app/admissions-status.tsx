"use client";
// Public admissions status, read once from GET /api/admissions. The site never sees capacity figures.
// If the status cannot be loaded (backend not set up yet), every programme counts as open, as before.
import { useSyncExternalStore, type ReactNode } from "react";
import { statusLabel, type PublicStatus } from "@/lib/admissions";

type State = { ready: boolean; programmes: Record<string, PublicStatus> };
const EMPTY: State = { ready: false, programmes: {} };
let state: State = EMPTY;
let started = false;
const subs = new Set<() => void>();

async function start() {
  if (started) return;
  started = true;
  let programmes: Record<string, PublicStatus> = {};
  try {
    const r = await fetch("/api/admissions", { headers: { accept: "application/json" } });
    const j = r.ok ? await r.json() : null;
    if (j?.ok && j.programmes && typeof j.programmes === "object") programmes = j.programmes;
  } catch { /* offline or not set up: treat as open */ }
  state = { ready: true, programmes };
  subs.forEach((f) => f());
}
function subscribe(f: () => void) { subs.add(f); void start(); return () => subs.delete(f); }

export function useAdmissions() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}
export function useAdmission(slug: string) {
  const s = useAdmissions();
  return { ready: s.ready, status: s.programmes[slug], ...statusLabel(s.programmes[slug]) };
}

export function AdmissionBadge({ slug, compact = false, light = false }: { slug: string; compact?: boolean; light?: boolean }) {
  const a = useAdmission(slug);
  if (!a.ready) return compact ? null : <span className="inline-block h-6" aria-hidden="true" />;
  const open = a.canEnrol;
  const dot = open ? "bg-brand-orange" : light ? "bg-white/40" : "bg-ink/30";
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xs font-semibold ${light ? "text-white/85" : "text-ink/70"}`} data-admission={a.status?.state ?? "open"}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />{compact && a.status?.state === "upcoming" ? "Opening soon" : a.title}
    </span>
  );
}

// Hides a programme from listings when an admin has unlisted it (its page still exists).
export function ListedOnly({ slug, children }: { slug: string; children: ReactNode }) {
  const { status } = useAdmission(slug);
  if (status && status.listed === false) return null;
  return <>{children}</>;
}

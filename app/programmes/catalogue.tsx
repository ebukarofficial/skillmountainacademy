"use client";
// The programme catalogue: filter by discipline and level (both real programme data) and search by name or
// description. Everything renders on the server first, so every programme are in the page without JavaScript.
import { useMemo, useState } from "react";
import { PROGRAMMES } from "@/lib/config";
import { programmeCopy } from "@/lib/programme-content";
import { ProgrammeGrid } from "../brand";

const DISCIPLINES = ["All", ...Array.from(new Set(PROGRAMMES.map((p) => p.tag)))];
const LEVELS = Array.from(new Set(PROGRAMMES.map((p) => p.level).filter(Boolean))) as string[];

export function Catalogue() {
  const [d, setD] = useState("All");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return PROGRAMMES.filter((p) => (d === "All" || p.tag === d) && (!level || p.level === level)
      && (!t || `${p.name} ${p.tag} ${p.blurb} ${programmeCopy(p.slug).discipline}`.toLowerCase().includes(t)));
  }, [d, level, q]);
  return (
    <section aria-label="Programme catalogue" className="mx-auto max-w-6xl px-5 py-12 sm:py-14">
      <div className="flex flex-col gap-4 rounded-xl border border-ink/10 bg-white p-4 sm:p-5 lg:flex-row lg:items-end">
        <label className="block flex-1 text-sm font-semibold">Search programmes
          <span className="relative mt-1.5 block">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/60"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5" /></svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example: cloud, design, security" className="w-full rounded-lg border border-ink/25 bg-white py-2.5 pl-10 pr-3 font-normal outline-none focus:border-indigo focus:ring-4 focus:ring-indigo/15" />
          </span>
        </label>
        {LEVELS.length > 1 && <label className="block text-sm font-semibold lg:w-56">Level
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1.5 w-full rounded-lg border border-ink/25 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo focus:ring-4 focus:ring-indigo/15">
            <option value="">All levels</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>}
      </div>
      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-ink/15 no-scrollbar" role="tablist" aria-label="Disciplines">
        {DISCIPLINES.map((c) => (
          <button key={c} role="tab" aria-selected={d === c} onClick={() => setD(c)} className={`-mb-px shrink-0 border-b-[3px] px-4 py-3 font-display text-[0.95rem] font-semibold transition ${d === c ? "border-indigo text-indigo" : "border-transparent text-ink/70 hover:text-ink"}`}>{c}</button>
        ))}
      </div>
      <p className="mt-5 text-sm text-ink/70" aria-live="polite">{list.length} programme{list.length === 1 ? "" : "s"}{d !== "All" ? ` in ${d}` : ""}{q ? ` matching "${q}"` : ""}</p>
      <div className="mt-4">{list.length ? <ProgrammeGrid list={list} /> : <p className="rounded-xl border border-ink/10 p-6 text-ink/75">No programme matches. Try another word, or clear the filters.</p>}</div>
    </section>
  );
}

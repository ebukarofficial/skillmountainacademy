"use client";
/* eslint-disable @next/next/no-img-element */
// Approved instructors who have agreed to be listed, from GET /api/faculty. Nothing appears until an admin
// approves an instructor (after identity, credential and practical checks) and turns on their public profile.
import { useEffect, useState } from "react";
import { PROGRAMMES } from "@/lib/config";

type Member = { id: string; fullName: string; specialization: string | null; bio: string | null; highestQualification: string | null; qualifications: string[]; links: Record<string, string>; programmes: string[]; photo: string | null };
const name = (slug: string) => PROGRAMMES.find((p) => p.slug === slug)?.name ?? slug;
const LINK_LABEL: Record<string, string> = { linkedin: "LinkedIn", portfolio: "Portfolio", website: "Website", github: "GitHub" };

export function FacultyList({ programme }: { programme?: string }) {
  const [list, setList] = useState<Member[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/faculty", { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setList(j?.ok ? (j.faculty as Member[]).filter((m) => !programme || m.programmes.includes(programme)) : []); }).catch(() => live && setList([]));
    return () => { live = false; };
  }, [programme]);
  // Until profiles arrive (and when there are none) the page says plainly how profiles are published: no spinner.
  if (!list || !list.length) return (
    <p className="max-w-2xl border-t border-ink/10 pt-6 text-lg leading-relaxed text-ink/70">{programme
      ? "Your instructor is assigned after enrolment, from the verified faculty for this discipline. Faculty profiles appear here once instructors have completed verification and agreed to be listed."
      : "Individual faculty profiles are published here once an instructor has completed verification and agreed to be listed. We publish only qualifications and experience we have verified."}</p>
  );
  return (
    <ul className={`grid gap-x-10 gap-y-2 ${programme ? "" : "md:grid-cols-2"}`} data-faculty>
      {list.map((m) => (
        <li key={m.id} className="flex gap-5 border-t border-ink/10 py-8">
          {m.photo ? <img src={m.photo} alt={`Portrait of ${m.fullName}`} loading="lazy" width={96} height={96} className="h-24 w-24 shrink-0 rounded-full object-cover" />
            : <span aria-hidden="true" className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-indigo font-(family-name:--font-serif) text-3xl text-cream">{m.fullName.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>}
          <div className="min-w-0">
            <h3 className="font-(family-name:--font-serif) text-2xl font-medium leading-tight">{m.fullName}</h3>
            {m.specialization && <p className="mt-1 font-display text-sm font-semibold text-brand-red">{m.specialization}</p>}
            {m.programmes.length > 0 && <p className="mt-1 text-sm text-ink/60">Teaches {m.programmes.map(name).join(", ")}</p>}
            {m.bio && <p className="mt-3 leading-relaxed text-ink/75">{m.bio}</p>}
            {(m.highestQualification || m.qualifications.length > 0) && (
              <ul className="mt-3 space-y-1 text-sm text-ink/70">
                {m.highestQualification && <li>{m.highestQualification}</li>}
                {m.qualifications.map((q) => <li key={q}>{q}</li>)}
              </ul>
            )}
            {Object.keys(m.links).length > 0 && (
              <p className="mt-3 flex flex-wrap gap-x-4 text-sm">{Object.entries(m.links).filter(([k]) => LINK_LABEL[k]).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-indigo underline">{LINK_LABEL[k]}</a>)}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

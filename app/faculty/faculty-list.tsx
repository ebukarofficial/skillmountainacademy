"use client";
/* eslint-disable @next/next/no-img-element */
// Approved instructors who have agreed to be listed, from GET /api/faculty. Nothing appears until an admin
// approves an instructor (after identity, credential and practical checks) and turns on their public profile.
import { useEffect, useState } from "react";
import { PROGRAMMES } from "@/lib/config";
import { VerifiedMark } from "../brand";

type Member = { id: string; fullName: string; specialization: string | null; bio: string | null; highestQualification: string | null; qualifications: string[]; links: Record<string, string>; programmes: string[]; photo: string | null; verified?: boolean; headline?: string | null; languages?: string[] };
const name = (slug: string) => PROGRAMMES.find((p) => p.slug === slug)?.name ?? slug;
const LINK_LABEL: Record<string, string> = { linkedin: "LinkedIn", x: "X", portfolio: "Portfolio", website: "Website", github: "GitHub" };

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
    <ul className={`grid gap-6 ${programme ? "" : "lg:grid-cols-2"}`} data-faculty>
      {list.map((m) => {
        const quals = [m.highestQualification, ...m.qualifications].filter(Boolean).slice(0, 3) as string[];
        return (
          <li key={m.id} className="flex h-full flex-col gap-5 rounded-lg border border-ink/10 bg-white p-5 sm:flex-row sm:p-6">
            {m.photo ? <img src={m.photo} alt={`Portrait of ${m.fullName}`} loading="lazy" width={128} height={160} className="h-40 w-32 shrink-0 rounded-md object-cover" />
              : <span aria-hidden="true" className="grid h-40 w-32 shrink-0 place-items-center rounded-md bg-indigo/90 font-(family-name:--font-serif) text-4xl text-white">{m.fullName.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>}
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="flex items-center gap-2 font-(family-name:--font-serif) text-2xl font-medium leading-tight">{m.fullName}{m.verified && <VerifiedMark className="text-base" />}</h3>
              {m.headline && <p className="mt-1 text-ink/80">{m.headline}</p>}
              <dl className="mt-3 space-y-1 text-sm">
                {m.programmes.length > 0 && <div className="flex gap-2"><dt className="w-28 shrink-0 text-ink/60">Teaches</dt><dd className="text-ink/85">{m.programmes.map(name).join(", ")}</dd></div>}
                {m.specialization && <div className="flex gap-2"><dt className="w-28 shrink-0 text-ink/60">Specialisation</dt><dd className="text-ink/85">{m.specialization}</dd></div>}
                {quals.length > 0 && <div className="flex gap-2"><dt className="w-28 shrink-0 text-ink/60">Qualifications</dt><dd className="text-ink/85">{quals.join("; ")}</dd></div>}
                {!!m.languages?.length && <div className="flex gap-2"><dt className="w-28 shrink-0 text-ink/60">Languages</dt><dd className="text-ink/85">{m.languages.join(", ")}</dd></div>}
              </dl>
              {m.bio && <p className="mt-3 line-clamp-4 leading-relaxed text-ink/75">{m.bio}</p>}
              {Object.keys(m.links).length > 0 && (
                <p className="mt-auto flex flex-wrap gap-x-4 pt-3 text-sm">{Object.entries(m.links).filter(([k]) => LINK_LABEL[k]).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-indigo underline">{LINK_LABEL[k]}</a>)}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

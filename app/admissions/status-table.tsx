"use client";
// Current admissions status per programme. Only open / opening / closed / fully subscribed: never seat numbers.
import Link from "next/link";
import { PROGRAMMES, duration } from "@/lib/config";
import { useAdmissions, AdmissionBadge } from "../admissions-status";
import { statusLabel } from "@/lib/admissions";

export function StatusTable() {
  const { programmes, ready } = useAdmissions();
  return (
    <table className="w-full text-left">
      <caption className="sr-only">Admissions status by programme</caption>
      <thead><tr className="border-b border-ink/15 font-display text-xs uppercase tracking-[0.18em] text-ink/55"><th scope="col" className="py-3 pr-4 font-semibold">Programme</th><th scope="col" className="hidden py-3 pr-4 font-semibold sm:table-cell">Duration</th><th scope="col" className="py-3 font-semibold">Status</th></tr></thead>
      <tbody>
        {PROGRAMMES.filter((p) => programmes[p.slug]?.listed !== false).map((p) => (
          <tr key={p.slug} className="border-b border-ink/10 align-top">
            <th scope="row" className="py-4 pr-4 font-normal"><Link href={`/programmes/${p.slug}/`} className="font-display font-semibold hover:text-brand-red">{p.name}</Link></th>
            <td className="hidden py-4 pr-4 text-ink/65 sm:table-cell">{duration(p)}</td>
            <td className="py-4"><AdmissionBadge slug={p.slug} />{ready && <span className="mt-1 block text-sm text-ink/55">{statusLabel(programmes[p.slug]).detail}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

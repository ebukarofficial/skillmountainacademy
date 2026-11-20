// Admissions status and programme capacity: pure rules shared by the Worker (which enforces them) and the
// website (which only ever shows the public status, never seat numbers).

export type AdmissionMode = "open" | "scheduled" | "closed";
export type AdmissionState = "open" | "upcoming" | "closed" | "full";
export type Period = { programme_slug: string | null; opens_at: string; closes_at: string; cancelled_at?: string | null };
export type Setting = { mode: AdmissionMode; enforce_capacity: number; reserved: number; default_instructor_cap: number; listed: number };
export const DEFAULT_SETTING: Setting = { mode: "open", enforce_capacity: 0, reserved: 0, default_instructor_cap: 30, listed: 1 };

// What the public may see. No capacity figures, ever.
export type PublicStatus = { state: AdmissionState; opensAt?: string; closesAt?: string; listed: boolean };

export type Capacity = { total: number; enrolled: number; reserved: number; available: number; utilisation: number | null; full: boolean };

// Capacity counts only approved, active instructors assigned to the programme.
export function capacity(assignments: { max_students: number | null }[], defaultCap: number, enrolled: number, reserved: number): Capacity {
  const total = assignments.reduce((n, a) => n + Math.max(0, a.max_students ?? defaultCap), 0);
  const available = Math.max(0, total - enrolled - reserved);
  return { total, enrolled, reserved, available, utilisation: total ? Math.min(1, (enrolled + reserved) / total) : null, full: available <= 0 };
}

export function admissionStatus(slug: string, s: Setting, periods: Period[], now: Date, cap: Capacity | null): PublicStatus {
  const listed = s.listed !== 0;
  if (s.mode === "closed") return { state: "closed", listed };
  let state: AdmissionState = "open";
  let opensAt: string | undefined, closesAt: string | undefined;
  if (s.mode === "scheduled") {
    const t = now.toISOString();
    const mine = periods.filter((p) => !p.cancelled_at && (p.programme_slug === null || p.programme_slug === slug));
    const current = mine.filter((p) => p.opens_at <= t && t < p.closes_at).sort((a, b) => b.closes_at.localeCompare(a.closes_at))[0];
    if (current) closesAt = current.closes_at;
    else {
      const next = mine.filter((p) => p.opens_at > t).sort((a, b) => a.opens_at.localeCompare(b.opens_at))[0];
      if (next) { state = "upcoming"; opensAt = next.opens_at; } else state = "closed";
    }
  }
  if (state === "open" && s.enforce_capacity && cap?.full) return { state: "full", listed };
  return { state, ...(opensAt ? { opensAt } : {}), ...(closesAt ? { closesAt } : {}), listed };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });

// Wording for the website. Calm and factual: no countdowns and no seat numbers.
export function statusLabel(st: PublicStatus | undefined): { title: string; detail: string; canEnrol: boolean } {
  if (!st || st.state === "open") return { title: "Admissions open", detail: st?.closesAt ? `Applications for this intake close on ${day(st.closesAt)}.` : "Applications are being accepted for this programme.", canEnrol: true };
  if (st.state === "upcoming") return { title: "Next admission period opening soon", detail: st.opensAt ? `Applications open on ${day(st.opensAt)}.` : "The next admission period will be announced here.", canEnrol: false };
  if (st.state === "full") return { title: "This intake is fully subscribed", detail: "Every place in the current intake has been taken. Please check back for the next intake, or contact Admissions.", canEnrol: false };
  return { title: "Applications currently closed", detail: "Admissions for this programme are closed at present. Please check back or contact Admissions.", canEnrol: false };
}

export const VERIFICATION = ["application_received", "under_review", "assessment_pending", "interview_pending", "approved", "rejected", "suspended"] as const;
export type Verification = (typeof VERIFICATION)[number];
export const VERIFICATION_LABEL: Record<Verification, string> = {
  application_received: "Application received", under_review: "Under review", assessment_pending: "Assessment pending",
  interview_pending: "Interview pending", approved: "Approved", rejected: "Rejected", suspended: "Suspended",
};
// The checks recorded for each candidate. The first three must be done before approval.
export const CHECKS = [
  ["identity", "Identity verified"], ["credentials", "Academic and professional credentials verified"], ["technical", "Discipline-specific technical assessment passed"],
  ["portfolio", "Portfolio and practical experience reviewed"], ["teaching", "Practical teaching demonstration"], ["interview", "Interview"], ["references", "Background and reference checks"],
] as const;
export type CheckKey = (typeof CHECKS)[number][0];
export const REQUIRED_CHECKS: CheckKey[] = ["identity", "credentials", "technical"];
export const QUALIFICATION_LEVELS = ["PhD", "Doctoral researcher", "Master's degree", "Bachelor's degree", "Industry professional", "Certified specialist", "Recognised practitioner", "Other"] as const;

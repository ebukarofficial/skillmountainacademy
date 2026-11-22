// Engagement alert thresholds. An administrator can change them (Admin > Students > Monitoring); these are the defaults.
export type AlertRules = {
  missedClasses: number;       // flag at this many missed classes on the enrolment
  overdueAssignments: number;  // flag at this many overdue, unsubmitted assignments
  missedAssessments: number;   // flag at this many assessments past their due date without an attempt
  averageBelow: number;        // flag when assignment or assessment average falls below this percentage
  inactiveDays: number;        // flag an active enrolment with no completed class for this many days
};
export const DEFAULT_RULES: AlertRules = { missedClasses: 2, overdueAssignments: 1, missedAssessments: 1, averageBelow: 50, inactiveDays: 21 };
export const RULE_LIMITS: Record<keyof AlertRules, [number, number]> = { missedClasses: [1, 20], overdueAssignments: [1, 20], missedAssessments: [1, 20], averageBelow: [1, 100], inactiveDays: [7, 120] };
export const RULES_KEY = "engagement_rules";

export function cleanRules(v: unknown): AlertRules {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES) as (keyof AlertRules)[]) {
    const n = Number(o[k]);
    const [lo, hi] = RULE_LIMITS[k];
    if (Number.isInteger(n) && n >= lo && n <= hi) out[k] = n;
  }
  return out;
}

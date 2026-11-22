// Session lifetimes per role (Stage 2).
//  - Students: signed out after 10 minutes without genuine activity, and after 12 hours in any case.
//  - Instructors and administrators: unchanged by default (30 days, sliding). The owner can switch on idle limits with
//    INSTRUCTOR_IDLE_MINUTES / ADMIN_IDLE_MINUTES and shorten admin sessions with ADMIN_SESSION_HOURS. Recommended values
//    are in docs/SMA_SECURITY_REMEDIATION.md (instructors 30 min, administrators 15 min and 12 hours).
import type { AppEnv } from "../env";
import type { Role } from "./data/users";

export const STUDENT_IDLE_MINUTES = 10;
export const STUDENT_SESSION_HOURS = 12;
export const STAFF_SESSION_DAYS = 30;
export const MFA_PENDING_MINUTES = 10;   // a session waiting for the authenticator code lapses after this
export const ACTIVITY_THROTTLE_SECONDS = 20; // the server records activity at most this often per session

export type SessionPolicy = { idleMinutes: number | null; absoluteHours: number; sliding: boolean };

const minutes = (v: string | undefined, lo: number, hi: number) => {
  const n = Number(v);
  return v && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

export function policyFor(role: Role, env: AppEnv): SessionPolicy {
  if (role === "student") return { idleMinutes: STUDENT_IDLE_MINUTES, absoluteHours: STUDENT_SESSION_HOURS, sliding: false };
  if (role === "instructor") return { idleMinutes: minutes(env.INSTRUCTOR_IDLE_MINUTES, 5, 240), absoluteHours: STAFF_SESSION_DAYS * 24, sliding: true };
  const hours = minutes(env.ADMIN_SESSION_HOURS, 1, STAFF_SESSION_DAYS * 24);
  return { idleMinutes: minutes(env.ADMIN_IDLE_MINUTES, 5, 240), absoluteHours: hours ?? STAFF_SESSION_DAYS * 24, sliding: hours === null };
}

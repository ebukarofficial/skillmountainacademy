// The three private entrances, one per role.
export type Portal = "student" | "instructor" | "admin";
export const PORTALS: Record<Portal, string> = { student: "/app/student/login/", instructor: "/app/instructor/login/", admin: "/app/login/" };
export const PORTAL_KEY = "sma-portal";
// The entrance this browser last used, so an expired session returns there.
export function lastPortal(): string {
  try { const p = localStorage.getItem(PORTAL_KEY) as Portal | null; if (p && p in PORTALS) return PORTALS[p]; } catch { /* private mode */ }
  return PORTALS.student;
}

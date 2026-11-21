// Institutional identifiers, issued only by the server:
//   student     SMA/26/000001  (two-digit year of admission, Lagos time; one sequence per year)
//   instructor  SMA/FAC/000001 (issued on approval)
//   admin       SMA/ADM/000001
// If migration 0005 has not run yet, students fall back to the earlier format so admissions never stop.
import { ApiError } from "../http";
import { nextSeq } from "./data/users";

const pad = (n: number) => String(n).padStart(6, "0");
const yy = (d = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "2-digit" }).format(d);
const legacy = () => `SMA${yy()}-${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("")}`;

async function seq(db: D1Database, name: string): Promise<number | null> {
  try { return await nextSeq(db, name); } catch (e) {
    if (e instanceof ApiError && e.code === "not_configured") return null;
    throw e;
  }
}
export async function newStudentNo(db: D1Database, at = new Date()): Promise<string> {
  const n = await seq(db, `STU:${yy(at)}`);
  return n === null ? legacy() : `SMA/${yy(at)}/${pad(n)}`;
}
export async function newStaffNo(db: D1Database, role: "admin" | "instructor"): Promise<string | null> {
  const n = await seq(db, role === "admin" ? "ADM" : "FAC");
  return n === null ? null : `SMA/${role === "admin" ? "ADM" : "FAC"}/${pad(n)}`;
}
export const STUDENT_NO_RE = /^SMA\/\d{2}\/\d{6}$/;

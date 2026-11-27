// Turns a paid website registration into a student account and enrolment (first payment confirmed).
// Safe to call more than once: it reuses the account and enrolment if they exist.
import type { AppEnv } from "../env";
import type { OrderRow, RegistrationRow } from "../repo";
import { nowIso } from "../http";
import { createUser, getUserByEmail, audit, type User } from "./data/users";
import { createEnrolment, findEnrolment, setEnrolmentOrder } from "./data/enrolments";
import { newStudentNo } from "./ids";
import { resolveProgramme } from "../catalogue";
import { snapshotEnrolmentDurations } from "./data/catalogue";

export async function ensureStudentAccount(env: AppEnv, reg: RegistrationRow, order: OrderRow): Promise<User | null> {
  if (!env.DB) return null;
  const db = env.DB;
  try {
    let user = await getUserByEmail(db, reg.email);
    if (!user) {
      user = { id: crypto.randomUUID(), email: reg.email.toLowerCase(), role: "student", status: "active",
        full_name: [reg.first_name, reg.middle_name, reg.surname].filter(Boolean).join(" "), phone: reg.phone, bio: null, photo_key: null,
        student_no: await newStudentNo(db), specialization: null, qualifications: null, links: null, registration_id: reg.id, created_at: nowIso(), last_login_at: null };
      await createUser(db, user);
      await audit(db, { actor_id: null, action: "user.create.from_payment", target_type: "user", target_id: user.id, detail: { order: order.reference } });
    }
    if (user.role !== "student") return user;
    const e = await findEnrolment(db, user.id, order.programme_slug);
    if (e) { await setEnrolmentOrder(db, e.id, order.id); return user; }
    const now = nowIso();
    const enrolmentId = crypto.randomUUID();
    await createEnrolment(db, { id: enrolmentId, student_id: user.id, programme_slug: order.programme_slug, instructor_id: null, status: "active",
      order_id: order.id, started_at: now, completed_at: null, created_at: now });
    // Record the programme's durations as they are today, so a later catalogue change never alters this student's period.
    const prog = await resolveProgramme(db, order.programme_slug);
    if (prog) await snapshotEnrolmentDurations(db, enrolmentId, prog.trainingMonths, prog.internshipMonths);
    return user;
  } catch (e) {
    // The LMS tables may not exist yet (migration 0003 not applied): payments must still succeed.
    console.error("ensureStudentAccount", e);
    return null;
  }
}

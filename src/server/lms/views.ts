// What each role may see of a user. Responses are built from these, never from raw rows.
import type { User } from "./data/users";
import { parseJsonCol } from "./api";

const photo = (u: User) => (u.photo_key ? `/api/app/files/photo/${u.id}` : null);
type Cert = { title: string; issuer: string | null; year: string | null; url: string | null };
// The instructor profile completed during onboarding (empty for other roles).
export const instructorProfile = (u: Pick<Partial<User>, "headline" | "achievements" | "certifications" | "languages" | "country_origin" | "country_residence">) => ({
  headline: u.headline ?? null, achievements: parseJsonCol<string[]>(u.achievements ?? null, []), certifications: parseJsonCol<Cert[]>(u.certifications ?? null, []),
  languages: parseJsonCol<string[]>(u.languages ?? null, []), countryOrigin: u.country_origin ?? null, countryResidence: u.country_residence ?? null,
});
const verified = (u: User) => u.role === "instructor" && (u.verification === undefined || u.verification === "approved");

// The signed-in user's own record.
export const selfView = (u: User) => ({
  id: u.id, email: u.email, role: u.role, fullName: u.full_name, phone: u.phone, bio: u.bio, photo: photo(u), studentNo: u.student_no, staffNo: u.staff_no ?? null,
  emailPrefs: parseJsonCol<{ reminders?: boolean; updates?: boolean }>(u.email_prefs ?? null, {}),
  specialization: u.specialization, qualifications: parseJsonCol<string[]>(u.qualifications, []), links: parseJsonCol<Record<string, string>>(u.links, {}),
  verification: u.verification ?? null, verified: verified(u), profileSubmittedAt: u.profile_submitted_at ?? null, ...instructorProfile(u),
});

// An instructor as a student sees them (their own assigned instructor only).
export const instructorPublic = (u: User) => ({
  id: u.id, fullName: u.full_name, email: u.email, bio: u.bio, photo: photo(u), specialization: u.specialization,
  qualifications: parseJsonCol<string[]>(u.qualifications, []), links: parseJsonCol<Record<string, string>>(u.links, {}),
  verified: verified(u), headline: u.headline ?? null, languages: parseJsonCol<string[]>(u.languages ?? null, []),
});

// A student as their instructor sees them.
export const studentForInstructor = (u: User) => ({ id: u.id, fullName: u.full_name, email: u.email, phone: u.phone, bio: u.bio, photo: photo(u), studentNo: u.student_no });

// Full record for admins.
export const adminView = (u: User) => ({ ...selfView(u), status: u.status, adminRole: u.role === "admin" ? (u.admin_role ?? null) : undefined, verification: u.verification ?? null, registrationId: u.registration_id, createdAt: u.created_at, lastLoginAt: u.last_login_at });

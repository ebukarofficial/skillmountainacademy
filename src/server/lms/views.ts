// What each role may see of a user. Responses are built from these, never from raw rows.
import type { User } from "./data/users";
import { parseJsonCol } from "./api";

const photo = (u: User) => (u.photo_key ? `/api/app/files/photo/${u.id}` : null);

// The signed-in user's own record.
export const selfView = (u: User) => ({
  id: u.id, email: u.email, role: u.role, fullName: u.full_name, phone: u.phone, bio: u.bio, photo: photo(u), studentNo: u.student_no,
  specialization: u.specialization, qualifications: parseJsonCol<string[]>(u.qualifications, []), links: parseJsonCol<Record<string, string>>(u.links, {}),
});

// An instructor as a student sees them (their own assigned instructor only).
export const instructorPublic = (u: User) => ({
  id: u.id, fullName: u.full_name, email: u.email, bio: u.bio, photo: photo(u), specialization: u.specialization,
  qualifications: parseJsonCol<string[]>(u.qualifications, []), links: parseJsonCol<Record<string, string>>(u.links, {}),
});

// A student as their instructor sees them.
export const studentForInstructor = (u: User) => ({ id: u.id, fullName: u.full_name, email: u.email, phone: u.phone, bio: u.bio, photo: photo(u), studentNo: u.student_no });

// Full record for admins.
export const adminView = (u: User) => ({ ...selfView(u), status: u.status, registrationId: u.registration_id, createdAt: u.created_at, lastLoginAt: u.last_login_at });

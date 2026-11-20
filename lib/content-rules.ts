// Validation rules for reviews and mentors (pure, so tests can import them directly).
import { PROGRAMMES } from "./config.ts";

export type Review = { name: string; programme: string; year: number; quote: string; photo?: string };
export type Mentor = { name: string; role: string; bio?: string; programmes?: string[]; photo?: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const file = (v: unknown) => { const f = str(v, 120); return /^[\w.-]+\.(webp|jpe?g|png|avif)$/i.test(f) ? f : undefined; };

export function cleanReviews(raw: unknown): Review[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const name = str(r?.name, 80), programme = str(r?.programme, 40), quote = str(r?.quote, 400), year = Number(r?.year);
    if (!name || !quote || !PROGRAMMES.some((p) => p.slug === programme) || !Number.isInteger(year) || year < 2021 || year > 2100) return [];
    return [{ name, programme, year, quote, photo: file(r?.photo) }];
  });
}
export function cleanMentors(raw: unknown): Mentor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    const name = str(m?.name, 80), role = str(m?.role, 80);
    if (!name || !role) return [];
    const programmes = Array.isArray(m?.programmes) ? m.programmes.filter((s: unknown) => PROGRAMMES.some((p) => p.slug === s)) : undefined;
    return [{ name, role, bio: str(m?.bio, 300) || undefined, programmes, photo: file(m?.photo) }];
  });
}

export const MIN_REVIEWS = 3;
export const showReviews = (list: Review[]) => list.length >= MIN_REVIEWS;
export const showMentors = (list: Mentor[]) => list.length > 0;

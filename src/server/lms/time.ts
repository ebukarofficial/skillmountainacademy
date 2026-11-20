// Africa/Lagos is UTC+1 all year (no daylight saving). Timetable times are Lagos wall-clock.
export const LAGOS_OFFSET_MIN = 60;
export const lagosDate = (d: Date) => new Date(d.getTime() + LAGOS_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "2026-11-23T09:00:00.000Z" -> "Monday 23 Nov, 10:00 (Lagos time)"
export function lagosText(iso: string) {
  const d = new Date(Date.parse(iso) + LAGOS_OFFSET_MIN * 60_000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${mon}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} (Lagos time)`;
}
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
// Lagos date + HH:MM -> UTC ISO
export const lagosToIso = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00Z`) - LAGOS_OFFSET_MIN * 60_000).toISOString();

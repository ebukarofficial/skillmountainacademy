// Input checks for the public forms. Everything is trimmed, length-limited and stripped of control characters.
import { ApiError } from "./http";

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\-.\s0-9]{7,30}$/;

export function text(v: unknown, max: number): string {
  return String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

export class Checker {
  errors: string[] = [];
  req(v: unknown, label: string, max = 120): string {
    const t = text(v, max);
    if (!t) this.errors.push(`${label} is required.`);
    return t;
  }
  opt(v: unknown, max = 120): string | null {
    return text(v, max) || null;
  }
  email(v: unknown, label = "Email address"): string {
    const t = text(v, 200).toLowerCase();
    if (!EMAIL_RE.test(t)) this.errors.push(`${label} is not valid.`);
    return t;
  }
  phone(v: unknown, label = "Phone number", required = true): string | null {
    const t = text(v, 30);
    if (!t) { if (required) this.errors.push(`${label} is required.`); return null; }
    if (!PHONE_RE.test(t)) this.errors.push(`${label} is not valid.`);
    return t;
  }
  oneOf<T extends string>(v: unknown, options: readonly T[], label: string): T {
    const t = text(v, 60) as T;
    if (!options.includes(t)) this.errors.push(`Please choose ${label}.`);
    return t;
  }
  int(v: unknown, min: number, max: number, label: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) this.errors.push(`${label} must be between ${min} and ${max}.`);
    return n;
  }
  done(): void {
    if (this.errors.length) throw new ApiError(400, "invalid", this.errors.join(" "));
  }
}

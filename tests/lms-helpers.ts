// Helpers for learning-platform tests: sign in through the real email-link flow and call the API as that user.
import assert from "node:assert/strict";
import type { startWorker } from "./worker-harness.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
export type Session = { cookie: string; get: (p: string) => Promise<Response>; send: (method: string, p: string, body?: unknown) => Promise<Response>; json: <T = Record<string, unknown>>(method: string, p: string, body?: unknown) => Promise<T> };

let ipN = 0;
// Requests a sign-in link, reads it from the (mocked) Resend email, confirms it, and returns the session cookie.
export async function signIn(w: W, email: string): Promise<Session> {
  const ip = `10.9.${Math.floor(ipN / 200)}.${(ipN++ % 200) + 1}`;
  const before = w.calls.length;
  const r = await w.post("/api/auth/request", { email, turnstileToken: "good-token" }, { "cf-connecting-ip": ip });
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok(await w.waitFor((c) => c.slice(before).some((x) => x.url.includes("api.resend.com") && x.body.includes(email))), `sign-in email to ${email}`);
  const mail = w.calls.slice(before).filter((x) => x.url.includes("api.resend.com") && x.body.includes(email)).at(-1)!;
  const token = JSON.parse(mail.body).html.match(/\/app\/confirm\/\?t=([\w-]+)/)[1];
  const v = await w.post("/api/auth/verify", { token }, { "cf-connecting-ip": ip });
  assert.equal(v.status, 200, await v.clone().text());
  const cookie = v.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return session(w, cookie, ip);
}

export function session(w: W, cookie: string, ip = "10.8.0.1"): Session {
  const send = (method: string, p: string, body?: unknown) => w.fetchApi(p, { method, headers: { cookie, "cf-connecting-ip": ip, origin: "https://skillmountainacademy.com", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    cookie, send, get: (p) => send("GET", p),
    json: async (method, p, body) => { const r = await send(method, p, body); const j = await r.json(); assert.ok(r.ok, `${method} ${p} -> ${r.status} ${JSON.stringify(j)}`); return j as never; },
  };
}

// Signs in the owner (bootstraps the admin) and creates users through the admin API.
const admins = new WeakMap<W, Promise<Session>>();
export async function setup(w: W) {
  if (!admins.has(w)) admins.set(w, signIn(w, "owner@example.com"));
  const admin = await admins.get(w)!;
  const make = async (role: string, email: string, fullName: string) => {
    const id = (await admin.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role, fullName, sendInvite: false })).user.id;
    // New instructors are candidates until approved in Recruitment, which needs the three required checks.
    if (role === "instructor") await approve(admin, id);
    return id;
  };
  return { admin, make };
}

export const REQUIRED = { identity: { done: true }, credentials: { done: true }, technical: { done: true } };
export const approve = (admin: Session, id: string) => admin.json("PATCH", `/api/app/admin/recruitment/${id}`, { checks: REQUIRED, stage: "approved", sendInvite: false });

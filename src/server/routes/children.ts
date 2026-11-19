// POST /api/children-enquiry: a parent's enquiry about the children's package. Saved to D1 and emailed to the owner.
import { PROGRAMMES } from "../../../lib/config.ts";
import type { AppEnv } from "../env";
import { ApiError, clientIp, json, nowIso, readJson, sameOrigin } from "../http";
import { Repo } from "../repo";
import { verifyTurnstile } from "../turnstile";
import { Checker } from "../validate";
import { esc, layout, sendEmail, table } from "../email";
import { mirrorToSheet } from "../sheet";
import { ipHash } from "./register";

export const CHILD_INTERESTS = [...PROGRAMMES.map((p) => p.name), "Not sure yet"];

export async function handleChildrenEnquiry(req: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  if (!sameOrigin(req)) throw new ApiError(403, "forbidden", "Please use the form on skillmountainacademy.com.");
  const b = await readJson(req, 8_000);
  if (b.website) return json({ ok: true });
  const repo = new Repo(env.DB);
  const c = new Checker();
  const e = {
    parent_name: c.req(b.parentName, "Your name", 120),
    email: c.email(b.email),
    phone: c.phone(b.phone, "Phone number") as string,
    child_age: c.int(b.childAge, 4, 17, "Your child's age"),
    programme_interest: c.oneOf(b.programme, CHILD_INTERESTS, "a programme of interest"),
    message: c.opt(b.message, 1000),
  };
  if (b.consent !== true) c.errors.push("Please confirm you are the child's parent or guardian.");
  c.done();
  await verifyTurnstile(env, b.turnstileToken, clientIp(req));
  const ipH = await ipHash(env, req);
  await repo.limitOrThrow(`child:${ipH}`, 5, 600);
  const row = { id: crypto.randomUUID(), created_at: nowIso(), ...e, ip_hash: ipH };
  await repo.createEnquiry(row);
  ctx.waitUntil((async () => {
    const rows: [string, string][] = [["Parent", e.parent_name], ["Email", e.email], ["Phone", e.phone], ["Child's age", String(e.child_age)], ["Interest", e.programme_interest], ["Message", e.message ?? ""]];
    await sendEmail(env, { to: env.ADMIN_EMAIL || "admission@skillmountainacademy.com", replyTo: e.email, subject: `Children's package enquiry: ${e.parent_name}`, html: layout("New children's package enquiry", table(rows)) });
    await sendEmail(env, { to: e.email, subject: "We received your enquiry", html: layout(`Thank you, ${esc(e.parent_name.split(" ")[0])}`, "<p>We received your enquiry about the Skill Mountain Academy children's package. We will contact you within two working days to talk about your child's goals and a customised plan.</p>") });
    await mirrorToSheet(env, { action: "children", ...e });
  })());
  return json({ ok: true });
}

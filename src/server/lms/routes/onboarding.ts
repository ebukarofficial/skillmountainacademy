// Instructor onboarding: a new instructor completes their profile and submits it; the Academy verifies and approves
// it in Recruitment, after which the verified badge shows next to their name.
//   GET  /api/app/instructor/onboarding         -> what is complete and what is still missing
//   POST /api/app/instructor/onboarding/submit  -> submit for verification (all required items must be present)
import { ApiError, nowIso } from "../../http";
import { ok, parseJsonCol, route } from "../api";
import { getUser, listUsers, updateUser, type User } from "../data/users";
import { notify } from "../notify";
import { selfView } from "../views";

const SOCIAL = ["linkedin", "x", "facebook", "portfolio"] as const;

export function onboardingChecklist(u: User) {
  const links = parseJsonCol<Record<string, string>>(u.links, {});
  const certs = parseJsonCol<{ url?: string | null }[]>(u.certifications ?? null, []);
  const items: [string, string, boolean][] = [
    ["photo", "A passport-style profile photo", !!u.photo_key],
    ["headline", "A one-line professional citation", !!u.headline?.trim()],
    ["bio", "A biography of at least 80 characters", (u.bio ?? "").trim().length >= 80],
    ["specialization", "Your discipline or specialisation", !!u.specialization?.trim()],
    ["countries", "Country of origin and country of residence", !!u.country_origin && !!u.country_residence],
    ["languages", "At least one language you teach in", parseJsonCol<string[]>(u.languages ?? null, []).length > 0],
    ["links", "At least one of LinkedIn, X (Twitter), Facebook or portfolio", SOCIAL.some((k) => !!links[k])],
    ["achievements", "At least one achievement", parseJsonCol<string[]>(u.achievements ?? null, []).length > 0],
    ["certifications", "At least one certification with a public verification link", certs.some((c) => !!c.url)],
  ];
  return { items: items.map(([key, label, done]) => ({ key, label, done })), complete: items.every(([, , d]) => d) };
}

route("GET", "/api/app/instructor/onboarding", ["instructor"], async (c) => {
  const u = (await getUser(c.db, c.user.id))!;
  return ok({ ...onboardingChecklist(u), verification: u.verification ?? "approved", submittedAt: u.profile_submitted_at ?? null });
});

route("POST", "/api/app/instructor/onboarding/submit", ["instructor"], async (c) => {
  const u = (await getUser(c.db, c.user.id))!;
  if (u.verification === "approved" || u.verification === undefined) throw new ApiError(400, "already_verified", "Your profile is already verified.");
  const list = onboardingChecklist(u);
  if (!list.complete) throw new ApiError(400, "incomplete", `Please complete: ${list.items.filter((i) => !i.done).map((i) => i.label.toLowerCase()).join("; ")}.`);
  const now = nowIso();
  const first = !u.profile_submitted_at;
  await updateUser(c.db, u.id, { profile_submitted_at: now, ...(u.verification === "application_received" ? { verification: "under_review" } : {}) });
  await c.audit("onboarding.submit", "user", u.id, { first });
  const admins = (await listUsers(c.db, { role: "admin", status: "active", limit: 50, offset: 0 })).map((a) => ({ id: a.id, email: a.email, name: a.full_name }));
  c.exec.waitUntil(notify(c.env, c.db, admins, { kind: "recruitment.submitted", title: `Instructor profile ${first ? "submitted" : "updated"}: ${u.full_name}`,
    body: `${u.full_name} (${u.specialization ?? "instructor"}) has ${first ? "submitted" : "resubmitted"} their profile for verification. Review it in Recruitment.`, link: "/app/?tab=recruitment" }));
  return ok({ user: selfView((await getUser(c.db, u.id))!), submittedAt: now });
});

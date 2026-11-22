// Security settings visible to a Super Administrator (Stage 2).
//   GET /api/app/admin/settings/retention   retention categories, current settings, what is never automated, security status
//   PUT /api/app/admin/settings/retention   {<category>: {on, days}} turn categories on or off and set periods
import { ApiError } from "../../http";
import { ipKeySource } from "../../privacy";
import { ok, requireStrongAuth, route } from "../api";
import { mfaKeyUsable } from "../mfa-crypto";
import { CATEGORIES, cleanSettings, LAST_RUN_KEY, loadSettings, NOT_AUTOMATED, saveSettings, type LastRun } from "../retention";
import { getSetting } from "../data/engagement";
import { policyFor } from "../session-policy";

route("GET", "/api/app/admin/settings/retention", ["admin"], async (c) => {
  const settings = await loadSettings(c.db);
  return ok({
    categories: Object.entries(CATEGORIES).map(([id, k]) => ({ id, label: k.label, group: k.group, defaultDays: k.defaultDays, minDays: k.minDays, defaultOn: k.defaultOn, ...settings[id as keyof typeof settings] })),
    notAutomated: NOT_AUTOMATED,
    lastRun: await getSetting<LastRun>(c.db, LAST_RUN_KEY),
    security: {
      ipHashKey: await ipKeySource(c.env), // "secret" (recommended), "d1", "ephemeral" or "missing"; never the key itself
      mfaConfigured: await mfaKeyUsable(c.env.MFA_ENCRYPTION_KEY),
      mfaEnforced: c.env.MFA_ENFORCE_ADMINS === "true",
      sessions: { student: policyFor("student", c.env), instructor: policyFor("instructor", c.env), admin: policyFor("admin", c.env) },
    },
  });
});

route("PUT", "/api/app/admin/settings/retention", ["admin"], async (c) => {
  const b = await c.body<Record<string, { on?: unknown; days?: unknown }>>();
  for (const id of Object.keys(b)) if (!(id in CATEGORIES)) throw new ApiError(400, "invalid", `Unknown category: ${id}.`);
  const before = await loadSettings(c.db);
  const next = cleanSettings({ ...before, ...b });
  // Stage 2C: the security audit log's retention is the owner's decision, from a session that passed the authenticator
  // code. (The database also refuses to delete any audit entry younger than 365 days: migration 0010.)
  if (next.audit_log.on !== before.audit_log.on || next.audit_log.days !== before.audit_log.days) {
    if (!c.isOwner) { await c.audit("settings.retention_refused", "settings", "retention", { category: "audit_log" }); throw new ApiError(403, "forbidden", "Only the owner can change how long the security audit log is kept."); }
    await requireStrongAuth(c, "settings.retention.audit_log");
  }
  await saveSettings(c.db, next, c.user.id);
  await c.audit("settings.retention", "settings", "retention", { from: before, to: next });
  return ok({ settings: next });
});

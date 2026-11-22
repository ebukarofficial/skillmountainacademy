// Security settings visible to a Super Administrator (Stage 2).
//   GET /api/app/admin/settings/retention   retention categories, current settings, what is never automated, security status
//   PUT /api/app/admin/settings/retention   {<category>: {on, days}} turn categories on or off and set periods
import { ApiError } from "../../http";
import { ipKeySource } from "../../privacy";
import { ok, route } from "../api";
import { mfaKeyUsable } from "../mfa-crypto";
import { CATEGORIES, cleanSettings, loadSettings, NOT_AUTOMATED, saveSettings } from "../retention";
import { policyFor } from "../session-policy";

route("GET", "/api/app/admin/settings/retention", ["admin"], async (c) => {
  const settings = await loadSettings(c.db);
  return ok({
    categories: Object.entries(CATEGORIES).map(([id, k]) => ({ id, label: k.label, group: k.group, defaultDays: k.defaultDays, minDays: k.minDays, defaultOn: k.defaultOn, ...settings[id as keyof typeof settings] })),
    notAutomated: NOT_AUTOMATED,
    security: {
      ipHashKey: await ipKeySource(c.env), // "secret" (recommended), "kv" or "ephemeral"; never the key itself
      mfaConfigured: await mfaKeyUsable(c.env.MFA_ENCRYPTION_KEY),
      mfaEnforced: c.env.MFA_ENFORCE_ADMINS === "true",
      sessions: { student: policyFor("student", c.env), instructor: policyFor("instructor", c.env), admin: policyFor("admin", c.env) },
    },
  });
});

route("PUT", "/api/app/admin/settings/retention", ["admin"], async (c) => {
  const b = await c.body<Record<string, { on?: unknown; days?: unknown }>>();
  for (const id of Object.keys(b)) if (!(id in CATEGORIES)) throw new ApiError(400, "invalid", `Unknown category: ${id}.`);
  const next = cleanSettings({ ...(await loadSettings(c.db)), ...b });
  await saveSettings(c.db, next, c.user.id);
  await c.audit("settings.retention", "settings", "retention", next);
  return ok({ settings: next });
});

// Administrator two-step sign-in with an authenticator app (TOTP) and one-time recovery codes (Stage 2).
//
//   GET  /api/auth/mfa/status                 admin: is it on, how many recovery codes are left, is the server configured
//   POST /api/auth/mfa/setup                  admin: a new secret to add to the app (replaces an unfinished setup)
//   POST /api/auth/mfa/enable  {code}         admin: confirms the app works; returns 10 recovery codes ONCE; signs out other devices
//   POST /api/auth/mfa/verify  {code | recoveryCode}  the second step after the email link (the only route a pending session can use)
//   POST /api/auth/mfa/recovery-codes {code}  admin: new recovery codes (the old ones stop working)
//   POST /api/auth/mfa/disable {code}         admin: turns it off (needs a current code); signs out other devices
//   POST /api/app/admin/users/:id/mfa-reset   Super Administrator: removes another administrator's factor (lost phone)
//
// Every success and failure is written to the audit log. Codes are rate limited per account and per network address, a
// used 30-second code cannot be used again, and each recovery code works once. Secrets are encrypted with
// MFA_ENCRYPTION_KEY; without that secret the feature reports "not configured" instead of storing anything in plain text.
import { button, layout, sendEmail } from "../../email";
import { ApiError, nowIso, sha256 } from "../../http";
import { Repo } from "../../repo";
import { clearCookie, ok, requireStrongAuth, route, publicRoute, type Ctx } from "../api";
import { getSetting, putSetting } from "../data/engagement";
import { activateFactor, activeFactor, claimStep, deleteFactor, getFactor, recoveryLeft, replaceRecoveryCodes, savePendingFactor, useRecoveryCode } from "../data/mfa";
import { createSession, deleteOtherSessions, deleteSession, deleteUserSessions, getUser, markSessionMfaVerified, setMfaRequired } from "../data/users";
import { decryptSecret, encryptSecret, hashRecovery, mfaKeyUsable, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from "../mfa-crypto";
import { accountChangeRefusal, canManageAdmins } from "../permissions";
import { isBootstrapped } from "../data/owner";
import { newSessionToken, sessionCookie } from "./auth";
import { siteUrl } from "../../env";

const PER_ACCOUNT = 5;      // code attempts per account per 10 minutes
const PER_ADDRESS = 20;     // code attempts per network address per 10 minutes
const PER_DAY = 20;         // failed attempts per account per day before the pending session is ended

async function requireConfigured(c: Ctx) {
  if (!(await mfaKeyUsable(c.env.MFA_ENCRYPTION_KEY))) throw new ApiError(503, "mfa_not_configured", "Two-step sign-in is not set up on the server yet (MFA_ENCRYPTION_KEY).");
}
async function limit(c: Ctx, userId: string) {
  const repo = new Repo(c.db);
  await repo.limitOrThrow(`mfa:${userId}`, PER_ACCOUNT, 600);
  await repo.limitOrThrow(`mfa-ip:${c.ipHash}`, PER_ADDRESS, 600);
}
// Checks a TOTP code against the active (or pending) factor and claims its time step so it cannot be replayed.
async function checkCode(c: Ctx, userId: string, code: string, which: "active" | "pending"): Promise<number | null> {
  const f = await getFactor(c.db, userId);
  if (!f || f.status !== which) return null;
  const secret = await decryptSecret(c.env.MFA_ENCRYPTION_KEY, f.secret_enc);
  const step = await verifyTotp(secret, String(code ?? "").replace(/\s/g, ""), Date.now(), f.last_step);
  if (step === null) return null;
  if (which === "active" && !(await claimStep(c.db, userId, step))) return null; // the same code used twice at once
  return step;
}
async function notify(c: Ctx, userId: string, title: string, text: string) {
  const u = await getUser(c.db, userId);
  if (!u) return;
  c.exec.waitUntil(sendEmail(c.env, { to: u.email, subject: `Security notice: ${title}`, html: layout(`Dear ${u.full_name.split(" ")[0]}`,
    `<p>${text}</p><p>If this was not you, contact the Academy's Super Administrator immediately.</p>${button(`${siteUrl(c.env)}/app/login/`, "Go to administration")}`,
    { headline: title, kind: "admin" }) }).catch(() => undefined));
}

route("GET", "/api/auth/mfa/status", ["admin"], async (c) => {
  const f = await getFactor(c.db, c.user.id);
  return ok({ configured: await mfaKeyUsable(c.env.MFA_ENCRYPTION_KEY), enabled: f?.status === "active", pendingSetup: f?.status === "pending",
    recoveryCodesLeft: f?.status === "active" ? await recoveryLeft(c.db, c.user.id) : 0, enforced: c.env.MFA_ENFORCE_ADMINS === "true" });
});

route("POST", "/api/auth/mfa/setup", ["admin"], async (c) => {
  await requireConfigured(c);
  await new Repo(c.db).limitOrThrow(`mfa-setup:${c.user.id}`, 10, 3600);
  if (await activeFactor(c.db, c.user.id)) throw new ApiError(409, "already_enabled", "Two-step sign-in is already on. Turn it off first to move it to a new app.");
  const secret = newTotpSecret();
  await savePendingFactor(c.db, c.user.id, await encryptSecret(c.env.MFA_ENCRYPTION_KEY, secret), nowIso());
  await c.audit("mfa.setup_started", "user", c.user.id);
  return ok({ secret, otpauthUrl: otpauthUrl(secret, c.user.email) });
});

route("POST", "/api/auth/mfa/enable", ["admin"], async (c) => {
  await requireConfigured(c);
  await limit(c, c.user.id);
  const b = await c.body<{ code?: string }>();
  const step = await checkCode(c, c.user.id, String(b.code ?? ""), "pending");
  if (step === null) { await c.audit("mfa.enable_failed", "user", c.user.id); throw new ApiError(400, "invalid_code", "That code is not right. Check the time on your phone and try the newest code."); }
  const at = nowIso();
  await activateFactor(c.db, c.user.id, step, at);
  await setMfaRequired(c.db, c.user.id, false);
  const codes = newRecoveryCodes();
  await replaceRecoveryCodes(c.db, c.user.id, await Promise.all(codes.map(hashRecovery)), at);
  if (c.sessionHash) { await markSessionMfaVerified(c.db, c.sessionHash, at); await deleteOtherSessions(c.db, c.user.id, c.sessionHash); }
  await c.audit("mfa.enabled", "user", c.user.id);
  await notify(c, c.user.id, "two-step sign-in turned on", "Two-step sign-in with an authenticator app was turned on for your administrator account. Other devices were signed out.");
  return ok({ enabled: true, recoveryCodes: codes });
});

// The second step after the email link. Only a pending session can use it; success replaces the session token.
publicRoute("POST", "/api/auth/mfa/verify", async (c) => {
  if (!c.user || !c.sessionHash || !c.session?.mfa_pending) throw new ApiError(401, "unauthenticated", "Please sign in again.");
  const user = c.user;
  await limit(c as Ctx, user.id);
  const b = await c.body<{ code?: string; recoveryCode?: string }>();
  let how: "code" | "recovery" | null = null;
  if (b.recoveryCode) {
    if (await useRecoveryCode(c.db, user.id, await hashRecovery(String(b.recoveryCode)), nowIso())) how = "recovery";
  } else if (b.code) {
    await requireConfigured(c as Ctx);
    if ((await checkCode(c as Ctx, user.id, String(b.code), "active")) !== null) how = "code";
  }
  const audit = (action: string, detail?: unknown) => (c as Ctx).audit(action, "user", user.id, detail);
  if (!how) {
    await audit("mfa.verify_failed");
    // Too many failures in a day: end this pending session so the attacker must also pass the email link again.
    if (!(await new Repo(c.db).hit(`mfa-fail-day:${user.id}`, PER_DAY, 86400))) {
      await deleteSession(c.db, c.sessionHash);
      await audit("mfa.locked");
      await notify(c as Ctx, user.id, "sign-in blocked", "Too many wrong authenticator codes were entered for your account today. The sign-in attempt was ended.");
      throw new ApiError(429, "mfa_locked", "Too many wrong codes. Please request a new sign-in link later.");
    }
    throw new ApiError(400, "invalid_code", "That code is not right. Try the newest code from your app, or a recovery code.");
  }
  // Privilege change: issue a fresh session token instead of upgrading the old one.
  const fresh = newSessionToken();
  const now = nowIso();
  const s = c.session;
  await createSession(c.db, { token_hash: await sha256(`s|${fresh}`), user_id: user.id, created_at: now, expires_at: s.expires_at, last_seen_at: now, user_agent: (c.req.headers.get("user-agent") || "").slice(0, 200), mfa_pending: 0 });
  await markSessionMfaVerified(c.db, await sha256(`s|${fresh}`), now);
  await deleteSession(c.db, c.sessionHash);
  await audit(how === "recovery" ? "mfa.recovery_used" : "mfa.verified");
  if (how === "recovery") await notify(c as Ctx, user.id, "recovery code used", `A recovery code was used to sign in. You have ${await recoveryLeft(c.db, user.id)} left. Create new codes in Security if you are running low.`);
  const maxAge = Math.max(60, Math.floor((Date.parse(s.expires_at) - Date.now()) / 1000));
  return ok({ verified: true }, 200, { "set-cookie": sessionCookie(fresh, maxAge) });
});

route("POST", "/api/auth/mfa/recovery-codes", ["admin"], async (c) => {
  await requireConfigured(c);
  await limit(c, c.user.id);
  const b = await c.body<{ code?: string }>();
  if ((await checkCode(c, c.user.id, String(b.code ?? ""), "active")) === null) { await c.audit("mfa.codes_failed", "user", c.user.id); throw new ApiError(400, "invalid_code", "Enter a current code from your authenticator app."); }
  const codes = newRecoveryCodes();
  await replaceRecoveryCodes(c.db, c.user.id, await Promise.all(codes.map(hashRecovery)), nowIso());
  await c.audit("mfa.codes_regenerated", "user", c.user.id);
  await notify(c, c.user.id, "new recovery codes", "New recovery codes were created for your administrator account. The previous codes no longer work.");
  return ok({ recoveryCodes: codes });
});

route("POST", "/api/auth/mfa/disable", ["admin"], async (c) => {
  await requireConfigured(c);
  await limit(c, c.user.id);
  const b = await c.body<{ code?: string }>();
  if ((await checkCode(c, c.user.id, String(b.code ?? ""), "active")) === null) { await c.audit("mfa.disable_failed", "user", c.user.id); throw new ApiError(400, "invalid_code", "Enter a current code from your authenticator app."); }
  await deleteFactor(c.db, c.user.id);
  if (c.sessionHash) await deleteOtherSessions(c.db, c.user.id, c.sessionHash);
  await c.audit("mfa.disabled", "user", c.user.id);
  await notify(c, c.user.id, "two-step sign-in turned off", "Two-step sign-in was turned off for your administrator account. Other devices were signed out.");
  return ok({ enabled: false });
});

// Lost phone and no recovery codes: a Super Administrator removes the factor; the administrator signs in by email and
// sets it up again. Nobody can reset their own factor this way.
route("POST", "/api/app/admin/users/:id/mfa-reset", ["admin"], async (c) => {
  const u = await getUser(c.db, c.params.id);
  if (!u || u.role !== "admin") throw new ApiError(404, "not_found", "Administrator not found.");
  if (u.id === c.user.id) throw new ApiError(400, "self", "You cannot reset your own two-step sign-in. Another Super Administrator must do it, or the owner's break-glass procedure.");
  const booted = await isBootstrapped(c.db);
  const why = accountChangeRefusal(c.user, u, c.owner, booted);
  if (why || !canManageAdmins(c.user, c.owner, booted)) { await c.audit("mfa.reset_refused", "user", u.id, { why }); throw new ApiError(403, "forbidden", why ?? "Only the owner or a Super Administrator can reset two-step sign-in."); }
  await requireStrongAuth(c, "mfa.reset", u.id);
  await deleteFactor(c.db, u.id);
  await deleteUserSessions(c.db, u.id);
  await setMfaRequired(c.db, u.id, true); // they must enrol again before using administration
  await c.audit("mfa.reset_by_admin", "user", u.id);
  await notify(c, u.id, "two-step sign-in reset", "A Super Administrator removed two-step sign-in from your account and signed you out everywhere. Sign in by email and set it up again.");
  return ok({ reset: true });
});


// Owner break-glass (Stage 2B). For the case where the owner has lost both the authenticator and the recovery codes and
// there is no other Super Administrator. It requires BOTH:
//   1. the owner's mailbox (a signed-in owner session from an email link; the pending MFA step is enough), and
//   2. control of the Cloudflare account: someone with that access sets the one-time secret OWNER_RECOVERY_TOKEN
//      (npx wrangler secret put OWNER_RECOVERY_TOKEN), which is entered here and then deleted.
// Success removes the owner's factor and recovery codes, signs the owner out everywhere, records the token as used (its
// hash), marks the owner as having to enrol again, writes an audit entry and emails the owner. Unlike editing the
// database by hand, every step is audited.
publicRoute("POST", "/api/auth/owner-recovery", async (c) => {
  const ctx = c as Ctx;
  if (!c.user || !ctx.isOwner) throw new ApiError(403, "forbidden", "Sign in with the owner's email link first.");
  await new Repo(c.db).limitOrThrow(`owner-recovery:${c.user.id}`, 3, 86400);
  const secret = c.env.OWNER_RECOVERY_TOKEN || "";
  const b = await c.body<{ token?: string }>();
  const given = String(b.token ?? "");
  const used = (await getSetting<string[]>(c.db, "owner_recovery_used")) ?? [];
  const givenHash = await sha256(`orc|${given}`);
  const okToken = secret.length >= 32 && safeEq(givenHash, await sha256(`orc|${secret}`)) && !used.includes(givenHash);
  if (!okToken) { await ctx.audit("mfa.owner_break_glass_failed", "user", c.user.id); throw new ApiError(400, "invalid", "The recovery token is not valid, has been used, or is not set."); }
  await putSetting(c.db, "owner_recovery_used", [...used, givenHash].slice(-20), c.user.id, nowIso());
  await deleteFactor(c.db, c.user.id);
  await setMfaRequired(c.db, c.user.id, true);
  await deleteUserSessions(c.db, c.user.id);
  await ctx.audit("mfa.owner_break_glass", "user", c.user.id);
  await notify(ctx, c.user.id, "owner two-step sign-in reset", "The owner break-glass procedure removed two-step sign-in from your account. Sign in by email and set it up again now, then delete the OWNER_RECOVERY_TOKEN secret.");
  return ok({ reset: true, next: "Sign in again by email, set up two-step sign-in, then run: npx wrangler secret delete OWNER_RECOVERY_TOKEN" }, 200, { "set-cookie": clearCookie });
});

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

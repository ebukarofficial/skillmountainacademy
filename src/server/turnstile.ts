// Cloudflare Turnstile check: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
import type { AppEnv } from "./env";
import { ApiError, notConfigured } from "./http";

export async function verifyTurnstile(env: AppEnv, token: unknown, ip: string): Promise<void> {
  if (!env.TURNSTILE_SECRET) throw notConfigured("Form protection");
  if (typeof token !== "string" || !token || token.length > 2048) {
    throw new ApiError(400, "turnstile", "Please complete the security check and try again.");
  }
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  body.append("remoteip", ip);
  let ok = false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const j = (await r.json()) as { success?: boolean };
    ok = j.success === true;
  } catch {
    ok = false;
  }
  if (!ok) throw new ApiError(400, "turnstile", "The security check failed. Please refresh the page and try again.");
}

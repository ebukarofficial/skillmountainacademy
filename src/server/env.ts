// What the Worker receives from Cloudflare. Every binding and secret is optional on purpose: until the owner has
// created the database and set the secrets, the API answers with a clear "not set up yet" message instead of crashing.
export interface AppEnv {
  ASSETS: Fetcher;
  DB?: D1Database;
  KV?: KVNamespace;
  // Public settings (wrangler.jsonc "vars")
  SITE_URL?: string;
  EMAIL_FROM?: string;
  ADMIN_EMAIL?: string;
  CLASS_BOOKING_URL?: string;
  ADMIN_EMAILS?: string;   // comma-separated; these addresses become admins on their first sign-in
  AI_MODEL?: string;       // Workers AI model for the learning assistant
  // Learning platform bindings
  BUCKET?: R2Bucket;       // uploads (assignments, resources, photos)
  AI?: Ai;                 // Workers AI
  // Secrets (npx wrangler secret put NAME)
  TURNSTILE_SECRET?: string;
  PAYSTACK_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  HOLD_SIGNING_KEY?: string;
  IP_HASH_SALT?: string;          // Stage 2: secret used ONLY to pseudonymise client IP addresses (HMAC-SHA256)
  MFA_ENCRYPTION_KEY?: string;    // Stage 2: base64 of 32 random bytes; encrypts administrator authenticator secrets
  OWNER_RECOVERY_TOKEN?: string;  // Stage 2B: one-time break-glass secret for the owner's two-step sign-in; set only when needed, then delete
  // Plain vars (wrangler.jsonc "vars")
  OWNER_EMAIL?: string;           // Stage 2B/2C: the platform owner; bound to one account at the owner's one-time set-up
  IP_HASH_STRICT?: string;        // Stage 2B: "true" = refuse to run without IP_HASH_SALT (recommended once the secret is set)
  // Stage 2 session and MFA switches (plain vars). Unset = today's behaviour for staff; see docs/SMA_STAGE_2C_FINAL_SECURITY_GATE.md.
  MFA_ENFORCE_ADMINS?: string;    // "true" = every administrator must set up an authenticator app before using the dashboard
  ADMIN_IDLE_MINUTES?: string;    // e.g. "15"
  ADMIN_SESSION_HOURS?: string;   // absolute administrator session lifetime, e.g. "12"
  INSTRUCTOR_IDLE_MINUTES?: string; // e.g. "60"
  INSTRUCTOR_SESSION_HOURS?: string; // absolute instructor session lifetime, e.g. "24"
  SHEET_WEBHOOK_URL?: string;
}

export const siteUrl = (env: AppEnv) => (env.SITE_URL || "https://skillmountainacademy.com").replace(/\/$/, "");

// Which features can run right now. Shown by GET /api/status and used by the website to pick a flow.
export function readiness(env: AppEnv) {
  return {
    database: !!env.DB,
    turnstile: !!env.TURNSTILE_SECRET,
    payments: !!env.PAYSTACK_SECRET_KEY,
    email: !!env.RESEND_API_KEY,
    holds: !!env.HOLD_SIGNING_KEY && !!env.DB,
    sheetMirror: !!env.SHEET_WEBHOOK_URL,
    uploads: !!env.BUCKET,
    ai: !!env.AI,
  };
}

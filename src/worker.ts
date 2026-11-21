// Skill Mountain Academy Worker. Only /api/* reaches this code (wrangler.jsonc "run_worker_first"); every other
// address is the static website, served by Cloudflare directly from the "out" folder.
import { FLAGS } from "../lib/config.ts";
import { readiness, type AppEnv } from "./server/env";
import { ApiError, fail, json } from "./server/http";
import { Repo } from "./server/repo";
import { runSchedule } from "./server/cron";
import { handleRegister } from "./server/routes/register";
import { handleChildrenEnquiry } from "./server/routes/children";
import { handleGeo } from "./server/routes/geo";
import { handleHold } from "./server/routes/hold";
import { handleOrderStatus, handlePayLink, handleWebhook } from "./server/routes/payments";
import { handleLms } from "./server/lms";
import { onEmailFailure } from "./server/email";
import { logError } from "./server/lms/data/users";

// Every email that fails is written to the error log (Admin > Platform > Recent errors) with Resend's reason.
const recordEmailFailures = (env: AppEnv) => { if (env.DB) onEmailFailure((subject, reason) => logError(env.DB!, "email", `"${subject}" was not sent. ${reason}`)); };

type Handler = (req: Request, env: AppEnv, ctx: ExecutionContext) => Promise<Response>;

async function status(_req: Request, env: AppEnv): Promise<Response> {
  const ready = readiness(env);
  if (env.DB) ready.database = await new Repo(env.DB).tablesReady();
  return json({ ok: true, ready, flags: FLAGS }, 200, { "cache-control": "no-store" });
}

const ROUTES: Record<string, Partial<Record<"GET" | "POST", Handler>>> = {
  "/api/status": { GET: status },
  "/api/geo": { GET: handleGeo },
  "/api/hold": { GET: handleHold },
  "/api/register": { POST: handleRegister },
  "/api/children-enquiry": { POST: handleChildrenEnquiry },
  "/api/order": { GET: handleOrderStatus },
  "/api/pay": { GET: handlePayLink },
  "/api/paystack/webhook": { POST: handleWebhook },
};

export default {
  async fetch(req: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    recordEmailFailures(env); // safety net: the website
    const path = url.pathname.replace(/\/+$/, "");
    const route = ROUTES[path];
    const handler = route?.[req.method as "GET" | "POST"];
    try {
      if (!route || !handler) {
        // Learning platform routes (/api/auth/*, /api/me, /api/app/*).
        const lms = await handleLms(req, env, ctx);
        if (lms) return lms;
        return fail(route ? new ApiError(405, "method_not_allowed", "Method not allowed.") : new ApiError(404, "not_found", "Unknown address."));
      }
      return await handler(req, env, ctx);
    } catch (e) {
      if (e instanceof ApiError) return fail(e);
      console.error("unhandled", path, e);
      return fail(new ApiError(500, "server_error", "Something went wrong on our side. Please try again, or contact us on WhatsApp."));
    }
  },

  async scheduled(controller: ScheduledController, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    recordEmailFailures(env);
    ctx.waitUntil(runSchedule(env, new Date(controller.scheduledTime), controller.cron).then((r) => console.log("schedule", JSON.stringify(r))));
  },
} satisfies ExportedHandler<AppEnv>;

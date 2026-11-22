// POST /api/csp-report: receives Content-Security-Policy violation reports from browsers (Stage 2). Only the violated
// directive, the blocked origin (not the full URL) and the page path are kept, in error_log, rate limited per address.
// Nothing from the report is ever executed or echoed back.
import type { AppEnv } from "../env";
import { clientIp, json, nowIso } from "../http";
import { ipPseudonym } from "../privacy";
import { Repo } from "../repo";

const origin = (v: unknown) => { try { const u = new URL(String(v)); return u.origin; } catch { return String(v ?? "").slice(0, 40); } };
const path = (v: unknown) => { try { return new URL(String(v)).pathname.slice(0, 100); } catch { return ""; } };

export async function handleCspReport(req: Request, env: AppEnv): Promise<Response> {
  if (!env.DB) return new Response(null, { status: 204 });
  const raw = (await req.text().catch(() => "")).slice(0, 10_000);
  const repo = new Repo(env.DB);
  if (!(await repo.hit(`csp:${await ipPseudonym(env, clientIp(req))}`, 30, 600))) return new Response(null, { status: 204 });
  let r: Record<string, unknown> = {};
  try { const j = JSON.parse(raw); r = (j["csp-report"] ?? j) as Record<string, unknown>; } catch { return json({ ok: false }, 400); }
  const line = `${String(r["effective-directive"] ?? r["violated-directive"] ?? "?").slice(0, 40)} blocked ${origin(r["blocked-uri"])} on ${path(r["document-uri"])}`;
  await env.DB.prepare("INSERT INTO error_log (id, at, route, message) VALUES (?1, ?2, 'csp', ?3)").bind(crypto.randomUUID(), nowIso(), line).run().catch(() => undefined);
  return new Response(null, { status: 204 });
}

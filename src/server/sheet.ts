// Mirrors records to the existing Google Sheet through the Apps Script web app, so the owner can still see them
// there until the admin dashboard exists. D1 is the primary store; a failed mirror never fails a request.
import type { AppEnv } from "./env";

export async function mirrorToSheet(env: AppEnv, data: Record<string, unknown>): Promise<void> {
  if (!env.SHEET_WEBHOOK_URL) return;
  try {
    const r = await fetch(env.SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ source: "worker", ...data }),
      redirect: "follow",
    });
    if (!r.ok) console.error("sheet mirror", r.status);
  } catch (e) {
    console.error("sheet mirror failed", e);
  }
}

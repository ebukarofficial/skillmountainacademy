// Learning-platform jobs run by the 5-minute cron. Filled in by LMS phase 2 (sessions and reminders).
import type { AppEnv } from "../env";
import { purgeSessions, purgeTokens } from "./data/users";

export async function runLmsSchedule(env: AppEnv, now: Date, daily: boolean) {
  const db = env.DB!;
  const out: Record<string, number> = {};
  if (daily) {
    const iso = now.toISOString();
    out.tokens = await purgeTokens(db, iso).catch(() => 0);
    out.sessions = await purgeSessions(db, iso).catch(() => 0);
  }
  return out;
}

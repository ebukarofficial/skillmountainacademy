// Moves the existing owner account to a new login email in the LOCAL D1 database (Institutional Dashboard stage).
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/owner/transition-email.mts --from old@example.com --to new@example.com [--persist-to <dir>]
// --persist-to is the same directory given to `wrangler dev --persist-to` (default: wrangler's own .wrangler/state).
// Keeps the owner's user id, owner record, authenticator and history; creates no account. See src/server/owner-transition.ts.
//
// Atomic: every statement runs in ONE D1 batch (a single transaction) through wrangler's local platform proxy, with
// remote bindings switched OFF, so this tool cannot reach a Cloudflare (production) database. Any failure rolls the
// whole transition back, including the trigger drop. --remote is refused. The production transition is a separate,
// owner-approved procedure (docs/INSTITUTIONAL_DASHBOARD_REDESIGN_REPORT.md, section 9).
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { ownerEmailTransitionSql, TRANSITION_GUARD_ERROR } from "../../src/server/owner-transition.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
if (process.argv.includes("--remote")) {
  console.error("Refused: this tool changes the LOCAL database only. The production owner transition needs a backup, the Owner's approval and a change of OWNER_EMAIL in wrangler.jsonc, done together (see the dashboard redesign report, section 9).");
  process.exit(1);
}
const from = arg("--from")?.toLowerCase(), to = arg("--to")?.toLowerCase(), persistTo = arg("--persist-to");
if (!from || !to) { console.error("Usage: --from <current owner email> --to <new owner email> [--persist-to <dir>]"); process.exit(1); }
const sql = ownerEmailTransitionSql(from, to, new Date().toISOString()); // validates both addresses first

// The few D1 methods used here (the workers types are not loaded for scripts).
type Stmt = { bind(...v: unknown[]): Stmt; first<T = Record<string, unknown>>(): Promise<T | null> };
type LocalD1 = { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown> };
const proxy = await getPlatformProxy<{ DB: LocalD1 }>({ remoteBindings: false, persist: persistTo ? { path: join(persistTo, "v3") } : true });
const db = proxy.env.DB;
const state = () => db.prepare("SELECT r.user_id, r.email AS record_email, u.email AS account_email FROM owner_record r JOIN users u ON u.id = r.user_id WHERE r.id = 1")
  .first<{ user_id: string; record_email: string; account_email: string }>();
let code = 0;
try {
  const before = await state();
  if (!before) { console.error("Refused: there is no bootstrapped owner in this local database. Nothing was changed."); code = 1; }
  else if (before.record_email === to && before.account_email === to) console.log(`Already done: owner account ${before.user_id} signs in as ${to}. Nothing was changed.`);
  else if (before.record_email !== from) { console.error(`Refused: the owner record holds ${before.record_email}, not ${from}. Nothing was changed.`); code = 1; }
  else if (await db.prepare("SELECT 1 FROM users WHERE lower(email) = ?1").bind(to).first()) { console.error(`Refused: ${to} already belongs to an account; it is never taken over. Nothing was changed.`); code = 1; }
  else {
    try { await db.batch(sql.map((s) => db.prepare(s))); }
    catch (e) {
      console.error(TRANSITION_GUARD_ERROR.test(String((e as Error)?.message ?? e)) ? "Refused by the transition guard: the expected result did not hold. The whole transition was rolled back." : `The transition failed and was rolled back as a whole: ${String((e as Error)?.message ?? e)}`);
      code = 1;
    }
    const after = await state();
    const trigger = await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'owner_record_no_update'").first();
    if (!trigger) { console.error("WARNING: the owner_record_no_update trigger is missing. Re-create it before using this database."); code = 1; }
    if (code === 0) {
      if (after?.record_email !== to || after.account_email !== to || after.user_id !== before.user_id) { console.error("The transition did not complete.", after); code = 1; }
      else console.log(`Owner account ${after.user_id} now signs in as ${to} (same account, same authenticator, history kept; its sessions ended). Set OWNER_EMAIL=${to} for this local environment in .dev.vars.`);
    }
  }
} finally { await proxy.dispose(); }
process.exit(code);

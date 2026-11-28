// Moves the existing owner account to a new login email in the LOCAL D1 database (Institutional Dashboard stage).
//   node scripts/owner/transition-email.mts --from old@example.com --to new@example.com [--persist-to .wrangler/state]
// Keeps the owner's user id, owner record, authenticator and history; creates no account. See src/server/owner-transition.ts.
// Local only: --remote is refused. The production transition is a separate, owner-approved procedure
// (docs/INSTITUTIONAL_DASHBOARD_REDESIGN_REPORT.md, section 9).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownerEmailTransitionSql } from "../../src/server/owner-transition.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
if (process.argv.includes("--remote")) {
  console.error("Refused: this tool changes the LOCAL database only. The production owner transition needs a backup, the Owner's approval and a change of OWNER_EMAIL in wrangler.jsonc, done together (see the dashboard redesign report, section 9).");
  process.exit(1);
}
const from = arg("--from"), to = arg("--to"), persist = arg("--persist-to");
if (!from || !to) { console.error("Usage: --from <current owner email> --to <new owner email> [--persist-to <dir>]"); process.exit(1); }
const sql = ownerEmailTransitionSql(from, to, new Date().toISOString());
const dir = mkdtempSync(join(tmpdir(), "owner-transition-"));
const file = join(dir, "transition.sql");
writeFileSync(file, sql.join("\n") + "\n");
const base = ["wrangler", "d1", "execute", "DB", "--local", ...(persist ? ["--persist-to", persist] : [])];
execFileSync("npx", [...base, "--file", file], { stdio: "inherit" });
const out = execFileSync("npx", [...base, "--json", "--command", "SELECT r.user_id, r.email AS record_email, u.email AS account_email FROM owner_record r JOIN users u ON u.id = r.user_id WHERE r.id = 1"], { encoding: "utf8" });
const row = JSON.parse(out)[0]?.results?.[0];
if (!row || row.record_email !== to.toLowerCase() || row.account_email !== to.toLowerCase()) {
  console.error("The transition did not complete (is --from the current owner address, and is --to unused?). Nothing was changed except where its guards allowed.", row ?? "");
  process.exit(1);
}
console.log(`Owner account ${row.user_id} now signs in as ${row.account_email}. Set OWNER_EMAIL to the same address for this local environment (.dev.vars).`);

// Captures a database's migration state for the preflight (Stage 3A): table names, the applied-migration list
// (null when d1_migrations does not exist), the schema and the total row count. READ-ONLY.
//   npm run db:state -- --local-dir <isolated-dir> --out state.json
//   npm run db:state -- --remote --owner-approved --account-id <id> --database-uuid <uuid> --out state.json   (owner only; read-only)
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMain, parseArgs } from "./args.mts";
import { D1Error, localTarget, query, verifiedRemote, type Target } from "./d1.mts";
import { readSchema } from "./dump.mts";
import type { State } from "./preflight.mts";

export function captureState(t: Target): State {
  const [tables] = query(t, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
  const names = (tables as { name: string }[]).map((r) => r.name);
  let migrations: string[] | null = null;
  if (names.includes("d1_migrations")) migrations = (query(t, "SELECT name FROM d1_migrations ORDER BY id")[0] as { name: string }[]).map((r) => r.name);
  const schema = readSchema(t);
  const real = schema.filter((e) => e.type === "table").map((e) => e.name);
  const counts = real.length ? query(t, real.map((n) => `SELECT COUNT(*) AS n FROM "${n.replace(/"/g, '""')}"`).join("; ")) : [];
  const rows = counts.reduce((a, r) => a + Number((r[0] as { n: number } | undefined)?.n ?? 0), 0);
  // Remote state records the exact, verified identity it was read from (Stage 3A.1).
  const identity = t.kind === "remote" && t.identity ? { accountId: t.identity.accountId, databaseUuid: t.identity.databaseUuid } : undefined;
  return { capturedAt: new Date().toISOString(), target: { kind: t.kind, database: t.database, ...(identity ? { identity } : {}) }, tables: names, migrations, schema, rows };
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  try {
    const t: Target = a.has("remote")
      ? verifiedRemote({ ownerApproved: a.has("owner-approved"), accountId: a.str("account-id"), databaseUuid: a.str("database-uuid"), database: a.str("database") }).target
      : localTarget(resolve(a.str("local-dir") ?? ""), { reuse: true });
    if (!a.has("remote") && !a.str("local-dir")) throw new D1Error("Give --local-dir <isolated-dir> or --remote --owner-approved --account-id <id> --database-uuid <uuid>.");
    const s = captureState(t);
    const out = a.str("out");
    if (out) writeFileSync(out, `${JSON.stringify(s, null, 2)}\n`);
    console.log(`${s.target.kind}:${s.target.database}: ${s.tables.length} tables, ${s.rows} rows, migrations ${s.migrations === null ? "UNKNOWN (no d1_migrations)" : `${s.migrations.length} applied, latest ${s.migrations.at(-1) ?? "none"}`}${out ? ` -> ${out}` : ""}`);
  } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
}

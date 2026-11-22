// The schema this Worker build expects (Stage 3A). Applies every migration in migrations/ to a new isolated local
// database with Wrangler (the same tool production uses) and records the resulting schema in db/schema.expected.json.
// Tests fail when that file is out of date, so the schema a Worker expects is always reviewable in the repository.
//   npm run db:schema          regenerate db/schema.expected.json
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, localTarget, migrationFiles, query } from "./d1.mts";
import { readSchema } from "./dump.mts";
import { EXPECTED_SCHEMA_FILE, type Expected } from "./restore.mts";
import { isMain } from "./args.mts";

export function buildExpected(migrationsDir?: string): Expected {
  const dir = mkdtempSync(join(tmpdir(), "sma-schema-"));
  try {
    const t = localTarget(dir, { migrationsDir });
    applyMigrations(t);
    const migrations = (query(t, "SELECT name FROM d1_migrations ORDER BY id")[0] as { name: string }[]).map((r) => r.name);
    const files = migrationFiles(migrationsDir);
    if (JSON.stringify(migrations) !== JSON.stringify(files)) throw new Error("Applied migrations do not match the migration files.");
    return { migration: migrations.at(-1)!, migrations, schema: readSchema(t) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (isMain(import.meta.url)) {
  const e = buildExpected();
  writeFileSync(EXPECTED_SCHEMA_FILE, `${JSON.stringify(e, null, 2)}\n`);
  console.log(`Wrote db/schema.expected.json: ${e.migration}, ${e.schema.filter((x) => x.type === "table").length} tables, ${e.schema.filter((x) => x.type === "index").length} indexes, ${e.schema.filter((x) => x.type === "trigger").length} triggers.`);
}

// Generates SQL that copies the programmes in lib/config.ts into the D1 "programmes" table.
//   npm run db:seed-sql        (rewrites db/seed-programmes.sql)
//   (Stage 3A.1) Do NOT run this file against production by hand: it UPSERTS programme rows, which overwrites prices and
//   durations. A production change to the programme table goes through the gated migration procedure
//   (docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md) with the owner's approval of the prices.
// The Worker always prices from lib/config.ts; this table is a record for reports and the future admin dashboard.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROGRAMMES } from "../lib/config.ts";

const q = (v: string | number | null | undefined) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
const k = (n: number | null | undefined) => (n == null ? null : n * 100);

export function seedSql(): string {
  const rows = PROGRAMMES.map((p) =>
    `INSERT INTO programmes (slug, name, price_kobo, was_kobo, timed_price_kobo, group_price_kobo, training_months, internship_months, level, updated_at) VALUES (${[
      q(p.slug), q(p.name), q(k(p.price)), q(k(p.was)), q(k(p.timedPrice)), q(k(p.groupPrice)), q(p.trainingMonths), q(p.internshipMonths), q(p.level), "datetime('now')",
    ].join(", ")}) ON CONFLICT(slug) DO UPDATE SET name = excluded.name, price_kobo = excluded.price_kobo, was_kobo = excluded.was_kobo, timed_price_kobo = excluded.timed_price_kobo, group_price_kobo = excluded.group_price_kobo, training_months = excluded.training_months, internship_months = excluded.internship_months, level = excluded.level, updated_at = excluded.updated_at;`);
  return `-- GENERATED from lib/config.ts by scripts/seed.mts. Do not edit by hand.\n${rows.join("\n")}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ?? "db/seed-programmes.sql";
  writeFileSync(out, seedSql());
  console.log(`Wrote ${out}`);
}

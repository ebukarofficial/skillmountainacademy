// The database schema this Worker build expects (Stage 3A). Must equal the last file in migrations/ and the "migration"
// in db/schema.expected.json (a test enforces both). The admin platform page compares it with the database's
// d1_migrations, so anyone can see whether the deployed Worker and the database agree.
export const EXPECTED_MIGRATION = "0015_institution.sql";

export type SchemaStatus = { expected: string; applied: string | null; status: "compatible" | "database_older" | "database_newer" | "unknown" };
const num = (m: string | null) => (m ? Number(m.slice(0, 4)) : NaN);
export function schemaStatus(applied: string | null): SchemaStatus {
  const a = num(applied), e = num(EXPECTED_MIGRATION);
  const status = !applied || Number.isNaN(a) ? "unknown" : applied === EXPECTED_MIGRATION ? "compatible" : a < e ? "database_older" : a > e ? "database_newer" : "unknown";
  return { expected: EXPECTED_MIGRATION, applied, status };
}

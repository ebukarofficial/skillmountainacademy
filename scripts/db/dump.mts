// Logical backup of a D1 database (Stage 3A).
//
// Why not `wrangler d1 export`? This database has a full-text-search virtual table (resource_chunks, FTS5, migration
// 0003). Cloudflare's export refuses any database with virtual tables (verified locally: "cannot export databases with
// Virtual Tables (fts5)"; Cloudflare documents the same limitation for remote exports, with the workaround of dropping the
// virtual table first, which would be a production change). This tool instead reads the database through ordinary
// read-only SELECT queries and writes a self-contained SQL file:
//
//   PRAGMA defer_foreign_keys = TRUE;
//   CREATE TABLE ...            every table and the FTS5 virtual table, in creation order (FTS5 shadow tables excluded:
//                               SQLite recreates them)
//   INSERT INTO ...             every row of every table, in rowid order (including d1_migrations, owner_record,
//                               audit_log, MFA tables and the FTS5 index content)
//   CREATE INDEX ...            indexes
//   CREATE TRIGGER ... END;     triggers last (owner_record and audit_log protection)
//
// A manifest is written next to it: file size and SHA-256, the migration version, the schema, and for every table its
// row count, column list and a SHA-256 of its rows. The manifest holds NO data values, so it can be shared for review.
// The SQL file holds everything, including encrypted MFA secrets, hashed recovery codes and session token hashes: treat it
// as confidential. With --encrypt-for <public-key.pem> the file is encrypted (RSA-OAEP-256 + AES-256-GCM) and the
// plaintext is removed.
//
// Consistency: the tables are read one query batch after another, not inside one transaction. Take backups when the
// platform is quiet (the cron runs every 5 minutes; avoid :00-:02 and 05:00 UTC). See the architecture document.
import { createCipheriv, createDecipheriv, createHash, privateDecrypt, publicEncrypt, randomBytes, constants } from "node:crypto";
import { readFileSync, statSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { D1Error, PROD_DB, query, type Rows, type Target } from "./d1.mts";
import { CLASSIFICATION, isInstitutional } from "./classification.mts";

export const FORMAT = "sma-d1-logical-backup/1";
export const MAX_D1_STATEMENT_BYTES = 100_000;

export type SchemaEntry = { type: string; name: string; tbl_name: string; sql: string };
export type TableInfo = { rows: number; columns: string[]; sha256: string; virtual?: boolean };
export type Critical = Record<string, number | string | null>;
export type Manifest = {
  format: string; createdAt: string; source: { kind: string; database: string; label?: string; identity?: { accountId: string; databaseUuid: string } };
  migration: { latest: string | null; applied: number };
  schema: SchemaEntry[]; tables: Record<string, TableInfo>; totals: { tables: number; rows: number; institutionalRows: number };
  classes: Record<string, { tables: number; rows: number }>;
  critical: Critical; triggers: string[]; indexes: number;
  file: { name: string; bytes: number; sha256: string };
  encrypted?: { algorithm: string; file: string; bytes: number; sha256: string; plaintextRemoved: boolean };
  warnings: string[];
};

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const FTS5_SHADOWS = ["data", "idx", "content", "docsize", "config"];

// Read schema: every object with SQL, minus SQLite internals, Cloudflare internals and FTS5 shadow tables.
export function readSchema(t: Target): SchemaEntry[] {
  const [rows] = query(t, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid");
  const all = rows as SchemaEntry[];
  const shadows = new Set<string>();
  for (const e of all) {
    const m = e.sql.match(/^CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)["`\]]?\s+USING\s+(\w+)/i);
    if (!m) continue;
    if (m[2].toLowerCase() !== "fts5") throw new D1Error(`Virtual table ${m[1]} uses module ${m[2]}; only fts5 is supported by this backup tool (refusing rather than guessing its storage).`);
    for (const s of FTS5_SHADOWS) shadows.add(`${m[1]}_${s}`);
  }
  return all.filter((e) => !shadows.has(e.name)).map((e) => ({ type: e.type, name: e.name, tbl_name: e.tbl_name, sql: e.sql }));
}

const isVirtual = (e: SchemaEntry) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(e.sql);
const tablesOf = (schema: SchemaEntry[]) => schema.filter((e) => e.type === "table");

// Reads every row of every table (in rowid order), in batches of statements. Values must be text, numbers or NULL;
// anything else (BLOBs, unsafe integers) is refused so a backup is never silently lossy.
export function readData(t: Target, schema: SchemaEntry[], batchRows = 1000): Map<string, { columns: string[]; rows: unknown[][] }> {
  const tables = tablesOf(schema);
  for (const e of tables) if (/WITHOUT\s+ROWID/i.test(e.sql)) throw new D1Error(`Table ${e.name} is WITHOUT ROWID; not supported by this backup tool.`);
  // One COUNT per table, as separate statements in one call (D1 limits compound SELECTs).
  const countRes = tables.length ? query(t, tables.map((e) => `SELECT COUNT(*) AS n FROM ${q(e.name)}`).join("; ")) : [];
  const counts = new Map<string, number>(tables.map((e, i) => [e.name, Number((countRes[i]?.[0] as { n: number } | undefined)?.n ?? NaN)]));
  for (const [name, n] of counts) if (!Number.isFinite(n)) throw new D1Error(`Could not count the rows of ${name}.`);
  const out = new Map<string, { columns: string[]; rows: unknown[][] }>();
  // Column names, even for empty tables (PRAGMA table_info works for virtual tables too).
  const infos = tables.length ? query(t, tables.map((e) => `PRAGMA table_info(${q(e.name)})`).join("; ")) : [];
  tables.forEach((e, i) => out.set(e.name, { columns: (infos[i] as { name: string }[]).map((c) => c.name), rows: [] }));
  // Pages: [table, offset] pairs grouped so one Wrangler call reads at most ~batchRows rows.
  const pages: [string, number][] = [];
  for (const e of tables) for (let off = 0; off < (counts.get(e.name) ?? 0); off += batchRows) pages.push([e.name, off]);
  let group: [string, number][] = [];
  let groupRows = 0;
  const flush = () => {
    if (!group.length) return;
    const res = query(t, group.map(([name, off]) => `SELECT * FROM ${q(name)} ORDER BY rowid LIMIT ${batchRows} OFFSET ${off}`).join("; "));
    group.forEach(([name], i) => {
      const tab = out.get(name)!;
      for (const r of res[i]) {
        const vals = tab.columns.map((c) => (r as Record<string, unknown>)[c]);
        for (const v of vals) {
          if (v !== null && typeof v !== "string" && typeof v !== "number") throw new D1Error(`Table ${name} holds a value of type ${typeof v} (BLOB?); refusing an incomplete backup.`);
          if (typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v)) throw new D1Error(`Table ${name} holds an integer beyond 2^53; refusing a lossy backup.`);
        }
        tab.rows.push(vals);
      }
    });
    group = []; groupRows = 0;
  };
  for (const p of pages) { const n = Math.min(batchRows, (counts.get(p[0]) ?? 0) - p[1]); if (groupRows + n > batchRows) flush(); group.push(p); groupRows += n; }
  flush();
  for (const e of tables) if (out.get(e.name)!.rows.length !== (counts.get(e.name) ?? 0))
    throw new D1Error(`Table ${e.name} changed while it was being read (expected ${counts.get(e.name)} rows, read ${out.get(e.name)!.rows.length}). Take the backup again when the platform is quiet.`);
  return out;
}

const lit = (v: unknown) => v === null || v === undefined ? "NULL" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL") : `'${String(v).replace(/'/g, "''")}'`;
export const tableHash = (rows: unknown[][]) => sha(JSON.stringify(rows));

// Critical institutional figures, computed from rows already read (so they describe exactly what is in the backup).
export function criticalOf(data: Map<string, { columns: string[]; rows: unknown[][] }>): Critical {
  const col = (t: string, c: string) => { const d = data.get(t); if (!d) return null; const i = d.columns.indexOf(c); return i < 0 ? null : d.rows.map((r) => r[i]); };
  const count = (t: string) => data.get(t)?.rows.length ?? null;
  const countWhere = (t: string, c: string, v: unknown) => col(t, c)?.filter((x) => x === v).length ?? null;
  const sum = (t: string, c: string) => col(t, c)?.reduce<number>((a, x) => a + (typeof x === "number" ? x : 0), 0) ?? null;
  const ownerRows = count("owner_record");
  const ownerUser = col("owner_record", "user_id")?.[0] ?? null;
  const users = data.get("users");
  const ownerIsAdmin = ownerUser && users ? users.rows.some((r) => r[users.columns.indexOf("id")] === ownerUser && r[users.columns.indexOf("role")] === "admin") : null;
  return {
    owner_record_rows: ownerRows, owner_record_user_is_admin: ownerIsAdmin === null ? null : ownerIsAdmin ? 1 : 0,
    audit_log_rows: count("audit_log"),
    users_students: countWhere("users", "role", "student"), users_instructors: countWhere("users", "role", "instructor"), users_admins: countWhere("users", "role", "admin"),
    enrolments: count("enrolments"), timetables: count("timetables"),
    class_sessions: count("class_sessions"), attendance_completed: countWhere("class_sessions", "status", "completed"), attendance_missed: countWhere("class_sessions", "status", "missed"),
    assignments: count("assignments"), submissions: count("submissions"), submissions_graded: col("submissions", "graded_at")?.filter((x) => x !== null).length ?? null,
    quiz_attempts: count("quiz_attempts"),
    orders: count("orders"), orders_total_kobo: sum("orders", "total_kobo"),
    instalments: count("instalments"), instalments_total_kobo: sum("instalments", "amount_kobo"),
    payments: count("payments"), payments_total_kobo: sum("payments", "amount_kobo"), webhook_events: count("webhook_events"),
    registrations: count("registrations"), messages: count("messages"), notifications: count("notifications"),
    mfa_factors: count("mfa_factors"), mfa_recovery_codes: count("mfa_recovery_codes"), staff_removal_requests: count("staff_removal_requests"),
  };
}

export function readAll(t: Target) {
  const schema = readSchema(t);
  const data = readData(t, schema);
  const [mig] = schema.some((e) => e.name === "d1_migrations") ? query(t, "SELECT name FROM d1_migrations ORDER BY id") : [[] as Rows];
  const names = (mig as { name: string }[]).map((r) => r.name);
  return { schema, data, migrations: names };
}

// Builds the SQL text of a backup.
export function renderSql(schema: SchemaEntry[], data: Map<string, { columns: string[]; rows: unknown[][] }>, header: Record<string, string>): { sql: string; warnings: string[] } {
  const warnings: string[] = [];
  const lines: string[] = [`-- ${FORMAT}`, ...Object.entries(header).map(([k, v]) => `-- ${k}: ${v}`), "-- Restore ONLY into an empty database (see docs/SMA_STAGE_3A_DISASTER_RECOVERY_RUNBOOK.md).", "PRAGMA defer_foreign_keys = TRUE;"];
  for (const e of schema.filter((x) => x.type === "table")) lines.push(`${e.sql};`);
  for (const e of schema.filter((x) => x.type === "table")) {
    const d = data.get(e.name)!;
    const cols = d.columns.map(q).join(", ");
    for (const r of d.rows) {
      const stmt = `INSERT INTO ${q(e.name)} (${cols}) VALUES (${r.map(lit).join(", ")});`;
      if (Buffer.byteLength(stmt) > MAX_D1_STATEMENT_BYTES) warnings.push(`A row in ${e.name} is larger than ${MAX_D1_STATEMENT_BYTES} bytes: a remote (Cloudflare) import may refuse it; local restores are unaffected.`);
      lines.push(stmt);
    }
  }
  for (const e of schema.filter((x) => x.type === "index")) lines.push(`${e.sql};`);
  for (const e of schema.filter((x) => x.type === "view")) lines.push(`${e.sql};`);
  for (const e of schema.filter((x) => x.type === "trigger")) lines.push(`${e.sql};`);
  return { sql: `${lines.join("\n")}\n`, warnings: [...new Set(warnings)] };
}

export function stamp(d = new Date()) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); }

// Takes a backup. Returns the manifest (also written to <file>.manifest.json).
export function backup(t: Target, outDir: string, opts: { label?: string; encryptFor?: string; now?: Date } = {}): { file: string; manifestFile: string; manifest: Manifest } {
  const now = opts.now ?? new Date();
  const { schema, data, migrations } = readAll(t);
  // A database with no tables at all is almost certainly the wrong target (a mistyped name or an empty scratch database).
  if (!schema.some((e) => e.type === "table")) throw new D1Error(`${t.kind}:${t.database} has no tables; refusing to write a backup of an empty database (wrong target?).`);
  const latest = migrations.at(-1) ?? null;
  const version = latest ? latest.replace(/\.sql$/, "").split("_")[0] : "none";
  mkdirSync(resolve(outDir), { recursive: true });
  // Filename: database, UTC time, migration number. Never data, never credentials.
  const file = join(resolve(outDir), `${t.database}-${stamp(now)}-m${version}.sql`);
  const header = { created_at: now.toISOString(), source: `${t.kind}:${t.database}`, migration: latest ?? "none" };
  const { sql, warnings } = renderSql(schema, data, header);
  writeFileSync(file, sql, { mode: 0o600 });
  const bytes = statSync(file).size;
  if (bytes === 0) throw new D1Error("The backup file is empty.");
  const tables: Record<string, TableInfo> = {};
  for (const e of tablesOf(schema)) { const d = data.get(e.name)!; tables[e.name] = { rows: d.rows.length, columns: d.columns, sha256: tableHash(d.rows), ...(isVirtual(e) ? { virtual: true } : {}) }; }
  const rows = Object.values(tables).reduce((a, x) => a + x.rows, 0);
  // "No records" means no INSTITUTIONAL records: migrations themselves create reference rows (programmes, sequences).
  const institutionalRows = Object.entries(tables).filter(([n]) => isInstitutional(n)).reduce((a, [, x]) => a + x.rows, 0);
  if (institutionalRows === 0) warnings.push("The database holds no institutional records (only migration-created reference rows, or nothing).");
  const classes: Manifest["classes"] = {};
  for (const [n, x] of Object.entries(tables)) {
    const c: string = CLASSIFICATION[n]?.class ?? "unclassified";
    if (c === "unclassified") warnings.push(`Table ${n} is not classified (scripts/db/classification.mts).`);
    classes[c] = { tables: (classes[c]?.tables ?? 0) + 1, rows: (classes[c]?.rows ?? 0) + x.rows };
  }
  const manifest: Manifest = {
    format: FORMAT, createdAt: now.toISOString(), source: { kind: t.kind, database: t.database, ...(opts.label ? { label: opts.label } : {}),
      ...(t.kind === "remote" && t.identity ? { identity: { accountId: t.identity.accountId, databaseUuid: t.identity.databaseUuid } } : {}) },
    migration: { latest, applied: migrations.length }, schema, tables, totals: { tables: Object.keys(tables).length, rows, institutionalRows }, classes,
    critical: criticalOf(data), triggers: schema.filter((e) => e.type === "trigger").map((e) => e.name), indexes: schema.filter((e) => e.type === "index").length,
    file: { name: basename(file), bytes, sha256: sha(readFileSync(file)) }, warnings,
  };
  if (opts.encryptFor) {
    const enc = encryptFile(file, opts.encryptFor);
    manifest.encrypted = { algorithm: "RSA-OAEP-256 + AES-256-GCM", file: basename(enc), bytes: statSync(enc).size, sha256: sha(readFileSync(enc)), plaintextRemoved: true };
    unlinkSync(file);
  }
  const manifestFile = `${file}.manifest.json`;
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { file: opts.encryptFor ? join(dirname(file), manifest.encrypted!.file) : file, manifestFile, manifest };
}

// ---- encryption (hybrid: a fresh AES-256-GCM key per backup, wrapped with the owner's RSA public key) ----
const MAGIC = Buffer.from("SMABK1\0");
export function encryptFile(file: string, publicKeyPem: string): string {
  const key = randomBytes(32), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(readFileSync(file)), c.final()]);
  const wrapped = publicEncrypt({ key: readFileSync(publicKeyPem), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  const len = Buffer.alloc(2); len.writeUInt16BE(wrapped.length);
  const out = `${file}.enc`;
  writeFileSync(out, Buffer.concat([MAGIC, len, wrapped, iv, c.getAuthTag(), body]), { mode: 0o600 });
  return out;
}
export function decryptFile(encFile: string, privateKeyPem: string, outFile: string): string {
  const b = readFileSync(encFile);
  if (!b.subarray(0, MAGIC.length).equals(MAGIC)) throw new D1Error("Not an SMA encrypted backup.");
  let o = MAGIC.length;
  const n = b.readUInt16BE(o); o += 2;
  const key = privateDecrypt({ key: readFileSync(privateKeyPem), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, b.subarray(o, o + n)); o += n;
  const iv = b.subarray(o, o + 12); o += 12;
  const tag = b.subarray(o, o + 16); o += 16;
  const d = createDecipheriv("aes-256-gcm", key, iv); d.setAuthTag(tag);
  writeFileSync(outFile, Buffer.concat([d.update(b.subarray(o)), d.final()]), { mode: 0o600 });
  return outFile;
}

export const sha256File = (f: string) => sha(readFileSync(f));
export { PROD_DB };

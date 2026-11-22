// Generates the post-restore SECURITY RESET for a database restored from a backup (Stage 3A.1, runbook section 6.2,
// phase B). The SQL is generated with real values, so the operator never edits placeholders by hand.
//
// What it changes (in the RESTORED database only, never the original):
//   1. DELETE FROM auth_sessions                    every session in the backup is ended (they must not be reusable)
//   2. UPDATE auth_tokens SET used_at = <now> ...   every unused sign-in link in the backup is invalidated
//   3. INSERT INTO audit_log (... 'system.restore') one audit entry: which backup, which database, who approved it.
//      actor_id is NULL (the restore was not performed through the application, so no application user is invented);
//      the approving owner's user id is taken from the restored owner_record, and the approver's name as given.
// It does NOT touch owner_record, mfa_factors, mfa_recovery_codes, app_settings or any record: the owner signs in again
// by email link + authenticator code (or a recovery code, or break-glass), exactly as before the incident.
// Inserting into audit_log is allowed by the Stage 2C triggers (they block only UPDATE and early DELETE).
//   npm run db:post-restore-sql -- --backup backups/<file>.sql.enc --database <restored-db-name> --database-uuid <uuid> --approved-by "Name" --out reset.sql
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { isMain, parseArgs } from "./args.mts";
import { UUID_RE } from "./d1.mts";
import type { Manifest } from "./dump.mts";

export const RESTORE_ACTION = "system.restore";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function postRestoreSql(o: { manifest: Manifest; backupName: string; database: string; databaseUuid?: string; approvedBy: string; now?: Date; id?: string }): string {
  const name = o.approvedBy.trim();
  if (name.length < 3 || name.length > 100 || /[\u0000-\u001f]/.test(name)) throw new Error("--approved-by must be the approving person's name (3-100 characters).");
  if (!/^[A-Za-z0-9._-]+$/.test(o.database)) throw new Error("--database must be a D1 database name.");
  if (o.databaseUuid && !UUID_RE.test(o.databaseUuid)) throw new Error("--database-uuid is not a UUID.");
  const now = (o.now ?? new Date()).toISOString();
  const detail = `json_object('from_backup', ${q(o.backupName)}, 'backup_sha256', ${q(o.manifest.file.sha256)}, 'backup_created_at', ${q(o.manifest.createdAt)}, `
    + `'backup_migration', ${q(o.manifest.migration.latest ?? "none")}, 'restored_database', ${q(o.database)}, 'restored_database_uuid', ${o.databaseUuid ? q(o.databaseUuid) : "NULL"}, `
    + `'approved_by', ${q(name)}, 'approving_owner_user_id', (SELECT user_id FROM owner_record WHERE id = 1), 'performed_via', 'wrangler d1 execute', `
    + `'reset', 'sessions ended; unused sign-in links invalidated')`;
  return [
    `-- Post-restore security reset. Generated ${now}. TARGET: the RESTORED database ${o.database}${o.databaseUuid ? ` (${o.databaseUuid})` : ""} ONLY.`,
    "-- DESTRUCTIVE for that database's sessions and unused sign-in links; irreversible (people sign in again). Records untouched.",
    "DELETE FROM auth_sessions;",
    `UPDATE auth_tokens SET used_at = ${q(now)} WHERE used_at IS NULL;`,
    `INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail, ip_hash) VALUES (${q(o.id ?? randomUUID())}, ${q(now)}, NULL, ${q(RESTORE_ACTION)}, 'database', ${q(o.databaseUuid ?? o.database)}, ${detail}, NULL);`,
    "",
  ].join("\n");
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  try {
    const b = a.str("backup"), out = a.str("out");
    if (!b || !a.str("database") || !a.str("approved-by") || !out) throw new Error("Usage: npm run db:post-restore-sql -- --backup <file> --database <restored-db-name> [--database-uuid <uuid>] --approved-by \"Name\" --out <reset.sql>");
    const file = resolve(b);
    const mf = file.endsWith(".enc") ? `${file.slice(0, -4)}.manifest.json` : `${file}.manifest.json`;
    if (!existsSync(mf)) throw new Error(`Manifest not found: ${mf}`);
    if (existsSync(out)) throw new Error(`${out} already exists.`);
    const sql = postRestoreSql({ manifest: JSON.parse(readFileSync(mf, "utf8")) as Manifest, backupName: basename(file), database: a.str("database")!, databaseUuid: a.str("database-uuid"), approvedBy: a.str("approved-by")! });
    writeFileSync(out, sql, { mode: 0o600 });
    console.log(`Wrote ${out}. Review it, then run it against the RESTORED database only (runbook section 6.2, phase B).`);
  } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
}

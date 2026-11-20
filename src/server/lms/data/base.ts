// Shared D1 helpers for the learning platform's data layer (src/server/lms/data/*). Only files in this folder
// (and src/server/repo.ts) contain SQL; routes call the functions they export. Every value is a bound parameter.
import { notConfigured } from "../../http";

export type DB = D1Database;
type Val = string | number | null | undefined;

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message ?? e))) throw notConfigured("The learning platform database");
    throw e;
  }
}

const bind = (db: DB, sql: string, args: Val[]) => db.prepare(sql).bind(...args.map((a) => (a === undefined ? null : a)));
export const one = <T>(db: DB, sql: string, ...args: Val[]) => guard(() => bind(db, sql, args).first<T>());
export const all = async <T>(db: DB, sql: string, ...args: Val[]) => (await guard(() => bind(db, sql, args).all<T>())).results;
export const run = async (db: DB, sql: string, ...args: Val[]) => (await guard(() => bind(db, sql, args).run())).meta.changes ?? 0;
export const stmt = (db: DB, sql: string, ...args: Val[]) => bind(db, sql, args);
export const batch = (db: DB, stmts: D1PreparedStatement[]) => guard(() => db.batch(stmts));

export function insertSql(table: string, row: Record<string, Val>): [string, Val[]] {
  const cols = Object.keys(row);
  return [`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`, cols.map((c) => row[c])];
}
export const insert = (db: DB, table: string, row: Record<string, Val>) => { const [s, a] = insertSql(table, row); return run(db, s, ...a); };
export const insertStmt = (db: DB, table: string, row: Record<string, Val>) => { const [s, a] = insertSql(table, row); return stmt(db, s, ...a); };

// UPDATE with only the columns given (columns come from code, never from user input).
export function update(db: DB, table: string, id: string, patch: Record<string, Val>) {
  const cols = Object.keys(patch).filter((c) => patch[c] !== undefined);
  if (!cols.length) return Promise.resolve(0);
  return run(db, `UPDATE ${table} SET ${cols.map((c, i) => `${c} = ?${i + 2}`).join(", ")} WHERE id = ?1`, id, ...cols.map((c) => patch[c]));
}

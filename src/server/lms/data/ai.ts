// AI assistant storage: searchable chunks of approved materials (SQLite FTS5) and chat history.
import { all, batch, run, stmt, type DB } from "./base";

export const deleteChunks = (db: DB, resourceId: string) => run(db, "DELETE FROM resource_chunks WHERE resource_id = ?1", resourceId);
export const insertChunks = (db: DB, resourceId: string, slug: string, title: string, bodies: string[]) => batch(db, [
  stmt(db, "DELETE FROM resource_chunks WHERE resource_id = ?1", resourceId),
  ...bodies.map((b) => stmt(db, "INSERT INTO resource_chunks (resource_id, programme_slug, title, body) VALUES (?1, ?2, ?3, ?4)", resourceId, slug, title, b)),
]);
// Best-matching chunks for a question, limited to one programme.
export const searchChunks = (db: DB, slug: string, match: string, limit: number) => all<{ resource_id: string; title: string; body: string }>(db,
  "SELECT resource_id, title, body FROM resource_chunks WHERE resource_chunks MATCH ?1 AND programme_slug = ?2 ORDER BY bm25(resource_chunks) LIMIT ?3", match, slug, limit);
export const addAiMessage = (db: DB, m: { id: string; student_id: string; role: "user" | "assistant"; content: string; created_at: string }) =>
  run(db, "INSERT INTO ai_messages (id, student_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", m.id, m.student_id, m.role, m.content, m.created_at);
export const aiHistory = (db: DB, studentId: string, limit: number) => all<{ role: "user" | "assistant"; content: string; created_at: string }>(db,
  "SELECT role, content, created_at FROM (SELECT * FROM ai_messages WHERE student_id = ?1 ORDER BY created_at DESC LIMIT ?2) ORDER BY created_at", studentId, limit);
export const aiCountSince = async (db: DB, studentId: string, since: string) =>
  (await all<{ n: number }>(db, "SELECT COUNT(*) AS n FROM ai_messages WHERE student_id = ?1 AND role = 'user' AND created_at >= ?2", studentId, since))[0]?.n ?? 0;

// Stage 3B: anonymised copy of the Academy database for STAGING. Never touches production or staging directly.
//
//   1. The backup is restored into a NEW, ISOLATED LOCAL database with the full Stage 3A verification (checksums,
//      manifest, schema, counts) — the same path as a restore test.
//   2. Every column of every table has an explicit rule below (keep, replace, clear, or the whole table emptied). A column
//      with no rule stops the tool: a new migration cannot leak a new personal field into staging unnoticed.
//   3. The protective triggers on audit_log and owner_record are dropped IN THE ISOLATED COPY ONLY so their contents can
//      be anonymised, then re-created exactly as the migrations define them.
//   4. Verification: no original email, name, phone or free-text value survives anywhere in the copy; every email
//      address left is in the reserved staging.invalid domain; sign-in links, sessions, two-step secrets, recovery codes,
//      the owner record and the IP-hashing key are gone.
//   5. Only then is a SQL file of the anonymised copy written (with its manifest). Importing it into the staging D1
//      database is a separate, owner-approved step (docs/SMA_STAGE_3B_ENVIRONMENT_SEPARATION.md).
//
//   npm run db:anonymise -- --backup <file.sql|.sql.enc> --manifest <manifest.json> [--private-key <pem>] --out <empty dir>
import { mkdirSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execLocal, localTarget, query, D1Error, type Target } from "./d1.mts";
import { backup, readAll, readSchema, type SchemaEntry } from "./dump.mts";
import { verifyRestore } from "./restore.mts";
import { isMain, parseArgs } from "./args.mts";

export type Rule = "keep" | "email" | "name" | "first_name" | "surname" | "phone" | "text" | "null" | "json_object" | "ref";
export type TablePolicy = { empty: true; why: string } | { columns: Record<string, Rule> };
const keep = (...cols: string[]) => Object.fromEntries(cols.map((c) => [c, "keep" as Rule]));

export const STAGING_DOMAIN = "staging.invalid";
// Every table and every column. Ids, dates, statuses, amounts, programme references and teaching content are kept so
// staging behaves like production; anything that identifies or describes a person, or was written by one, is replaced.
export const POLICY: Record<string, TablePolicy> = {
  d1_migrations: { columns: keep("id", "name", "applied_at") },
  programmes: { columns: keep("slug", "name", "price_kobo", "was_kobo", "timed_price_kobo", "group_price_kobo", "training_months", "internship_months", "level", "updated_at") },
  registrations: { columns: { ...keep("id", "created_at", "role", "lead_id", "programme_slug", "country", "adult", "education", "english", "computer_literate", "background", "industry", "terms"),
    first_name: "first_name", middle_name: "null", surname: "surname", email: "email", phone: "phone", city: "null", background_detail: "text", why: "text", goals: "text", guardian_name: "name", guardian_phone: "phone", ip_hash: "null" } },
  orders: { columns: { ...keep("id", "created_at", "registration_id", "programme_slug", "plan", "method", "total_kobo", "regular_kobo", "hold_id", "group_size", "display_currency", "fx_rate", "fx_at", "status"), reference: "ref" } },
  instalments: { columns: { ...keep("id", "order_id", "seq", "amount_kobo", "due_date", "status", "reminder_sent_at", "link_sent_at", "paid_at"), reference: "ref" } },
  payments: { columns: { ...keep("id", "order_id", "instalment_id", "provider", "amount_kobo", "currency", "status", "paid_at", "created_at"), provider_ref: "ref" } },
  webhook_events: { empty: true, why: "payment-provider event ids belong to the production Paystack account" },
  holds: { columns: { ...keep("id", "programme_slug", "started_at", "expires_at", "cooldown_until"), visitor_hash: "null", ip_hash: "null" } },
  children_enquiries: { columns: { ...keep("id", "created_at", "child_age", "programme_interest"), parent_name: "name", email: "email", phone: "phone", message: "text", ip_hash: "null" } },
  rate_limits: { empty: true, why: "keys contain hashed addresses" },
  users: { columns: { ...keep("id", "role", "status", "student_no", "specialization", "registration_id", "created_at", "last_login_at", "verification", "public_profile", "staff_no", "email_prefs",
    "profile_submitted_at", "verified_at", "guardian_contact_ok", "admin_role", "removed_at", "removed_by", "mfa_required", "highest_qualification", "country_origin", "country_residence", "languages"),
    email: "email", full_name: "name", phone: "phone", bio: "text", photo_key: "null", qualifications: "text", links: "null", verification_checks: "null", experience: "text", headline: "text",
    achievements: "text", certifications: "text", meet_link: "null", guardian_name: "name", guardian_relationship: "keep", guardian_email: "email", guardian_phone: "phone", guardian_contact_note: "text", removal_reason: "text" } },
  auth_tokens: { empty: true, why: "sign-in links" },
  auth_sessions: { empty: true, why: "sessions" },
  audit_log: { columns: { ...keep("id", "at", "actor_id", "action", "target_type", "target_id"), detail: "json_object", ip_hash: "null" } },
  courses: { columns: keep("id", "programme_slug", "title", "description", "position", "created_at") },
  lessons: { columns: keep("id", "course_id", "title", "objectives", "position", "created_at") },
  enrolments: { columns: keep("id", "student_id", "programme_slug", "instructor_id", "status", "order_id", "started_at", "completed_at", "created_at") },
  timetables: { columns: keep("id", "enrolment_id", "weekday", "start_time", "duration_min", "effective_from", "effective_to", "created_by", "created_at") },
  class_sessions: { columns: { ...keep("id", "enrolment_id", "timetable_id", "student_id", "instructor_id", "starts_at", "ends_at", "meet_updated_at", "meet_notified_at", "status", "outcome_at", "outcome_by",
    "rescheduled_to", "reminded_24h_at", "reminded_1h_at", "reminded_15m_at", "link_missing_alert_at", "created_at"), meet_url: "null", notes: "text", attendance_detail: "null" } },
  notifications: { columns: { ...keep("id", "user_id", "kind", "link", "created_at", "read_at", "emailed_at", "priority"), title: "text", body: "text" } },
  resources: { columns: { ...keep("id", "programme_slug", "course_id", "title", "kind", "url", "text_content", "approved", "created_by", "created_at"), file_key: "null", file_name: "null" } },
  resource_chunks: { columns: keep("resource_id", "programme_slug", "title", "body") },
  assignments: { columns: { ...keep("id", "student_id", "instructor_id", "enrolment_id", "title", "due_at", "max_score", "created_at"), description: "text" } },
  submissions: { columns: { ...keep("id", "assignment_id", "student_id", "submitted_at", "score", "graded_at", "graded_by"), text: "text", file_key: "null", file_name: "null", feedback: "text" } },
  quizzes: { columns: keep("id", "student_id", "instructor_id", "enrolment_id", "kind", "title", "instructions", "duration_min", "due_at", "questions", "max_score", "created_at") },
  quiz_attempts: { columns: { ...keep("id", "quiz_id", "student_id", "started_at", "submitted_at", "score", "graded_at", "graded_by"), answers: "json_object", feedback: "text" } },
  lesson_progress: { columns: keep("student_id", "lesson_id", "completed_at") },
  messages: { columns: { ...keep("id", "from_id", "to_id", "created_at", "read_at"), body: "text" } },
  instructor_ratings: { columns: { ...keep("id", "student_id", "instructor_id", "rating", "created_at"), comment: "text" } },
  ai_messages: { columns: { ...keep("id", "student_id", "role", "created_at"), content: "text" } },
  error_log: { empty: true, why: "technical records may quote request data" },
  programme_admissions: { columns: keep("programme_slug", "mode", "enforce_capacity", "default_instructor_cap", "reserved", "listed", "updated_at", "updated_by") },
  admission_periods: { columns: keep("id", "programme_slug", "label", "opens_at", "closes_at", "created_at", "created_by", "cancelled_at") },
  instructor_programmes: { columns: keep("instructor_id", "programme_slug", "max_students", "created_at") },
  id_sequences: { columns: keep("name", "last") },
  call_bookings: { columns: { ...keep("id", "programme", "preferred_date", "preferred_time", "timezone", "status", "assigned_to", "created_at", "updated_at"), name: "name", email: "email", phone: "phone", reason: "text", notes: "text", ip_hash: "null" } },
  assistant_enquiries: { columns: { ...keep("id", "conversation_id", "programme", "answered", "needs_followup", "handled_at", "created_at"), question: "text", answer: "text", ip_hash: "null" } },
  weekly_items: { columns: { ...keep("id", "enrolment_id", "student_id", "week_start", "item_key", "title", "assigned_by", "completed_at", "created_at"), detail: "text", completion_note: "text" } },
  app_settings: { columns: keep("key", "value", "updated_at", "updated_by") }, // secret and owner rows are deleted separately below
  contact_log: { columns: { ...keep("id", "student_id", "channel", "outcome", "by_user", "created_at"), target: "text", subject: "text", summary: "text" } },
  mfa_factors: { empty: true, why: "two-step secrets" },
  mfa_recovery_codes: { empty: true, why: "recovery codes" },
  staff_removal_requests: { columns: { ...keep("id", "user_id", "requested_by", "status", "decided_by", "decided_at", "created_at"), reason: "text", decision_note: "text" } },
  owner_record: { empty: true, why: "staging has its own owner, set up fresh with the staging OWNER_EMAIL" },
};
// app_settings rows that must not reach staging: the IP-hashing key and the production owner bootstrap.
export const SETTINGS_REMOVED = ["sec:%", "owner_bootstrap"];
const PROTECTIVE_TRIGGERS = ["owner_record_no_update", "owner_record_no_delete", "audit_log_no_update", "audit_log_min_retention"];

// Tables that are SQLite/FTS internals rather than Academy tables.
const internal = (name: string) => name.startsWith("sqlite_") || name.startsWith("_cf_") || /^resource_chunks_/.test(name);
export const tablesOf = (schema: SchemaEntry[]) => schema.filter((s) => s.type === "table" && !internal(s.name)).map((s) => s.name);

// Every table and column of a schema must have a rule; returns the gaps (empty = fully covered).
export function coverage(schema: SchemaEntry[], columnsOf: (table: string) => string[]): string[] {
  const gaps: string[] = [];
  for (const t of tablesOf(schema)) {
    const p = POLICY[t];
    if (!p) { gaps.push(`table ${t} has no anonymisation rule`); continue; }
    if ("empty" in p) continue;
    for (const c of columnsOf(t)) if (!p.columns[c]) gaps.push(`column ${t}.${c} has no anonymisation rule`);
    for (const c of Object.keys(p.columns)) if (!columnsOf(t).includes(c)) gaps.push(`rule for ${t}.${c}, which does not exist`);
  }
  return gaps;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
function expr(table: string, col: string, rule: Rule): string | null {
  const c = q(col), n = "rowid";
  switch (rule) {
    case "keep": return null;
    case "null": return "NULL";
    case "email": return `CASE WHEN ${c} IS NULL THEN NULL ELSE printf('anon-${table.replace(/_/g, "-")}-%d@${STAGING_DOMAIN}', ${n}) END`;
    case "name": return `CASE WHEN ${c} IS NULL THEN NULL ELSE printf('Test Person %d', ${n}) END`;
    case "first_name": return `CASE WHEN ${c} IS NULL THEN NULL ELSE 'Test' END`;
    case "surname": return `CASE WHEN ${c} IS NULL THEN NULL ELSE printf('Person %d', ${n}) END`;
    case "phone": return `CASE WHEN ${c} IS NULL THEN NULL ELSE printf('+000%08d', ${n}) END`;
    case "text": return `CASE WHEN ${c} IS NULL THEN NULL ELSE '[anonymised]' END`;
    case "json_object": return `CASE WHEN ${c} IS NULL THEN NULL ELSE '{}' END`;
    case "ref": return `CASE WHEN ${c} IS NULL THEN NULL ELSE printf('ANON-${table.toUpperCase()}-%d', ${n}) END`;
  }
}

// The SQL that anonymises an isolated copy. Pure: tested without a database.
export function anonymiseSql(schema: SchemaEntry[]): string[] {
  const out: string[] = PROTECTIVE_TRIGGERS.map((t) => `DROP TRIGGER IF EXISTS ${q(t)}`);
  for (const t of tablesOf(schema)) {
    const p = POLICY[t];
    if (!p) throw new D1Error(`table ${t} has no anonymisation rule`);
    if ("empty" in p) { out.push(`DELETE FROM ${q(t)}`); continue; }
    const sets = Object.entries(p.columns).map(([c, r]) => [c, expr(t, c, r)] as const).filter(([, e]) => e).map(([c, e]) => `${q(c)} = ${e}`);
    if (sets.length) out.push(`UPDATE ${q(t)} SET ${sets.join(", ")}`);
  }
  out.push(`DELETE FROM app_settings WHERE ${SETTINGS_REMOVED.map((k) => `key LIKE '${k}'`).join(" OR ")}`);
  // Settings values written by people can carry addresses: none survive.
  out.push(`UPDATE app_settings SET value = '{}' WHERE value LIKE '%@%'`);
  for (const s of schema) if (s.type === "trigger" && PROTECTIVE_TRIGGERS.includes(s.name)) out.push(s.sql);
  return out;
}

type Data = Map<string, { columns: string[]; rows: unknown[][] }>;
// Values that must not survive: everything held in a column the policy replaces or clears (short values are ignored,
// they would match by coincidence). Emptied tables are checked separately (they must have no rows at all).
export function sensitiveValues(data: Data): Set<string> {
  const out = new Set<string>();
  for (const [t, { columns, rows }] of data) {
    const p = POLICY[t]; if (!p || "empty" in p) continue;
    columns.forEach((c, i) => {
      const r = p.columns[c];
      if (r === "keep" || !r) return;
      for (const row of rows) { const v = row[i]; if (typeof v === "string" && v.trim().length >= 6 && v !== "[anonymised]" && v !== "{}") out.add(v.trim()); }
    });
  }
  return out;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
export function verifyAnonymised(before: Set<string>, after: Data): string[] {
  const problems: string[] = [];
  for (const t of ["auth_tokens", "auth_sessions", "mfa_factors", "mfa_recovery_codes", "owner_record", "webhook_events", "rate_limits"]) {
    const d = after.get(t); if (d && d.rows.length) problems.push(`${t} still has ${d.rows.length} rows`);
  }
  const settings = after.get("app_settings");
  if (settings) { const k = settings.columns.indexOf("key"); for (const r of settings.rows) if (String(r[k]).startsWith("sec:") || r[k] === "owner_bootstrap") problems.push(`app_settings still holds ${r[k]}`); }
  for (const [t, { columns, rows }] of after) for (const row of rows) row.forEach((v, i) => {
    if (typeof v !== "string") return;
    for (const m of v.matchAll(EMAIL_RE)) if (m[1].toLowerCase() !== STAGING_DOMAIN) { problems.push(`${t}.${columns[i]} holds an address outside ${STAGING_DOMAIN}`); break; }
    for (const s of before) if (v.includes(s)) { problems.push(`${t}.${columns[i]} still contains an original value`); break; }
  });
  return [...new Set(problems)];
}

export type AnonReport = { ok: boolean; at: string; restoreOk: boolean; gaps: string[]; problems: string[]; tables: number; originalValuesChecked: number; out: { file: string; manifestFile: string } | null };

// Anonymises an ISOLATED LOCAL target in place, verifies it and (optionally) writes the SQL file.
export function anonymiseLocal(t: Target, outDir?: string): Omit<AnonReport, "restoreOk" | "at"> {
  if (t.kind !== "local") throw new D1Error("Anonymisation runs only on an isolated local copy.");
  const schema = readSchema(t);
  const tables = tablesOf(schema);
  const info = query(t, tables.map((table) => `PRAGMA table_info(${q(table)})`).join(";\n")); // one Wrangler call
  const cols = new Map(tables.map((table, i) => [table, (info[i] ?? []).map((r) => String(r.name))]));
  const gaps = coverage(schema, (table) => cols.get(table) ?? []);
  if (gaps.length) return { ok: false, gaps, problems: [], tables: 0, originalValuesChecked: 0, out: null };
  const before = sensitiveValues(readAll(t).data);
  // Wrangler's --command splitter cannot take trigger bodies (BEGIN ... ; END) inside a batch: data statements go as one
  // batch, each trigger on its own.
  const statements = anonymiseSql(schema);
  const isTrigger = (x: string) => /^CREATE\s+TRIGGER/i.test(x);
  execLocal(t, statements.filter((x) => !isTrigger(x)).join(";\n") + ";");
  for (const tr of statements.filter(isTrigger)) execLocal(t, tr);
  const after = readAll(t).data;
  const problems = verifyAnonymised(before, after);
  const triggers = new Set(readSchema(t).filter((s) => s.type === "trigger").map((s) => s.name));
  for (const tr of PROTECTIVE_TRIGGERS) if (!triggers.has(tr)) problems.push(`protective trigger ${tr} was not re-created`);
  let out: AnonReport["out"] = null;
  if (!problems.length && outDir) { const b = backup(t, outDir, { label: "staging-anonymised" }); out = { file: b.file, manifestFile: b.manifestFile }; }
  return { ok: problems.length === 0, gaps, problems, tables: after.size, originalValuesChecked: before.size, out };
}

export function anonymiseBackup(o: { backup: string; manifest: string; privateKey?: string; out: string }): AnonReport {
  const out = resolve(o.out);
  if (existsSync(out) && readdirSync(out).length) throw new D1Error(`${out} is not empty: choose a new, empty directory.`);
  mkdirSync(out, { recursive: true });
  const restore = verifyRestore(o.backup, { isolatedDir: join(out, "isolated"), manifestFile: o.manifest, privateKey: o.privateKey, reportFile: join(out, "restore-report.json"), keep: true });
  const at = new Date().toISOString();
  if (!restore.ok) return { ok: false, at, restoreOk: false, gaps: [], problems: ["the backup did not pass restore verification (see restore-report.json)"], tables: 0, originalValuesChecked: 0, out: null };
  const r = anonymiseLocal(localTarget(join(out, "isolated", "db"), { reuse: true }), join(out, "anonymised"));
  const report: AnonReport = { ...r, at, restoreOk: true };
  writeFileSync(join(out, "anonymise-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const [bk, mf, out] = [a.str("backup"), a.str("manifest"), a.str("out")];
  if (!bk || !mf || !out) { console.error("Usage: npm run db:anonymise -- --backup <file> --manifest <manifest.json> [--private-key <pem>] --out <empty dir>"); process.exit(2); }
  const r = anonymiseBackup({ backup: bk, manifest: mf, privateKey: a.str("private-key"), out });
  for (const g of [...r.gaps, ...r.problems]) console.error(`  - ${g}`);
  console.log(r.ok ? `ANONYMISED COPY VERIFIED: ${r.tables} tables, ${r.originalValuesChecked} original values confirmed absent. SQL: ${r.out?.file}` : "ANONYMISATION REFUSED OR FAILED (nothing written for staging).");
  process.exit(r.ok ? 0 : 1);
}

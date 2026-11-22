// SQLite-aware SQL statement splitter and migration-statement classifier (Stage 3A).
//
// Why not split on ";"? Migration 0010 contains CREATE TRIGGER ... BEGIN ...; ...; END; blocks, whose bodies contain
// semicolons, and string literals or comments may contain semicolons too. This tokenizer understands:
//   - '...' string literals (with '' escapes), "..." / `...` / [...] quoted identifiers,
//   - -- line comments and /* block comments */,
//   - CREATE [TEMP|TEMPORARY] TRIGGER ... BEGIN ... END bodies, including CASE ... END expressions inside them.
// It is conservative: anything it cannot interpret with certainty (an unterminated string, identifier, comment or trigger
// body, or a stray END) is REFUSED with an error rather than guessed. Callers must treat that as a failed check.

export class SqlParseError extends Error {}

export type Statement = {
  text: string;      // the statement exactly as written (without the final ";"), trimmed
  code: string;      // the statement with comments removed and whitespace collapsed (for classification)
  line: number;      // 1-based line where the statement starts
  isTrigger: boolean;
  body?: string[];   // for triggers: the statements inside BEGIN ... END (code form)
};

// Splits SQL text into statements. Throws SqlParseError on ambiguous input.
export function splitSql(sql: string): Statement[] {
  const out: Statement[] = [];
  let i = 0, start = 0, line = 1, startLine = 1;
  let words: string[] = [];        // upper-cased words of the current statement at nesting level 0 (code only)
  let inTrigger = false, sawBegin = false, caseDepth = 0;
  let code = "";                   // comment-free text of the current statement
  const n = sql.length;
  const word = (w: string) => {
    const u = w.toUpperCase();
    words.push(u);
    // CREATE TRIGGER / CREATE TEMP TRIGGER / CREATE TEMPORARY TRIGGER (exact positions, so a column named "trigger" is not one)
    if (!inTrigger && words[0] === "CREATE" && ((words.length === 2 && u === "TRIGGER") || (words.length === 3 && u === "TRIGGER" && /^TEMP(ORARY)?$/.test(words[1])))) inTrigger = true;
    if (inTrigger) {
      if (u === "BEGIN" && !sawBegin) sawBegin = true;
      else if (sawBegin && u === "CASE") caseDepth++;
      else if (sawBegin && u === "END") {
        if (caseDepth > 0) caseDepth--;
        else { inTrigger = false; sawBegin = false; }
      }
    }
  };
  const flush = (end: number) => {
    const text = sql.slice(start, end).trim();
    const c = code.replace(/\s+/g, " ").trim();
    if (c) {
      if (inTrigger) throw new SqlParseError(`Unterminated CREATE TRIGGER starting at line ${startLine}: no END found.`);
      const isTrigger = /^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(c);
      const st: Statement = { text, code: c, line: startLine, isTrigger };
      if (isTrigger) st.body = triggerBody(c, startLine);
      out.push(st);
    }
    code = ""; words = []; inTrigger = false; sawBegin = false; caseDepth = 0;
  };
  let fresh = true;
  while (i < n) {
    const ch = sql[i];
    if (fresh && !/\s/.test(ch) && !(ch === "-" && sql[i + 1] === "-") && !(ch === "/" && sql[i + 1] === "*")) { startLine = line; fresh = false; }
    if (ch === "\n") { line++; code += ch; i++; continue; }
    if (ch === "-" && sql[i + 1] === "-") { const e = sql.indexOf("\n", i); i = e === -1 ? n : e; code += " "; continue; }
    if (ch === "/" && sql[i + 1] === "*") {
      const e = sql.indexOf("*/", i + 2);
      if (e === -1) throw new SqlParseError(`Unterminated /* comment at line ${line}.`);
      line += (sql.slice(i, e).match(/\n/g) ?? []).length;
      i = e + 2; code += " "; continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new SqlParseError(`Unterminated ${ch === "'" ? "string literal" : "quoted identifier"} starting at line ${line}.`);
        if (sql[j] === close) { if (close !== "]" && sql[j + 1] === close) { j += 2; continue; } break; }
        j++;
      }
      const lit = sql.slice(i, j + 1);
      line += (lit.match(/\n/g) ?? []).length;
      code += lit; i = j + 1; words.push(ch === "'" ? "<STR>" : "<ID>"); continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      const w = sql.slice(i, j);
      word(w); code += w; i = j; continue;
    }
    if (ch === ";") {
      if (inTrigger) { code += ";"; i++; continue; }   // a statement inside a trigger body
      flush(i); i++; start = i; fresh = true; continue;
    }
    code += ch; i++;
  }
  flush(n);
  return out;
}

// The statements between BEGIN and the final END of a CREATE TRIGGER (comment-free code form).
function triggerBody(code: string, line: number): string[] {
  const m = code.match(/\bBEGIN\b([\s\S]*)\bEND\s*$/i);
  if (!m) throw new SqlParseError(`CREATE TRIGGER at line ${line} has no BEGIN ... END body.`);
  return splitSql(m[1]).map((s) => s.code);
}

// ---- classification of migration statements ----
export type Severity = "safe" | "review" | "destructive" | "forbidden";
export type Finding = { line: number; severity: Severity; kind: string; statement: string };

const SAFE_START = /^(CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TABLE|CREATE\s+VIRTUAL\s+TABLE|CREATE\s+VIEW|INSERT\s+INTO|INSERT\s+OR\s+IGNORE\s+INTO|ALTER\s+TABLE\s+\S+\s+ADD\s+(COLUMN\s+)?|SELECT)\b/i;

// What a single statement does to existing data or schema.
export function classify(s: Statement): Finding[] {
  const c = s.code;
  const short = c.length > 160 ? `${c.slice(0, 157)}...` : c;
  const f = (severity: Severity, kind: string): Finding => ({ line: s.line, severity, kind, statement: short });
  if (s.isTrigger) {
    // Creating a trigger is additive. A trigger whose body changes or removes data is reviewed (it acts on future writes).
    const writes = (s.body ?? []).filter((b) => /^(DELETE|UPDATE|INSERT|REPLACE|DROP)\b/i.test(b));
    return writes.length ? [f("review", "trigger body writes data")] : [];
  }
  if (/^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(c)) return [f("forbidden", "transaction control (not allowed in D1 migrations)")];
  if (/^(ATTACH|DETACH|VACUUM)\b/i.test(c)) return [f("forbidden", c.split(" ")[0].toUpperCase())];
  if (/^DROP\s+TABLE\b/i.test(c)) return [f("destructive", "DROP TABLE")];
  if (/^DROP\s+(INDEX|VIEW|TRIGGER)\b/i.test(c)) return [f("destructive", `DROP ${c.split(/\s+/)[1].toUpperCase()}`)];
  if (/^TRUNCATE\b/i.test(c)) return [f("destructive", "TRUNCATE")];
  if (/^DELETE\b/i.test(c)) return [f("destructive", /\bWHERE\b/i.test(c) ? "DELETE (with WHERE)" : "DELETE (every row)")];
  if (/^ALTER\s+TABLE\s+\S+\s+DROP\b/i.test(c)) return [f("destructive", "ALTER TABLE ... DROP COLUMN")];
  if (/^ALTER\s+TABLE\s+\S+\s+RENAME\b/i.test(c)) return [f("destructive", "ALTER TABLE ... RENAME")];
  if (/^UPDATE\b/i.test(c)) return [f(/\bWHERE\b/i.test(c) ? "review" : "destructive", /\bWHERE\b/i.test(c) ? "UPDATE (data backfill with WHERE)" : "UPDATE (every row)")];
  if (/^(REPLACE\s+INTO|INSERT\s+OR\s+REPLACE)\b/i.test(c)) return [f("review", "REPLACE (overwrites existing rows)")];
  if (/^INSERT\b/i.test(c) && /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i.test(c)) return [f("review", "UPSERT (updates existing rows)")];
  if (/^PRAGMA\b/i.test(c)) return [f("review", "PRAGMA")];
  if (/^WITH\b/i.test(c)) return [f("review", "WITH ... (check what the statement writes)")];
  if (SAFE_START.test(c)) return [];
  return [f("review", "unrecognised statement")];
}

export function classifySql(sql: string): { statements: number; findings: Finding[] } {
  const st = splitSql(sql);
  return { statements: st.length, findings: st.flatMap(classify) };
}

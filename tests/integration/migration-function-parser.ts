/**
 * Parse every `CREATE [OR REPLACE] FUNCTION` definition from prisma/migrations.
 *
 * Migration order = lexicographic directory order; for a function name redefined
 * across migrations the LAST definition (highest-ordered migration) wins.
 *
 * Handles:
 *   - quoted ("name") and unquoted (protect_x) function names
 *   - `$$`, `$function$` and arbitrary `$tag$` body delimiters
 *   - `AS $$` on its own line or inline on the CREATE line
 *
 * Returns a Map<functionName, { body, sourceMigration }> where `body` is the
 * whitespace-normalised function source (prosrc equivalent) and sourceMigration
 * is the directory name of the migration that last defined it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface FunctionDef {
  name: string;
  body: string; // whitespace-normalised function source
  sourceMigration: string; // directory name of the migration that defined it
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strip a leading schema-qualified / quoted name down to the bare identifier. */
function bareName(raw: string): string {
  const cleaned = raw.trim().replace(/^public\./, "");
  if (cleaned.startsWith('"')) {
    // quoted identifier, possibly schema-qualified "public"."name"
    const parts = cleaned.match(/"(?:[^"]|"")*"/g);
    if (parts && parts.length > 0) {
      const last = parts[parts.length - 1]!;
      return last.slice(1, -1).replace(/""/g, '"');
    }
  }
  return cleaned.replace(/"/g, "");
}

/**
 * Extract function definitions from a single migration.sql file.
 * Returns an array ordered by appearance in the file.
 */
export function parseMigrationFunctions(sql: string): Omit<FunctionDef, "sourceMigration">[] {
  const defs: Omit<FunctionDef, "sourceMigration">[] = [];
  // CREATE [OR REPLACE] FUNCTION <name>(...)
  const createRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"[^"]*"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]*"|[A-Za-z_][\w$]*))?)/gi;

  let m: RegExpExecArray | null;
  while ((m = createRe.exec(sql)) !== null) {
    const nameRaw = m[1]!;
    const name = bareName(nameRaw);
    const afterName = sql.slice(m.index + m[0].length);

    // Locate the AS $delim$ body opener.
    const asRe = /\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i;
    const asMatch = asRe.exec(afterName);
    if (!asMatch) {
      throw new Error(`CREATE FUNCTION "${name}": no 'AS \$tag\$' body opener found`);
    }
    const delim = asMatch[1]!;
    const bodyStart = asMatch.index + asMatch[0].length;
    const bodySource = afterName.slice(bodyStart);

    // Find the matching closing delimiter (same tag).
    const closeIdx = bodySource.indexOf(delim);
    if (closeIdx === -1) {
      throw new Error(`CREATE FUNCTION "${name}": no closing delimiter ${delim} found`);
    }
    const rawBody = bodySource.slice(0, closeIdx);

    defs.push({ name, body: normalizeWhitespace(rawBody) });
  }
  return defs;
}

/**
 * Load all function definitions from prisma/migrations.
 * Lexicographic directory order; last definition of a name wins.
 */
export function loadExpectedFunctions(migrationsDir: string): Map<string, FunctionDef> {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const expected = new Map<string, FunctionDef>();
  for (const dir of dirs) {
    const sqlPath = join(migrationsDir, dir, "migration.sql");
    let sql: string;
    try {
      sql = readFileSync(sqlPath, "utf8");
    } catch {
      continue; // no migration.sql in this dir
    }
    const defs = parseMigrationFunctions(sql);
    for (const def of defs) {
      expected.set(def.name, {
        ...def,
        sourceMigration: dir,
      });
    }
  }
  return expected;
}

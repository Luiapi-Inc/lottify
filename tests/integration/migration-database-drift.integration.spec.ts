import "reflect-metadata";
import { beforeAll, describe, expect, it } from "vitest";
import { loadExpectedFunctions } from "./migration-function-parser";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

/**
 * Migration-ledger drift guard.
 *
 * `prisma migrate status` only compares `_prisma_migrations`; it cannot see a
 * trigger/function body that was reverted or altered directly on the database,
 * nor objects applied from migrations on unmerged branches. The only symptom of
 * such drift is an unrelated integration assertion failing against the shared
 * dev database while CI (fresh Postgres) stays green.
 *
 * This suite compares the actual `pg_proc` bodies of every function the committed
 * migrations define against the migration source itself (whitespace-normalised,
 * migration order = lexicographic directory order, last definition of a name
 * wins). It also reports functions present on the database that no committed
 * migration defines — the signature of migrations applied from unmerged branches.
 *
 * Failures name the drifted function and the migration that should define it, so
 * the hazard surfaces here instead of deep inside an unrelated assertion.
 */
const FUNCTION_NAMES_FROM_COMMITTED_MIGRATIONS = new Set(loadExpectedFunctions("prisma/migrations").keys());

interface PublicFunctionRow {
  proname: string;
  prosrc: string;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe.runIf(runIntegration)("Migration-ledger database drift", () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  it("every function defined by a committed migration matches its pg_proc body", async () => {
    const expected = loadExpectedFunctions("prisma/migrations");
    const rows = await prisma.$queryRaw<PublicFunctionRow[]>`
      SELECT p.proname, p.prosrc
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.prokind = 'f'
    `;
    const deployed = new Map(rows.map((r) => [r.proname, normalizeWhitespace(r.prosrc)]));

    const drifted: string[] = [];
    for (const [name, def] of expected) {
      const actual = deployed.get(name);
      if (actual === undefined) {
        drifted.push(
          `${name}: function is MISSING on the database; migration ${def.sourceMigration} should define it`,
        );
        continue;
      }
      if (actual !== def.body) {
        drifted.push(
          `${name}: body has DRIFTED from the committed migration; migration ${def.sourceMigration} should define it`,
        );
      }
    }

    expect(drifted, [
      "Migration-ledger drift detected. `prisma migrate status` reports 'up to date' but these",
      "function bodies do not match the committed prisma/migrations source. Recreate the shared",
      "database from migrations, or repair the drifted functions in place:",
      ...drifted.map((d) => `  - ${d}`),
    ].join("\n")).toEqual([]);
  });

  it("reports functions on the database that no committed migration defines", async () => {
    const rows = await prisma.$queryRaw<PublicFunctionRow[]>`
      SELECT p.proname, p.prosrc
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.prokind = 'f'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = p.oid AND d.deptype = 'e'
        )
    `;
    const orphanNames = rows
      .map((r) => r.proname)
      .filter((name) => !FUNCTION_NAMES_FROM_COMMITTED_MIGRATIONS.has(name))
      .sort();

    expect(orphanNames, [
      "The database defines functions that no committed prisma/migrations file defines.",
      "This is the signature of migrations applied from unmerged branches. Commit and merge",
      "the owning migration, or drop the orphaned objects so the database matches the code:",
      ...orphanNames.map((n) => `  - ${n}`),
    ].join("\n")).toEqual([]);
  });
});

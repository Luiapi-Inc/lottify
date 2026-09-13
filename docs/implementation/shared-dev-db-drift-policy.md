# Shared development database policy: migration-ledger drift

Status: adopted 2026-09-10

Applies to the shared development Postgres at `172.31.20.69` (`lottify_dev`), the single
mutation surface shared by every Lottify codex worktree.

## The class of failure this guards against

`prisma migrate status` compares only the `_prisma_migrations` ledger. It cannot see two
real forms of drift, and both were encountered together on `lottify_dev` during
`t_efaeb194` (closed-period rejection failing only against the shared DB):

1. **Reverted / hand-edited function or trigger bodies.** A function body was reverted to a
   pre-close form while the ledger still recorded its migration as applied with a matching
   checksum. `prisma migrate status` reported "Database schema is up to date", and no
   migration-ledger tool could detect or repair it.
2. **Objects applied from migrations on unmerged branches.** Seven migrations that exist only
   on unmerged branches had been deployed to `lottify_dev`. Their functions
   (`promotion_campaign_versions_immutable_guard`, `promotion_entitlements_snapshot_guard`,
   `promotion_turnover_entries_append_only_guard`, `protect_bet_receipt_immutability`,
   `protect_result_revision_immutability`) are absent from any committed migration, so a
   re-created-from-scratch database will not have them.

The symptom of both is an unrelated integration assertion failing locally while CI (fresh
`postgres:18`) stays green — which reads like a flaky or data-polluted test. That
misdiagnosis is what created `t_efaeb194`.

## The drift check

`tests/integration/migration-database-drift.integration.spec.ts` (gated on
`RUN_INTEGRATION_TESTS=1`) compares every function the committed `prisma/migrations` define
against the deployed `pg_proc` bodies:

- Parses each migration for `CREATE [OR REPLACE] FUNCTION` bodies (quoted and unquoted
  names, `$$` and `$tag$` delimiters), whitespace-normalised.
- Migration order = lexicographic directory order; the last definition of a name wins.
- **Fails loudly** naming the drifted/missing function and the migration that should define
  it.
- Independently fails if the database defines a function that no committed migration defines
  — the signature of migrations applied from unmerged branches.

Run it after any migration is deployed to `lottify_dev` and before chasing a
local-only test failure.

## Decided policy

1. **Merge before apply.** A migration must be on `main` (its owning branch merged) before it
   is applied to `lottify_dev`. Applying a migration from an unmerged branch is prohibited:
   it makes the shared DB diverge from every fresh environment and hides under a
   "up to date" ledger. If work must be validated against the shared DB before its branch
   merges, use a throwaway database (e.g. `lottify_<feature>_<suffix>`) and drop it when the
   branch merges.
2. **Recreate on drift.** When the drift check reports drift, do not hand-edit the shared DB.
   Recreate `lottify_dev` from `prisma migrate deploy` (or repair the drifted function body
   in place only when a full recreate is impractical, and say so in the card's evidence).
3. **Do not trust the ledger alone.** `prisma migrate status` "up to date" is not proof the
   database matches the code. The drift check is the authority; run it against `lottify_dev`
   on every relevant vertical before relying on a green local integration run.

## Record-keeping gap

`prisma migrate deploy` + `prisma migrate status` cannot detect reverted function bodies or
objects applied from unmerged branches. The `_prisma_migrations` ledger is therefore a
sufficient-but-not-necessary record of what should exist, never a guarantee of what does
exist. The drift check exists to close this gap; keep it green as the standing proof that
`lottify_dev` matches the committed migrations.

## Drift repair record — 2026-09-13

The shared `lottify_dev` database was checked from `main` after PR #96. The
read-only drift guard failed because `enforce_financial_transaction_accounting_period_membership`
had drifted from committed migration `20260905140000_accounting_period_close`; no orphan
functions from unmerged migrations were reported.

Because the mismatch was a single function body and a full shared database recreate was
unnecessary for this repair, the committed `CREATE OR REPLACE FUNCTION` body from
`prisma/migrations/20260905140000_accounting_period_close/migration.sql` was re-applied
in place. No data was changed.

Post-repair evidence:

- `RUN_INTEGRATION_TESTS=1 pnpm vitest run tests/integration/migration-database-drift.integration.spec.ts tests/integration/accounting-period-database-guards.integration.spec.ts` — 5 passed.
- `migration-database-drift.integration.spec.ts` proved every committed migration function body matched `pg_proc` and no uncommitted orphan functions were present.
- `accounting-period-database-guards.integration.spec.ts` proved CLOSED Accounting Period posting rejection, OPEN posting acceptance, and CLOSED terminal-state enforcement against the repaired shared database.

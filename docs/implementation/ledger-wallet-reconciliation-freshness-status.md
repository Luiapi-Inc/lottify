# Ledger ↔ Wallet reconciliation freshness implementation status

Source of truth: GitHub Issue #23 and Wayfinder Tickets 13, 14, 15, 16, and 19. This record does
not redefine those requirements.

## Work package

The `payment-reconciliation` worker group continuously discovers Wallet & Ledger reconciliation
targets through the Wallet & Ledger application boundary, runs the accepted Reporting
reconciliation service with deterministic checkpoint identities, and emits operational signals for
new mismatches, stale monetary discrepancies, and critical discrepancies. The worker and alert sink
do not own or mutate financial authority.

## Traceability matrix

| Requirement | Implementation | Test/evidence |
| --- | --- | --- |
| Detect Ledger ↔ Wallet mismatches within one minute | 30-second freshness cycle in `LedgerWalletReconciliationFreshnessWorker` | `tests/unit/ledger-wallet-reconciliation-freshness.worker.spec.ts`; PostgreSQL/operational run pending |
| Discover targets behind Wallet & Ledger boundary | `FinancialLedgerService.listReconciliationTargets` and paged repository query | `tests/integration/ledger-wallet-reconciliation.integration.spec.ts`; unit pagination/retry coverage |
| Deterministic/idempotent checkpoints | `ledgerWalletFreshnessCheckpointKey` plus accepted reconciliation replay/conflict handling | reconciliation integration replay test and worker retry unit test |
| Alert on mismatch, stale monetary discrepancy, and critical discrepancy | `OperationalAlertSink` with Sentry implementation and explicit alert codes | worker unit alert assertions; production alert delivery evidence pending |
| Preserve financial authority | Reporting persists only reconciliation evidence; worker reads application ports and emits alerts | integration authority-count assertion; PostgreSQL candidate evidence pending |
| No numeric high-value threshold invented | Critical escalation uses explicit persisted `CRITICAL` severity only | source/spec review |

## Local verification

- Focused worker, architecture, and financial invariant tests pass.
- Full local Vitest suite passes; database-backed integration suites remain environment-gated.
- TypeScript typecheck and full application build pass.
- `git diff --check` passes.

## Pending acceptance evidence

Issue #23 requires one immutable CI candidate with PostgreSQL migration deploy, deterministic
integration/operational evidence, dependency and image scans, and container smokes. This workspace
does not currently have the required database/Redis environment variables, so those evidence cells
remain open and no Production GO or Issue #23 completion claim is made here.

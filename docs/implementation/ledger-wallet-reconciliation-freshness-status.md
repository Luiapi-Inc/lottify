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
| Detect Ledger ↔ Wallet mismatches within one minute | 30-second freshness cycle in `LedgerWalletReconciliationFreshnessWorker` | `tests/unit/ledger-wallet-reconciliation-freshness.worker.spec.ts`; PostgreSQL/operational evidence passes in CI run [34043507094](https://github.com/luiapi-sys/lottify/actions/runs/34043507094) |
| Discover targets behind Wallet & Ledger boundary | `FinancialLedgerService.listReconciliationTargets` and paged repository query | `tests/integration/ledger-wallet-reconciliation.integration.spec.ts`; unit pagination/retry coverage |
| Deterministic/idempotent checkpoints | `ledgerWalletFreshnessCheckpointKey` plus accepted reconciliation replay/conflict handling | reconciliation integration replay test and worker retry unit test |
| Alert on mismatch, stale monetary discrepancy, and critical discrepancy | `OperationalAlertSink` with Sentry implementation and explicit alert codes | worker unit alert assertions plus deterministic PostgreSQL/operational scenarios in CI run [34043507094](https://github.com/luiapi-sys/lottify/actions/runs/34043507094) |
| Preserve financial authority | Reporting persists only reconciliation evidence; worker reads application ports and emits alerts | integration authority-count assertion plus PostgreSQL migration/integration evidence in CI run [34043507094](https://github.com/luiapi-sys/lottify/actions/runs/34043507094) |
| No numeric high-value threshold invented | Critical escalation uses explicit persisted `CRITICAL` severity only | source/spec review |

## Local verification

- Focused worker, architecture, and financial invariant tests pass.
- `pnpm prisma:generate` passes with the workspace environment.
- PostgreSQL migration deploy passes for all 14 migrations, including
  `20260906164500_ledger_wallet_reconciliation`.
- Ledger ↔ Wallet PostgreSQL integration evidence passes all 4 scenarios, including checkpoint
  replay/conflict, durable mismatch evidence, authority preservation, alert-age evaluation, and
  bounded target paging.
- Accounting Period PostgreSQL evidence passes backfill 2/2, contract migration 5/5, and reporting
  1/1 dedicated scenarios.
- Redis access was restored by allowing TCP 6379 from the Hermes security group to the existing
  Redis container; Redis `PING` returns `PONG` and the foundation Redis/BullMQ scenario passes.
- The full integration-enabled suite passes 239 tests on a clean migrated PostgreSQL test database,
  including the 6 foundation, 25 Admin Accounting Period, 18 Financial Core, and 4 Ledger ↔ Wallet
  integration scenarios.
- Dedicated Accounting Period backfill 2/2, contract migration 5/5, and reporting 1/1 scenarios
  also pass on the same clean database.
- TypeScript typecheck and full application build pass from the same source HEAD.
- `git diff --check` passes.
- Immutable candidate commit `daf7ccc9a8a446c1c3c1c7bc38eaf9a04883ad03` passed GitHub Actions run
  [34043507094](https://github.com/luiapi-sys/lottify/actions/runs/34043507094): PostgreSQL migration deploy,
  deterministic integration suites, typecheck, production dependency scan, full build, all four OCI
  image vulnerability scans, and API/worker/Member/Admin container smokes.

## Acceptance status

Issue #23 acceptance evidence is complete for the immutable candidate above. Production deployment
remains out of scope for this work package, and no Production GO claim is made here.

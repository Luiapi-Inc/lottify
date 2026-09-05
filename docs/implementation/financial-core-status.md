# Financial core milestone implementation status

Source of truth: Wayfinder Tickets 04, 16, and 19. This record does not redefine those requirements.

## Accepted checkpoints

- Member Ledger buckets are locked to `CASH`, `BONUS`, and `LOCKED`.
- THB v1 posting amounts are represented as exact integer minor units (satang) rather than binary floating point.
- A financial posting set must contain at least two positive postings and balance total debit to total credit before it can be accepted by the domain invariant layer.
- Wallet availability follows the locked formula `posted spendable balance - active reservations`.
- Active Reservation amounts must be positive, and a new Reservation is rejected when it would exceed the remaining available spendable balance.
- Immutable Financial Transaction/posting and durable Reservation persistence are implemented with business/correlation/idempotency identity, domain references, timestamps, Reservation allocations, release/consume state, and correction linkage fields required by the current financial-core contracts.
- Reservation create/release is idempotent and persistence-backed. Reservation creation serializes the authoritative account state so concurrent requests cannot overspend the same available balance.
- Reservation consumption and its resulting Ledger posting are atomic in one PostgreSQL transaction. The final Member debit postings use the persisted Reservation source allocation, preserving accepted mixed `CASH`/`BONUS` funding rather than recomputing from current balances.
- Released Reservations cannot be consumed. Exact idempotent consume replay returns the original Financial Transaction; conflicting replay is rejected; concurrent alternate consume identities produce one financial effect only.
- Member Wallet projection is derived from authoritative Ledger postings plus active Reservation allocations in one repeatable-read snapshot across `CASH`, `BONUS`, and `LOCKED`; missing buckets project as zero rather than becoming an alternate balance authority.
- `LOCKED` value is never exposed as available spendable balance. Withdrawal Reservation sources remain `CASH` only, and Bet Reservation sources are restricted to `CASH`/`BONUS` so `LOCKED` cannot be consumed as stake.

## Evidence confirmed on 2026-09-05

- Domain-invariant checkpoint: focused financial-invariant unit tests passed; full local unit/architecture suite and TypeScript typecheck passed.
- Persistence/concurrency checkpoint commit `95dc7db54c88892c72fc2aa9d5f15522e2f9113d`: GitHub Actions run `33941017223` completed successfully, including migration, deterministic integration tests, typecheck, dependency scan, build, OCI image scans, and API/worker/Member/Admin container smokes.
- Atomic Reservation consume + Ledger posting checkpoint commit `75e2afce863fb29e3321cd4cb7367dbf2b0f77d2`: local typecheck passed; local test suite reported 57 passed with integration tests skipped because no local integration database was enabled. GitHub Actions run `33942236945` completed successfully, including migration, deterministic integration tests, typecheck, dependency scan, build, all OCI image scans, and API/worker/Member/Admin container smokes.
- Atomic-consume integration evidence covers persisted mixed-bucket allocation, exact idempotent replay, released-Reservation rejection, concurrent consume serialization, and forced-failure rollback proving Reservation consume state and Ledger posting commit or roll back together.
- Wallet projection checkpoint commit `765d5267e5738f06189ddc4b2383d2c5a6d57223`: local typecheck passed and 57 unit/architecture tests passed; GitHub Actions run `33942618690` completed successfully with deterministic financial integration tests, build, dependency/image scans, and API/worker/Member/Admin container smokes. Integration evidence proves Ledger-plus-active-Reservation bucket projection, `LOCKED` non-spendability, and `CASH`/`BONUS` Bet source enforcement.

## Remaining financial-core requirements

This checkpoint does not complete the financial-core prerequisite in Ticket 19. The following approved requirements still need implementation and acceptance evidence before money-moving downstream verticals can claim completion:

1. Reversal and business-semantic compensation behavior with immutable linkage and once-only semantics.
2. Accounting-period/effective-time enforcement, including rejection of postings/backdating into CLOSED periods and current-period correction linkage.
3. Recovery/debt behavior that can represent negative net position without exposing negative value as spendable `CASH`, with betting/withdrawal availability clamped to zero while unresolved according to policy.
4. Explicit fee posting behavior and the remaining Ticket 04 operation-specific posting invariants.
5. Durable reconciliation/discrepancy behavior across Ledger ↔ Wallet projection and the later dependent provider/betting/promotion seams; monetary resolution must use approved Adjustment/Compensation rather than direct balance edits.
6. Remaining deterministic Integration evidence required by Ticket 16 for each financial capability and downstream financial finalization as those work packages become eligible.

## Milestone disposition

The persistence/concurrency, atomic-consume, and authoritative Wallet-projection checkpoints are accepted, but the financial core is not yet complete. Withdrawal finalization and other downstream money-moving acceptance remain blocked until the remaining Ticket 04/16/19 prerequisites above are implemented and proven.

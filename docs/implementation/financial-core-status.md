# Financial core milestone implementation status

Source of truth: Wayfinder Tickets 04, 16, and 19. This record does not redefine those requirements.

## Implemented checkpoint

- Member Ledger buckets are locked to `CASH`, `BONUS`, and `LOCKED`.
- THB v1 posting amounts are represented as exact integer minor units (satang) rather than binary floating point.
- A financial posting set must contain at least two positive postings and balance total debit to total credit before it can be accepted by the domain invariant layer.
- Wallet availability follows the locked formula `posted spendable balance - active reservations`.
- Active Reservation amounts must be positive, and a new Reservation is rejected when it would exceed the remaining available spendable balance.
- This checkpoint deliberately introduces no Prisma schema, persistence contract, REST path, or cross-context orchestration shape that is not already locked by the specification.

## Evidence confirmed on 2026-09-05

- Focused financial-invariant unit tests: 9 passed.
- Full local unit/architecture suite: 57 passed; 6 Foundation integration tests were skipped because the local integration-test environment was not enabled.
- TypeScript typecheck passed.

## Remaining financial-core requirements

This checkpoint does not complete the financial-core prerequisite in Ticket 19. The following approved requirements still need implementation and acceptance evidence before money-moving downstream verticals can claim completion:

1. Immutable Financial Transaction and posting persistence with business/correlation/idempotency identity, domain references, effective/posted times, and reversal/compensation linkage.
2. Durable Reservation persistence with unique reservation/business identity and idempotent reserve/release/consume behavior.
3. Concurrency-safe reservation creation so simultaneous requests cannot drive availability below zero.
4. Atomic Reservation consumption together with the resulting authoritative Ledger posting.
5. Wallet projection derived from Ledger postings plus active Reservations, with Ledger remaining authoritative on disagreement.
6. Reversal/compensation, source-bucket allocation, period-close, recovery/debt, fee, and reconciliation invariants required by Ticket 04.
7. Deterministic Integration tests for Ledger balance/integrity, Reservation concurrency, idempotency/replay, and downstream financial finalization as required by Ticket 16.

## Milestone disposition

The financial-core domain-invariant checkpoint is implemented, but the financial core is not yet complete. Withdrawal finalization and other downstream money-moving acceptance remain blocked until the remaining Ticket 04/16/19 prerequisites above are implemented and proven.

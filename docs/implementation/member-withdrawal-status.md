# Member API Withdrawal vertical implementation status

Source of truth: Wayfinder Tickets 01, 02, 03, 06, 09, 10, 12, 16, and 19. This record does not redefine those requirements.

## Scope delivered

Payments-owned Withdrawal vertical on `/api/v1`, built on the accepted Wallet & Ledger financial core (Ticket 04/16 checkpoints recorded in `financial-core-status.md`):

- Payout Destination management: Member-linked add, list, read, and independent verification; sharing one destination across Members is blocked by default policy (Ticket 06).
- Withdrawal lifecycle `REQUESTED → RESERVING → REVIEWING → APPROVED → PAYOUT_PROCESSING → PAYOUT_CONFIRMED → FINALIZING → COMPLETED`, with `CANCELLING → CANCELLED`, policy/eligibility `REJECTED`, definitive-payout `FAILED`, and unknown-outcome `RECONCILING` (Ticket 03).
- Admin review/approval/payout/reconciliation surface with intent-specific queues, severity, evidence and `allowedActions` (Tickets 10/12).
- Provider-adapter seam for payout (Ticket 09) with a deterministic v1 binding, mirroring the accepted Deposit vertical.

## Locked implementation decisions

1. **Ownership.** Payments owns Withdrawal orchestration, Payout Destination state, and provider workflow state. Every balance effect goes through Wallet & Ledger: `WITHDRAWAL` Reservation on create (Member `CASH` only), authoritative release on cancel/reject/failure, and Reservation consumption plus the `WITHDRAWAL_FINALIZE` posting on finalization. Payments never mutates a balance and never becomes a second balance authority.
2. **Cross-context seams.** `WithdrawalLedgerPort` (Wallet & Ledger), `MemberWithdrawalRestrictionPort` (KYC/Risk capability restrictions), `PayoutProviderAdapter`, and `PayoutDestinationVerificationAdapter` are Payments-owned ports bound in the composition root; the context-boundary architecture test proves no direct cross-context import.
3. **Idempotency.** Withdrawal create is idempotent on a scoped `Idempotency-Key` (`WITHDRAWAL_CREATE:<memberId>`); Admin review/payout/finalize commands and Member cancel use the durable `IdempotencyService` with scope `admin:<adminId>:withdrawal:<id>:<operation>` and `withdrawal:<memberId>:<id>:cancel`. Same key + same payload replays the prior result; a changed payload is `IDEMPOTENCY_CONFLICT`.
4. **Ambiguous provider outcome.** An outbound payout failure (classified *or* unclassified) is never a definitive failure: the Withdrawal enters `RECONCILING` with the Reservation retained and `reconciliationAttempts` incremented. Recovery happens only through `getPayoutStatus` by the known provider reference key — the external payout is never re-initiated (`initiateCallCount` stays 1 across reconciliation, proven deterministically). A resolved definitive provider rejection is `FAILED` with authoritative Reservation release.
5. **Provider acceptance is not completion.** `COMPLETED` requires proven payout evidence *and* the authoritative Ledger finalization. The finalization posting and the Reservation consumption are atomic and idempotent on the Withdrawal identity, so a replay or crash recovery cannot produce a second effect.
6. **Payout Destination representation.** The raw account reference is never persisted or returned: the aggregate stores an opaque SHA-256 digest (duplicate and sharing detection) plus a masked display value. Verification is independent of Member/KYC status and crosses its seam as a normalized outcome plus an opaque evidence reference.
7. **Eligibility resolution.** `resolveWithdrawalEligibility` resolves deny-first over the rules this vertical can observe authoritatively (destination present/owned/verified/not-disabled, withdrawal capability restriction) and consumes the owning policy layer's already-evaluated review signal. It deliberately invents no threshold values: amount limit, daily aggregate, frequency, KYC tier, risk, and approval threshold remain with their owning policy.
8. **Pre-payout recheck.** Destination eligibility is re-evaluated before payout; an approved withdrawal that fails the recheck is `REJECTED` with authoritative release (`APPROVED → REJECTED`) rather than paid out.
9. **Admin authorization.** New capabilities `withdrawal.read`, `withdrawal.review`, and `withdrawal.payout`; `AUDITOR` is read-only. Every governed command writes an immutable Audit Record with the payload hash, reason, actor/session, correlation id, and the allowed *or* denied outcome.
10. **v1 default bindings.** No production payout rail or destination-verification provider is wired yet (Ticket 09 sequencing), and no Member capability-restriction store exists yet, so the deterministic payout provider, deterministic destination-verification fake, and an explicitly unrestricted restriction adapter are the default bindings. Each is a replaceable seam, not a policy decision.

## Schema and migration

`20260910133000_member_withdrawal` adds `payout_destinations`, `payment_withdrawals`, and `payment_withdrawal_events` with state/amount/currency/digest CHECK constraints, the scoped idempotency unique index, the `(memberId, accountDigest)` uniqueness that backs duplicate detection, and RESTRICT foreign keys to `members`/`payout_destinations`.

## Evidence

Local, on the branch worktree rebased onto `main` 979e1d2 (all commands run with the shared dev PostgreSQL configuration exported from `.env`; without those variables the API composition root aborts during application bootstrap, so `pnpm test` alone is not a valid invocation in this environment):

- `pnpm typecheck` — passed.
- `pnpm check` — passed (prisma generate, OpenAPI generate, typecheck, unit/contract suite, backend + member-web + admin-web builds).
- `pnpm test` — 332 passed, 151 skipped (integration suites gated behind `RUN_INTEGRATION_TESTS=1`).
- `pnpm prisma:migrate:status` — up to date; migration `20260910133000_member_withdrawal` is applied on the shared dev database.
- `RUN_INTEGRATION_TESTS=1 pnpm vitest run --no-file-parallelism` (rebased onto `main` 979e1d2) — 474 passed, 1 failed. The single failure is `tests/integration/admin-accounting-period-api.integration.spec.ts` on the shared dev database (closed-period trigger drift); it reproduces identically on a clean `979e1d2` checkout (`Tests 1 failed | 24 passed`), is accounting-owned, and is not touched by this change.
- `RUN_INTEGRATION_TESTS=1 pnpm vitest run tests/integration/member-withdrawal.integration.spec.ts` — 7 passed against PostgreSQL. Deterministic integration evidence covers:
  - happy path `create → reserve → payout → finalize` with exactly one `WITHDRAWAL_FINALIZE` transaction, a consumed (not released) `WITHDRAWAL` Reservation, and the Wallet projection moving 100.00 posted / 40.00 reserved → 60.00 posted / 60.00 available;
  - denial to an unverified destination with **no** Reservation created;
  - `INSUFFICIENT_FUNDS` refusal that never exceeds the authoritative available balance;
  - concurrent same-key create serialized into one Withdrawal and one Reservation, and `IDEMPOTENCY_CONFLICT` on a changed payload;
  - ambiguous payout retained at 50.00 available with `RECONCILING`, then exactly one recovery through reconciliation with no re-initiation;
  - Member cancellation and review rejection both restoring availability through the Ledger release path;
  - the durable workflow timeline (`REQUESTED → RESERVING → … → CANCELLED`).

This is a vertical implementation checkpoint. It is not Ticket 16 acceptance, not financial-core completion, and not Production GO; those remain with the Lead and the pending remaining financial-core items in `financial-core-status.md`.

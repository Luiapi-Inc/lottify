# Lottery Configuration / Draw milestone implementation status

Source of truth: Wayfinder Tickets 01, 02, 03, 05, 16, and 19. This record does not redefine those requirements.

## Implemented checkpoint

- Lottery now has explicit published `Lottery Product Version` and `Bet Type Version` domain artifacts. Product versions carry timezone, exact enabled Bet Type version references, Schedule Template, Result Schema/Settlement Rule, default payout/limit/restriction policy references, and effective-period identity without mutating older published versions.
- Bet Type identity/code is separated from immutable versioned configuration. Each version carries canonical number format/validation, default payout, per-Line min/max stake, limit/restriction policy references, and Settlement Rule version reference.
- Draw configuration creation snapshots the exact Product version and enabled Bet Type versions, including payout, stake limits, restriction/limit references, timezone, Schedule Template reference, Result Schema/Settlement Rule references, and Product default policy references needed to preserve historical configuration identity.
- A later Product/Bet Type version does not mutate an existing Draw snapshot. Disabling a Bet Type in a later Product version affects future Draw snapshots only, and Draw snapshot creation rejects a missing/mismatched enabled Bet Type version rather than silently substituting a newer version.
- Schedule Template now has an immutable structured-business-data seam carrying timezone, structured recurrence payload, expected local open/cutoff/draw times and rolling-generation horizon; raw RRULE strings are not accepted by this domain constructor. Exact recurrence-kind fields remain intentionally outside this checkpoint because Ticket 05 does not lock a canonical weekly/monthly/etc. wire shape.
- Date-specific occurrence exceptions support `SKIP`, `MOVE`, and `REPLACE` over explicit occurrence identities. The rolling Draw planner is idempotent by Product plus occurrence identity, preserves an already-created target Draw before applying any generator exception, never overwrites reruns/manual overrides/business activity, and retains distinct `MANUAL_EXCEPTION` provenance for exceptional replacements when no target Draw exists yet.
- Draw Override now has an immutable domain workflow for explicit versioned per-Draw changes. A proposal is bound to the exact Draw revision/state, accepts only the governed Draw time/cutoff/result-source and Bet-Type payout/stake/restriction/availability fields, produces a deterministic before/after diff and approval payload digest, records reason/actor/effective time, and publishes only when approval matches the exact payload/current Draw baseline with immutable approval/audit evidence references.
- Live-Draw override semantics preserve confirmed Bets, preserve accepted Quotes by default, permit immediate unconfirmed-Quote invalidation only for an explicit hard/emergency number-restriction change, reject terminal Draw mutation, and require the exceptional reopen workflow before extending cutoff on a `CLOSED` Draw. Complete published override history is replayed deterministically through the explicit `supersedesOverrideId` chain without mutating the original Draw snapshot; incomplete or branched history is rejected rather than assigned guessed precedence.
- This checkpoint introduces no persistence schema, migration, REST/OpenAPI surface, Admin execution workflow, concrete recurrence evaluator, or timezone-to-instant calculator.

## Evidence

- Focused Lottery configuration verification passed 21 tests across version/snapshot behavior plus existing payout, per-Line stake-limit and number-restriction rules.
- TypeScript typecheck passed after generating Prisma Client and using the generated OpenAPI client from the same API source HEAD; this work package does not change Prisma or the API contract.
- Bounded-context architecture verification passed 3 tests.
- The full local Vitest suite passed 156 tests; 65 integration tests were skipped because their integration environment flags/database were not enabled.
- Schedule Template / occurrence checkpoint focused verification passed 21 tests across structured-template validation, exceptions, rolling-generation idempotency, configuration snapshots and cutoff behavior. TypeScript typecheck and the 3 bounded-context architecture tests passed; the latest full local Vitest suite passed 165 tests with the same 65 integration tests skipped because their integration environment flags/database were not enabled.
- Draw Override focused verification passed 14 tests covering allowed-field diffing, defensive configuration snapshots, version lineage/replay, no-op/unknown-Bet-Type/stake-limit rejection, ordinary versus hard/emergency Quote impact, `CLOSED` cutoff-extension protection, terminal Draw protection, exact approval-payload binding, stale Draw-state/revision rejection, and branched/incomplete override-history rejection.
- Combined Lottery regression plus bounded-context architecture verification passed 53 tests. Prisma Client and OpenAPI client were regenerated from the same source HEAD for static verification, and TypeScript typecheck passed. The latest full local Vitest suite passed 179 tests; the same 65 integration tests remain skipped because their integration environment flags/database were not enabled.
- This evidence proves the scoped domain checkpoint only. It is not Lottery Configuration / Draw milestone acceptance or Production GO.

## Remaining milestone work

1. Canonical recurrence evaluator/timezone-to-instant calculation once the concrete recurrence shape is locked, using the structured Schedule Template seam rather than raw RRULE input.
2. Persistence/migration and authoritative API/Admin surfaces for Product/Bet Type/Draw configuration and Draw Override under the approved contracts, including policy-driven re-auth/approval execution and immutable audit persistence.
3. Required Integration/Contract/E2E and operational evidence under Ticket 16, including stateful configuration/override publish, Draw creation/generator behavior, authorization denial paths, concurrency/idempotency and Admin diff/approval/publish UX once persistence and external surfaces exist.

## Milestone disposition

This is a bounded Lottery domain checkpoint only. The Lottery Configuration / Draw milestone remains incomplete until the remaining source-of-truth requirements and required evidence are implemented and verified.

## Issue #24 blocker remediation — local checkpoint (2026-09-07)

Source: Tickets 05/10/16 and ADR 0004. Supersedes the domain-only description above for Product/Bet Type persistence and API work; full milestone acceptance remains open.

- Commands now commit configuration effects, audit and replayable idempotency results in one transaction. BigInt amounts are fingerprinted as JSON-safe strings with sorted object keys. Legacy incomplete records remain explicitly reconciliation-required.
- Lifecycle commands lock the version row before inspecting revision/state. Product link mutations lock their parents and reject published parents; a forward migration also corrects draft DELETE trigger return semantics.
- Lottery test cleanup scopes deletion to owned fixtures and changes trigger state transactionally. Pagination tests follow cursors and verify state-filtered versions.
- Local evidence: 8 PostgreSQL/HTTP integration scenarios passed, including simultaneous submit, published link mutation rejection, minor-unit version creation/replay and injected pre-result rollback/retry. Two contract and three architecture tests passed; typecheck passed.
- Remaining evidence: controlled publish/link interleavings, concurrent approval, real process termination/restart, full CI and independent post-change review. This is not Issue #24 acceptance or Production GO.

## Issue #24 controlled concurrency evidence — local checkpoint (2026-09-07)

Source: Ticket 05 publication immutability, Ticket 16 deterministic race evidence, and the remaining evidence from the preceding checkpoint. No runtime, API, or migration contract changed in this slice.

- Added five PostgreSQL integration scenarios in `tests/integration/lottery-configuration-persistence.integration.spec.ts`. Tests observe the actual database wait graph before releasing the blocking transaction, including indirect row-lock waiters; elapsed time never decides the ordering.
- Publication-first INSERT/UPDATE/DELETE races reject the waiting link mutation after the parent commits as PUBLISHED and preserve its committed link set. The inverse deletion-first race proves publication waits for the link transaction and retains its committed deletion.
- Two concurrent Product approvals at the same revision yield exactly one PUBLISHED revision and one VERSION_CONFLICT. Durable evidence contains exactly one Approval and one linked publication Audit Record, with distinct maker/checker identities and the expected re-auth reference.
- Focused persistence verification: 9 passed. Typecheck and diff whitespace checks passed. A fresh isolated PostgreSQL database created from all committed migrations passed 254 tests, including enabled general integration tests; 8 dedicated Accounting Period backfill/contract/reporting scenarios were skipped by their separate opt-in flags. Local machine-readable results and migration logs are retained under `.scratch/lottery-evidence/` with candidate metadata.
- The initial regression against the existing local database produced two Accounting Period failures. Inspection found its membership trigger missing the OPEN-state predicate present in the committed close migration and a pre-existing period at revision 2 where the test expected 1. Both scenarios pass on the fresh migrated database. The existing database was not repaired or treated as acceptance evidence.
- Remaining: real process termination/restart recovery, full CI for an immutable candidate, and independent post-change review. Issue #24 and the Lottery Configuration / Draw milestone remain open; this checkpoint is not acceptance or Production GO.

## Issue #24 process recovery and upgrade replay — candidate (2026-09-07)

Source: Tickets 02/10/16 and ADR 0004. Builds on the controlled concurrency checkpoint above.

- `lottery-command-recovery.integration.spec.ts` runs the real configuration command service in a child process, kills it with SIGKILL before commit or after commit while withholding the response, then retries and replays in fresh processes. It verifies one resource, one Audit Record, one completed idempotency result, no orphan from the killed transaction, and the original resource identity after a lost committed response.
- The pre-commit barrier identifies the actual PostgreSQL backend. The parent must observe an active writing transaction before killing it within the test deadline; the fixture's test-only transaction timeout exceeds that deadline. This distinguishes process-crash rollback from an earlier transaction timeout.
- Independent read-only review found an upgrade replay defect: canonical fingerprint sorting changed hashes for already-completed commands from the previous release. The controller now supplies the original insertion-order fingerprint as a compatibility comparison, while new commands persist the canonical fingerprint. HTTP integration verifies legacy completed replay, changed-payload conflict, and reconciliation-required handling for legacy incomplete records without another transition or Audit Record.
- The same review identified a possible timeout false positive in the initial crash fixture; the explicit backend/lifetime checks above address it. Initial review and focused follow-up reports, execution logs, machine-readable test results and exact candidate metadata are retained under `.scratch/lottery-evidence/` as local evidence.
- Local final candidate verification: 257 general-suite tests passed with integration enabled; the 8 separately gated backfill/contract/reporting tests also passed in their dedicated runs. Prisma/OpenAPI generation, typecheck and backend/Member/Admin production builds passed. The fresh-database logs and `final-vitest.json` include the recovery scenarios.
- Focused independent follow-up marked both review findings resolved and found no new actionable P1/P2 defect in those corrections; legacy approve/Product-version replay was not directly tested.
- No schema, migration, OpenAPI shape, or financial semantics change in this slice. Required full candidate CI remains a gate; local results and the independent review do not establish Issue #24 acceptance.
- Broader remaining evidence includes governed publication HTTP/E2E denial and recovery paths, command-level publish/link and parent-changing link interleavings, and publication/Approval/Audit/idempotency recovery together. These are separate from the identity-create process-crash scenarios proved here. Issue #24 and the overall milestone remain open.

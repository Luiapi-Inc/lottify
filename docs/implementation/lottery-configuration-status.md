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

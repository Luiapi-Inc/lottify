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

## Issue #24 governed Bet Type publication HTTP evidence — local checkpoint (2026-09-08)

Source: Ticket 05 configuration round 3 publication lifecycle; Ticket 16 API, security and critical-path scenario coverage; ADR 0004 durable command replay.

- The real Nest HTTP boundary now verifies that a DRAFT cannot be approved, an AUDITOR cannot publish, expired action-scoped MFA is rejected, an ADMIN maker cannot approve their own version, and a stale revision returns VERSION_CONFLICT. Each denial verifies unchanged configuration state and absence of publication Approval, Audit and idempotency effects.
- After fresh MFA, a different ADMIN publishes the REVIEW version. Retrying the same key previously denied for expired MFA succeeds, exact replay returns the original response, and changed-payload key reuse conflicts. PostgreSQL evidence verifies one PUBLISHED revision, one maker/checker Approval, one linked publication Audit and one completed command result.
- Test cleanup removes only owned fixtures and restores immutable-table triggers transactionally. Production application code and API/schema contracts are unchanged by this work package.
- Actual local result: 6 Admin Lottery HTTP integration tests passed; 9 persistence/concurrency, 2 process-crash recovery and 2 OpenAPI contract regression tests passed (19 total). Typecheck and diff whitespace checks passed. These executions use the configured local PostgreSQL database; they are not fresh-migration or full-candidate CI evidence.
- Initial execution was blocked before collection by temporary-filesystem quota exhaustion; using a workspace-local temporary directory allowed execution. The first fixture execution violated the MFA evidence window constraint by moving only expiry into the past; inspection confirmed expiresAt must exceed verifiedAt, and the fixture now moves the entire valid window into the past. No database constraint was weakened.
- Machine-readable reports are retained under `.scratch/lottery-evidence/http-publication-vitest.json` and `http-publication-regression.json`, with base commit and test-file SHA-256 in `http-publication-candidate.json`.
- Remaining: equivalent Product publication HTTP coverage, publication/Approval/Audit/idempotency process-crash recovery together, command-level publish/link and parent-changing link interleavings, applicable Admin UI/E2E evidence, independent review and full CI of the resulting immutable candidate. This checkpoint does not close Issue #24 or establish milestone acceptance.

## Issue #24 Product publication HTTP evidence — local checkpoint (2026-09-08)

Source: Ticket 05 immutable Product/Bet Type references and governed publication; Ticket 16 HTTP authorization, lifecycle and retry evidence; ADR 0004.

- The governed publication scenario now executes independently for BET_TYPE and PRODUCT through their real HTTP submit/approve endpoints. Both prove DRAFT rejection, AUDITOR denial, expired MFA denial, ADMIN self-approval rejection, stale revision conflict, successful maker-checker publication, exact replay and changed-payload conflict, with authoritative state and once-only Approval/Audit/idempotency assertions.
- Product-specific coverage rejects publication while its referenced Bet Type version is DRAFT, verifies no publication effects, publishes that exact Bet Type version through HTTP, then retries the original Product approval key successfully. The published Product retains exactly the original Bet Type/version link. Fixture creation uses the application service; this is publication HTTP integration evidence, not UI E2E or Product-create HTTP coverage.
- Scoped fixture cleanup now includes Product links/versions/identities, with immutability trigger restoration in the cleanup transaction. No runtime, schema or API contract change.
- Actual result: 7 HTTP integration tests and 11 persistence/contract regression tests passed (18 total in this execution), plus typecheck and diff whitespace checks. Reports: `.scratch/lottery-evidence/product-http-vitest.json`, `product-http-regression.json`; base commit, modified test hash and execution metadata: `product-http-candidate.json`. Tests used the configured local PostgreSQL database.
- Remaining acceptance gates include publication/Approval/Audit/idempotency process-crash recovery together, command-level publish/link and parent-changing link interleavings, applicable Admin UI/E2E evidence, independent review and full CI of the resulting immutable candidate. Issue #24 remains open.

## Issue #24 publication process-crash recovery — local checkpoint (2026-09-08)

Source: Tickets 02/05/16 and ADR 0004. Extends the identity-create process fixture to execute real approveAndPublish commands within executeCommand.

- Four scenarios exercise BET_TYPE and PRODUCT publication with SIGKILL before commit and after commit while withholding the response. Before-commit barriers occur after the publication service has written its state/Approval/Audit inside the transaction; the parent verifies an active writing PostgreSQL transaction within the test deadline before killing it. External reads still see REVIEW revision 2 and no publication Approval/Audit/idempotency result.
- A fresh process retries the same command and yields PUBLISHED revision 3 with one linked maker-checker Approval, one publication Audit and one completed result. After-commit crash recovery preserves the entire previously committed snapshot, including Approval/Audit/result identities. A third process replays without changing any of these records. Product recovery preserves its exact Bet Type/version link.
- Fixtures use distinct maker/checker principals and sessions, scoped cleanup and transactionally restored immutability triggers. MFA evidence is seeded for this application-service recovery test; HTTP authorization/MFA behavior is covered separately by the publication HTTP suite. No runtime, migration or API contract changes.
- Actual result: the final combined run passed 24 tests: 6 process-recovery, 7 HTTP, 9 persistence/concurrency and 2 OpenAPI contract tests. Typecheck and diff whitespace checks passed. Machine-readable final report: `.scratch/lottery-evidence/publication-recovery-final.json`; source hashes, base commit and timestamp: `publication-recovery-candidate.json`. Execution used the configured local PostgreSQL database, not a fresh migration or full candidate CI run.
- Remaining: command-level publish/link and parent-changing link interleavings, applicable Admin UI/E2E evidence, independent review and full CI for an immutable candidate. Issue #24 remains open; this local checkpoint does not establish milestone acceptance.

## Issue #24 command publication/link races — local checkpoint (2026-09-08)

Source: Ticket 05 published configuration immutability; Ticket 16 deterministic concurrency/idempotency evidence; ADR 0004. Extends the earlier direct-database race scenarios to real executeCommand/approveAndPublish transactions.

- Five publication-first scenarios hold the command transaction after publication and durable result writes, observe a blocked mutation through PostgreSQL's wait graph, then commit. Waiting INSERT, actual Bet Type reference UPDATE, DELETE, MOVE_IN and MOVE_OUT are rejected by the published-link guard. Both parent link sets remain identical to their pre-race snapshots; the unrelated parent remains DRAFT revision 1.
- Two move-first scenarios commit a parent-changing link update while a real publication command waits. Publishing either the source or destination parent observes the committed relocation: the source has no link and the destination retains the exact moved Bet Type/version reference.
- Every successful command verifies PUBLISHED revision 3, one maker-checker Approval, one linked Audit, one completed idempotency result and exact replay without duplicate approval/audit. Timers bound failures; observed PostgreSQL blocking establishes ordering. The SQL link writes exercise persistence integrity and are not a newly authorized Admin mutation API.
- Initial fixture validation failed because it assumed a compound Prisma unique selector absent from the current schema. The fixture now upserts its own explicit evidence ID. Typecheck also required an explicit Promise<unknown> return for the heterogeneous mutation callback. No runtime or schema change was needed.
- Final combined local execution passed 31 tests: 16 persistence/race, 6 process-recovery, 7 HTTP and 2 OpenAPI contract tests. Typecheck and diff whitespace checks passed. Report: `.scratch/lottery-evidence/command-link-races-final.json`; source hashes/base commit/time: `command-link-races-candidate.json`. This run used the configured local PostgreSQL database.
- Remaining: independent review of the accumulated candidate, full immutable-candidate CI/fresh-migration evidence and applicable Admin UI/E2E acceptance. These seven scenarios close the listed local command/link interleaving gap; they do not by themselves close Issue #24 or establish milestone acceptance.

## Issue #24 independent review and candidate preparation (2026-09-09)

Source: Tickets 05/16 and ADR 0004; Issue #24 authoritative snapshot retained locally. Independent Test/Evidence Guard reviewed the accumulated HTTP, crash-recovery and command/link-race diff against base `6a7108063140a8e53649a4669729670b1ca18d29`.

- Initial review identified two P2 evidence gaps: move-first publication needed a DRAFT reference to distinguish stale validation from post-lock validation, and AUDITOR denial needed fresh MFA plus the specific capability error to isolate RBAC. No additional actionable issue was found in the reviewed cleanup or crash/replay changes.
- Corrected scenarios now prove source publication succeeds after an invalid DRAFT reference moves away, destination publication waits then rejects that moved DRAFT reference without publication effects, and AUDITOR denial returns ACCESS_DENIED with required approval capability despite fresh action-scoped MFA. Independent follow-up marked both findings resolved and found no new actionable finding in those corrections.
- Fresh-database migration and full local execution before those two corrections passed 270 general tests plus 8 separately gated Accounting Period tests. After corrections, the 25 affected HTTP/persistence tests and typecheck passed. This accurately separates earlier full-suite evidence from final scoped evidence; full immutable-candidate CI remains required.
- Review packets, initial/follow-up reports, issue snapshot, fresh-database logs and machine-readable results are retained under `.scratch/lottery-review-20260909/`. Reviews were read-only/static; they did not independently execute tests. No runtime, API, schema or migration change is included in this evidence candidate. The pre-existing health-controller modification is excluded.
- This candidate is ready for full CI verification. Issue #24 and milestone acceptance remain open pending required final candidate evidence and applicable Admin journey acceptance; this is not Production GO.

## Issue #24 final immutable-candidate CI — green (2026-09-09)

Source: Tickets 05/10/16 and ADR 0004. Closes the outstanding "full immutable-candidate CI" gate for the scoped lottery #24 work.

- The branch now contains only scoped lottery #24 changes. The `feat(member)` commit accidentally carried on this branch was dropped (its identical content lives on `codex/member-surface@6373c14`; not on main, nothing lost).
- First CI attempt failed on the `verify` production-dependency scan: Trivy (fresh DB, 2026-09-09) reported three new HIGH CVEs in transitive `multer 2.2.0` (`CVE-2026-77037`, `CVE-2026-77078`, `CVE-2026-82333`, fixed in 2.3.0). Added `multer: 2.3.0` to `pnpm-workspace.yaml` `overrides`; lockfile regenerated. Local typecheck and the fresh-DB integration suite (272 passed / 8 separately gated skipped) stayed green.
- Final immutable-candidate CI run (commit `23d677b1ada56faab25790029cc850e28f814d89`, run `34348415404`) is fully green: `verify` (install, prisma generate, migrate deploy, openapi generate, typecheck, full test suite with `RUN_INTEGRATION_TESTS=1`, all three separately gated accounting-period suites, production dependency scan, build) and `container-smoke` (API/worker/member/admin image builds, four Trivy image scans, four container smokes). PR: `luiapi-sys/lottify#26`.
- Local evidence recorded under `.scratch/lottery-evidence/` in the primary tree. Base commit `4710048` (origin/main); changed paths are the lottery configuration persistence implementation, migrations `20260906180000`/`20260906190000`/`20260907020000`/`20260907021000`, Admin HTTP boundary, integration/contract tests, and this status record.
- Remaining for Issue #24 milestone: applicable Admin UI/E2E journey acceptance and independent post-change review. This green candidate CI does not, by itself, constitute milestone acceptance or Production GO.

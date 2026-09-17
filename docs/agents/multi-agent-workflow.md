# Lottify multi-agent workflow

This file defines local implementation orchestration on Hermes. It does not redefine product requirements, architecture decisions, API contracts, or acceptance criteria.

## 1. Control model

The user delegates a goal to one **Lead**. The Lead chooses whether the goal is single-agent or multi-agent work, establishes the source-of-truth checkpoint, decomposes only independently reviewable work packages, and owns integration and the final status claim.

There is **no global WIP=1**. WIP=1 is enforced per unstable shared critical boundary. Multiple Writers may work at the same time only when their prerequisites are stable and their write scopes do not overlap.

Always serialize these boundaries while unstable:

- Prisma/schema and migration ordering for the same data boundary.
- Shared financial invariants or posting/transaction semantics.
- Authoritative REST/OpenAPI, event, or provider contracts.
- Race-sensitive concurrency/idempotency/finalization logic.
- Any file or aggregate explicitly owned by another active Writer.

## 2. Roles

### Lead

- Reads the active checkpoint and relevant Wayfinder tickets/ADRs before delegation.
- Establishes `Plan -> Intended Result -> Current State -> Gap -> Implementation`.
- Records the integration base commit and preserves unrelated dirty state.
- Assigns disjoint write scopes and dependency/merge order.
- Reviews each returned diff and evidence before integration.
- Owns `Requirement -> Plan -> Implementation -> Test -> Actual Result` and acceptance wording.

### Writer

- Has exactly one bounded write scope and one recorded base commit.
- Uses an isolated branch/worktree unless the task is explicitly read-only.
- Does not edit another Writer's paths or shared boundary without returning the dependency to the Lead.
- Commits only scoped changes; generated verification artifacts and unrelated dirty state stay out of the commit.
- Returns commit SHA, changed paths, tests/evidence, unresolved gaps, and any merge-order dependency.

### Architecture Guard

- Read-only by default.
- Checks bounded-context ownership, cross-context imports, schema/API/event ownership, migration coupling, and source-of-truth alignment.
- Reports conflicts; it does not silently rewrite the Writer's implementation.

### Test / Evidence Guard

- Read-only by default unless given an explicitly disjoint test-only write scope.
- Maps the work package to Ticket 16 evidence obligations.
- Checks happy, rejection/denial, idempotency/retry, concurrency/race, failure/recovery, and compatibility scenarios as applicable.
- Distinguishes local checkpoint evidence from milestone acceptance and Production GO.

## 3. Delegation packet

Every delegated task must include all fields below. If a field is unknown, the Lead resolves it from source of truth before implementation rather than letting the Writer guess.

```text
Task: <short capability name>
Role: Writer | Architecture Guard | Test/Evidence Guard
Objective: <observable intended result>
Source: <Wayfinder ticket/ADR/implementation checkpoint IDs>
Base commit: <immutable SHA>
Prerequisites: <stable dependencies>
Owning context/surface: <bounded context or UI/infra surface>
Allowed write scope: <exact paths/globs>
Forbidden scope: <shared boundaries and unrelated paths>
Expected output: <code/docs/test/evidence artifact>
Required verification: <focused/typecheck/integration/contract/E2E/etc.>
Completion rule: <what constitutes a reviewable checkpoint>
Stop/escalate rule: <contract conflict, dependency change, cross-boundary write, deterministic failure>
Merge dependency: <before/after/independent of other task>
```

## 4. Parallelism decision

The Lead may start tasks in parallel only when all answers are **yes**:

1. Are source requirements and prerequisites stable enough for both tasks?
2. Are write paths disjoint?
3. Do the tasks avoid the same schema/migration/API/event/financial/transaction boundary?
4. Can either task be reviewed and reverted without the other?
5. Is merge order known, or are the tasks genuinely order-independent?

If any answer is no, serialize the work.

## 5. Branch and worktree isolation

- Writers branch from the Lead-recorded base commit.
- Preferred branch naming: `codex/<capability>`.
- Preferred worktree naming: `<repo-parent>/lottify-<capability>` (a sibling of the integration checkout, whatever that host calls it).
- A Writer must not absorb pre-existing dirty files from `main`.
- Read-only guards may inspect the integration checkout and do not need a worktree.
- Before handing off, a Writer runs `git status`, `git diff --check`, and lists the exact committed paths.

## 6. Integration / merge queue

The Lead integrates one candidate at a time:

1. Re-check current `main`, HEAD, dirty state, and source-of-truth checkpoint.
2. Review the candidate's exact diff and evidence.
3. Confirm it stayed inside its delegated scope.
4. If another candidate was integrated since its base, update/rebase the candidate onto the current integration head when needed.
5. Run impacted focused verification after the update.
6. Fast-forward/merge only after the candidate is clean and aligned.
7. Run post-integration focused/architecture checks on `main`.
8. Record the new checkpoint before integrating the next dependent candidate.

Do not push, deploy, migrate production, force-push, delete data, or switch traffic merely because a branch is integration-ready. Those actions remain separate high-impact decisions under the project guardrails.

## 7. Evidence and completion

For every integrated work package, the Lead records:

- source requirement/decision IDs;
- implementation commit SHA;
- exact changed paths;
- migration/API/event impact;
- focused and required broader test results;
- skipped evidence and why it is not yet runnable;
- actual functional result;
- remaining requirement/evidence gaps;
- whether the result is a local checkpoint, milestone acceptance, or Production GO.

A green build/test suite is never sufficient by itself to claim requirement completion.

## 8. Default operating pattern for current Lottify work

Use one Lead with multiple lanes when safe:

- **Writer A**: current authoritative schema/persistence boundary.
- **Writer B**: independent worker/queue implementation only after its persisted contract is stable, or against an already-settled interface.
- **Writer C**: independent Admin/Member presentation work only against a locked/generated contract.
- **Architecture Guard**: read-only source/ownership review.
- **Test/Evidence Guard**: read-only evidence matrix and acceptance review.

The labels A/B/C are temporary lanes, not permanent people. The Lead reassigns them per work package and never allows two active Writers to own the same critical boundary.

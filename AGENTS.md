# Lottify agent policy — Hermes local

This file configures AI coding work on this Hermes checkout. It does not redefine Lottify product requirements.

## Source of truth

Before modifying code, inspect the active implementation checkpoint and the relevant Wayfinder source documents. At minimum for cross-cutting work, read:

- `.scratch/lottify-v1-specification/issues/19-implementation-roadmap-and-delivery-sequencing.md`
- `.scratch/lottify-v1-specification/issues/02-end-to-end-business-workflows.md`
- `.scratch/lottify-v1-specification/issues/16-acceptance-criteria-and-test-traceability.md`
- the active domain ticket and applicable ADRs

Do not replace an existing plan, contract, invariant, or ownership decision with a new one merely to make implementation easier.

## Multi-agent rules

- Use the `lottify-multi-agent` skill when coordinating delegated/parallel work.
- Follow `docs/agents/multi-agent-workflow.md` for roles, delegation packets, worktree isolation, merge queue, and completion gates.
- There is no project-wide WIP=1. WIP=1 applies per unstable shared critical boundary; independent work may run in parallel when dependencies and write scopes are proven disjoint.
- One Writer owns each active shared financial/schema/transaction/migration/API/event boundary at a time.
- Parallel agents must have disjoint write scopes; architecture and evidence agents are read-only by default.
- Serialize shared financial schema/invariants, authoritative API/event contracts, race-sensitive transaction semantics, and migration ordering while unstable.
- The Lead owns source alignment, merge order, diff review, and the final acceptance claim.

## Verification

- Trace Requirement -> Plan -> Implementation -> Test -> Actual Result.
- Do not equate a green test suite with completed requirements.
- Use deterministic integration/CI evidence for financial correctness, concurrency, reservation, idempotency, and finalization as required by Ticket 16.
- Inspect the exact failure before retrying or patching after a deterministic failure.
- Do not claim acceptance while required CI/evidence is pending.

## Local tooling

- Serena project: `lottify` at `/home/ubuntu/lottify`.
- `.serena/`, this local policy, and local orchestration state are Hermes-local unless the user explicitly asks to version them.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical triage labels defined in `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context domain layout. See `docs/agents/domain.md`.

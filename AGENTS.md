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

- Use the `lottify` skill when coordinating delegated/parallel work.
- Follow `docs/agents/multi-agent-workflow.md` for roles, delegation packets, worktree isolation, merge queue, and completion gates.
- There is no project-wide WIP=1. WIP=1 applies per unstable shared critical boundary; independent work may run in parallel when dependencies and write scopes are proven disjoint.
- One Writer owns each active shared financial/schema/transaction/migration/API/event boundary at a time.
- Parallel agents must have disjoint write scopes; architecture and evidence agents are read-only by default.
- Serialize shared financial schema/invariants, authoritative API/event contracts, race-sensitive transaction semantics, and migration ordering while unstable.
- The Lead owns source alignment, merge order, diff review, and the final acceptance claim.

## Dual-tracker alignment (GitHub Issues ↔ kanban) — standing duty

The repo's durable acceptance record is GitHub Issues; project execution is the Hermes kanban board `lottify`. The two must never drift:

- The same turn a kanban card completes, its GitHub issue gets an evidence comment (Requirement → Plan → Implementation → Test → Actual Result with concrete artifacts) and is closed — unless the issue legitimately stays open.
- If a card closes only part of an issue, post a progress evidence comment on the issue and leave it open with the remaining scope named.
- If a card ends blocked on a human decision, relabel the issue `ready-for-human` and record the decision options in the issue comment.
- The Lead sweeps for drift: list done cards that reference still-open issues (`GH #N` in card titles) and reconcile every one — close with evidence, relabel, or leave open with a status comment. An issue with zero comments while its kanban card is `done` is a defect.

## Board ownership — single Lead session (operator decision 2026-09-18)

The Hermes kanban board `lottify` has exactly **one Lead session**: the operator's own
Telegram DM session running the `default` profile (the same session that answers Luiapi
directly). This is a deliberate anti-drift rule, because several Hermes sessions were
mutating the board concurrently and produced conflicting candidates, duplicate swarms and
stale deploy premises.

- Only that Lead session creates, links, reassigns, blocks/unblocks, or completes cards.
- Worker sessions (qa-agent, backend-agent, frontend-agent, security-agent,
  release-gate-agent, quality-gate-agent, memory-context-agent, …) may comment on their own
  card, attach artifacts, and return findings — they do **not** create or close cards for
  other tracks. If a card needs a follow-up, the worker records it as a finding and the Lead
  decides whether it becomes a card.
- Any other Hermes session that finds board work missing reports it to the operator instead
  of opening cards itself.
- There is no technical ACL on the board: this rule is enforced by discipline plus this
  documented policy. A session that does not follow it is drifting, not authorised.
- Board-visible evidence: the governance card on the board records the same rule.

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

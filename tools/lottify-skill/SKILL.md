---
name: lottify
description: Coordinate delegated Lottify work using the approved specification, bounded ownership, independent review, and requirement evidence.
---

# Lottify

Use this skill when a Lottify task needs delegated agents or parallel work.

## Agent topology

Use the following roles for Lottify delivery:

- `lead-agent`: owns decomposition, source alignment, integration, acceptance status, and final orchestration decisions.
- `backend-agent`: owns backend implementation within assigned boundaries.
- `frontend-agent`: owns frontend implementation within assigned boundaries.
- `qa-agent`: owns behavioral verification, E2E workflows, and regression validation.
- `domain-agent`: protects domain model, aggregate boundaries, business rules, and state transitions.
- `financial-integrity-agent`: reviews wallet, ledger, settlement, payout, refund, and transaction correctness.
- `api-contract-agent`: protects DTO, OpenAPI, client compatibility, and contract drift.
- `security-agent`: reviews authentication, authorization, webhook authenticity, secrets, and sensitive-data handling.
- `quality-gate-agent`: checks TypeScript quality, regression risk, test quality, and merge readiness.
- `release-gate-agent`: verifies acceptance criteria, release evidence, deployment readiness, and rollback evidence.
- `memory-context-agent`: maintains ADR, decisions, handoff records, and project context.

## Review coverage and scheduling

Review type safety, behavior coverage, maintainability, architecture, domain invariants and financial correctness as applicable. Schedule by Ticket 19: Integrity/Security/Compliance → Functional critical path → Recovery/Operations → Performance → Non-critical UX. Dependencies and exclusive ownership always constrain that ordering.

For multi-package delivery, use [orchestration.md](references/orchestration.md) and `scripts/orchestrator.py` to build the agent dependency graph and compute the next dispatch batch. Model/provider selection uses explicit profiles and actual runtime availability; a null model inherits the host default. The scheduler does not invoke providers or claim a task has started.

For changes affecting money movement, settlement, wallet, ledger, withdrawal, or payment:

- require financial-integrity-agent review;
- verify invariants and transaction behavior;
- keep ownership of unstable financial boundaries with one writer.

For changes affecting public APIs:

- require api-contract-agent review;
- verify OpenAPI, DTOs, and consumer compatibility.

Before delegating:
- Read the active Lottify source of truth and checkpoint.
- Define Requirement -> Plan -> Intended Result -> Current State -> Gap.
- Generate the initial execution manifest from the task description, add the active domain ticket and checkpoint, and validate source provenance with `scripts/source_alignment_check.py`.
- Record ownership, dependencies, and allowed write scope.
- For a graph, specify stable shared-boundary IDs, isolated Writer workspaces, immutable base SHAs, package dependencies, priority and available runtime profiles. Reject cycles and reconcile source/graph drift before dispatch.

Delegation rules:
- One Lead owns decomposition, integration, and acceptance status.
- Every Writer gets one bounded scope and known base state.
- Keep schema, migration, financial, transaction, API, event, and race-sensitive boundaries owned by one Writer while unstable.
- Architecture and evidence reviewers are read-only by default.

Accept work only after checking:
- re-run manifest generation with Git diff and reconcile newly detected impacts;
- changed paths match the assigned scope;
- evidence matches the requirement;
- tests represent the required behavior;
- remaining gaps are recorded.

Do not treat successful tests alone as acceptance. Use Requirement -> Plan -> Implementation -> Test -> Actual Result.

The Lead performs planning and owns the acceptance decision; add a separate planner only when a bounded, independently reviewable planning package exists. Release review covers deployment and recovery evidence; this skill does not authorize production deployment or automatic traffic switching.

Autonomous continuation follows `Current State -> Gap -> Executable Action -> Result -> State Change`. Continue only while a concrete action can create new evidence or state change. Do not repeat the same audit, checkpoint, agent/skill invocation, or release-gate check when inputs and state are unchanged. For autonomous loops, persist the current/previous Lead snapshots and run `scripts/lead_cycle_guard.py`; a non-continuation result is a hard stop until new evidence/input/state exists. Use the stop/wait states and retry limits in [runtime-and-evaluation.md](references/runtime-and-evaluation.md).

For agent invocation, handoff, retry, and failure handling, read [runtime-and-evaluation.md](references/runtime-and-evaluation.md). For evidence records and the checker, read [acceptance-evidence.md](references/acceptance-evidence.md). For durable memory capture, read [memory-policy.md](references/memory-policy.md).

Skill assignment registry is maintained in [skills/registry.md](skills/registry.md).

Skill loading workflow is defined in [skills/loader.md](skills/loader.md).

Delegation packet template is maintained in [references/delegation-packet-template.md](references/delegation-packet-template.md).

Memory architecture is defined in [references/memory-architecture.md](references/memory-architecture.md).

Lead Agent routing rules are defined in [references/lead-agent-routing-rules.md](references/lead-agent-routing-rules.md).

Release gate policy is defined in [references/release-gate-policy.md](references/release-gate-policy.md).

Agent execution manifest is defined in [references/agent-execution-manifest.md](references/agent-execution-manifest.md).

Manifest generator is defined in [references/manifest-generator.md](references/manifest-generator.md).

Manifest generator skill is defined in [skills/manifest-generator.md](skills/manifest-generator.md).

## Versioned contract and resolution

The repository-owned contract is version 2 of the Lottify agent execution manifest. Resolve requested capability names through `scripts/skill_resolver.py` and `skills/registry.yaml`; aliases such as `lottify-multi-agent` may resolve only to an installed canonical skill with a matching version. Conceptual external candidates remain advisory until they are resolved to an installed identifier.

Sensitive work is routed through `skills/capability-registry.yaml`, which records the owner, required reviewers, exclusive-boundary rule and evidence obligations for each capability. The Lead must use the registry as a routing constraint and record any applicable capability in the execution manifest.

Autonomous checkpoints use the versioned state contract in `scripts/execution_state.py`. A checkpoint must carry an objective identity, canonical state, evidence fingerprint and state fingerprint. The cycle guard accepts a continuation only when a new executable action, evidence or authoritative state change exists; explicit wait states and retry limit failures are terminal until new input or evidence arrives.

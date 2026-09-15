# Runtime and evaluation

Use the actual Codex task/thread or agent tools available in the host. There is no Lottify-specific spawn API. If no delegated runtime is available, the Lead can do single-agent work and records the independent-review gap; it must not impersonate reviewer approval.

For executable model/provider routing, agent dependencies and priority selection, use [orchestration.md](orchestration.md). It compiles source-aligned manifests and computes a dispatch proposal; the Lead invokes the permitted host tool and records actual state/results.

## Lifecycle

`planned → source-aligned → assigned → implementing → returned → reviewing → verified → integrated`

`blocked` is an explicit return state from any phase. A returned Writer result is not accepted until the Lead reviews its exact diff, source alignment and evidence. `verified` means a reviewable work package, not milestone acceptance or Production GO.

## Invocation contract

The Lead sends the fields in [delegation-packet-template.md](delegation-packet-template.md) through the host's available delegation interface. Include an immutable base SHA, task-specific source IDs, prerequisites, disjoint allowed paths, forbidden shared boundaries, verification, merge order and stop conditions. A Writer uses an isolated worktree/branch per [docs/agents/multi-agent-workflow.md](/home/ubuntu/lottify/docs/agents/multi-agent-workflow.md). Read-only reviewers receive the exact candidate SHA/diff and source/evidence references; they have no write scope unless separately assigned.

The Writer returns: candidate SHA, exact changed paths, source/contract/migration impacts, tests with actual results, unresolved gaps and dependencies. Reviewers return findings with severity, evidence references and an explicit pass/block judgment. The Lead records those responses in the execution manifest; silence or timeout is pending evidence.

## Failure handling

- On source, contract, owner or merge-base drift, pause the affected package and re-plan before another Writer edits the boundary.
- On deterministic test failure, inspect the failing output and relevant state before patching or retrying. An unexplained flaky pass is not acceptance.
- On timeout or unavailable agent, mark that review pending and proceed only with independent work. Do not mark the package verified.
- On candidate return, check paths against the assigned scope before integration. Re-run impact routing on the candidate diff and add any newly required reviewer.
- Integrate one candidate at a time using the repository merge queue. Preserve unrelated dirty state; never auto-push, deploy, migrate production, or switch traffic.

## Autonomous continuation guard

Every autonomous cycle is `Current State → Gap → Executable Action → Result → State Change`.

- Continue only when an executable action can create new evidence or change authoritative state.
- If no new evidence, executable action, or state change is available, stop the continuation and record the applicable state: `BLOCKED`, `WAITING_FOR_EVIDENCE`, `WAITING_FOR_ACCESS`, `REQUIREMENT_CONFLICT`, `WAITING_FOR_USER_DECISION`, or `EXTERNAL_DEPENDENCY`.
- Do not create another audit, checkpoint, status report, analysis pass, or agent invocation for the same objective when its input, evidence, and authoritative state are unchanged.
- Retry the same failed operation at most three times. Each retry must use changed evidence, inputs, or strategy; after three equivalent failures classify the work as `BLOCKED`.
- `HOLD` or `NOT PASSED` is a gate result, not an instruction to re-run the same gate. Resume only after evidence or state changes make a new action executable.
- `continue`, `auto-continue`, and equivalent requests resume from the latest checkpoint only when such a state-changing action exists.

Use `scripts/lead_cycle_guard.py CURRENT.json --previous PREVIOUS.json` before an autonomous retry/continuation. Each checkpoint records `objective_id`, `status`, `evidence_fingerprint`, `state_fingerprint`, and an optional action with `id`, `operation_id`, `input_fingerprint`, `strategy_fingerprint`, `retry_count`, and `executable`. `retry_count` is `0` for the initial operation and may advance through retries `1..3`; retry 4 is blocked. The guard fails closed on explicit wait states, unchanged cycles, invalid retry sequencing, unchanged retry strategy/input/evidence, and retry 4+.

Version 2 checkpoints may additionally use the canonical `state` contract from `scripts/execution_state.py`: `INIT`, `SOURCE_ALIGNMENT`, `PLAN_READY`, `DISPATCHING`, `WAITING_AGENT`, `EVIDENCE_COLLECTION`, `REVIEW`, `ACCEPTED`, `RELEASE_READY`, `DONE`, `WAITING_FOR_EVIDENCE`, `WAITING_FOR_ACCESS`, `BLOCKED_CONFLICT` and `FAILED_RETRY_LIMIT`. `REQUIREMENT_CONFLICT` is an explicit compatibility alias for `BLOCKED_CONFLICT`. Invalid transitions fail closed. The legacy status vocabulary remains readable for existing checkpoints but new checkpoints should use version 2.

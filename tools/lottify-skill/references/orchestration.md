# Model routing, dependency graph and priority scheduling

Use the generator/source checker for each work package, then `scripts/orchestrator.py build` to compile a graph and `schedule` to select the next batch. The scheduler is a deterministic decision layer for the Lead. It performs no network calls, spawns no agents, and mutates no execution state.

## Build input

Each package references a Lead-completed manifest. Paths to manifests are relative to this YAML file. Use actual immutable Git SHAs and distinct Writer worktrees. `repo` is the integration checkout. Package dependencies mean the prerequisite must be integrated before the dependent Writer starts.

```yaml
repo: /home/ubuntu/lottify
max_parallel: 3
runtime:
  providers:
    codex-host:
      available: false
      max_parallel: 3
  profiles:
    host-default:
      provider: codex-host
      model: null
      available: false
      capabilities: [repository, tools]
  routing:
    default: [host-default]
    roles: {}
    priorities: {}
packages:
  - id: financial-core
    manifest: financial-core-manifest.yaml
    base_sha: REPLACE_WITH_ACTUAL_FULL_GIT_SHA
    workspace: /home/ubuntu/lottify-financial-core
    priority: integrity-security-compliance
    depends_on: []
    boundaries: [wallet-ledger-transaction]
    requires: [repository, tools]
  - id: withdrawal
    manifest: withdrawal-manifest.yaml
    base_sha: REPLACE_WITH_ACTUAL_FULL_GIT_SHA
    workspace: /home/ubuntu/lottify-withdrawal
    priority: integrity-security-compliance
    depends_on: [financial-core]
    boundaries: [wallet-ledger-transaction]
```

The example deliberately marks runtime availability false. The Lead fills it from the current host's supported delegation interface and configured providers; availability is an observation, not an installation request. Profiles contain routing metadata, never API keys or credentials. Define additional profiles/providers only for adapters actually available in that runtime. Setting availability true does not install an adapter or verify provider connectivity.

```bash
python3 tools/lottify-skill/scripts/orchestrator.py build orchestration-input.yaml --output execution-plan.json
python3 tools/lottify-skill/scripts/orchestrator.py schedule execution-plan.json
```

## Model/provider selection

Routing precedence is node `profiles` → `routing.roles[agent]` → `routing.priorities[priority]` → `routing.default`. Each value is an ordered profile list. The first available profile satisfying `requires` and provider capacity wins. Record role or priority overrides in the runtime map before building. Node overrides are optional for manually authored graphs; changing a compiled graph requires deliberate rebuild/reconciliation.

Fallback is restricted to the selected list. A missing capability, unavailable provider or exhausted provider capacity may advance to its next profile; an unknown profile name is a configuration error. Exhausting the list leaves that node waiting, while independent nodes may proceed. A critical review cannot silently fall back to a profile missing its required capabilities. Functional capabilities are host-verified tool/access capabilities, not a claim of model benchmark quality.

`model: null` means omit the model override and preserve the host default. A non-null model ID must be user-configured and supported by that provider/adapter. The script neither invents current model names nor overrides host authorization rules. The dispatch result records profile, provider, model, selection rule and rejected fallback reasons.

## Agent graph

Each package expands to `Writer → all required independent reviewers → Lead acceptance → integration`. Cross-package edges target the prerequisite integration node. Duplicate IDs, unknown dependencies and cycles are errors. Independent review nodes can run together against the Writer's immutable candidate; acceptance waits for all of them.

Every node has `id`, `agent`, `kind`, `status`, `priority`, `depends_on`, `base_sha`, `scope`, `boundaries` and `requires`. Writing nodes also have an absolute `workspace`. Review/acceptance/integration nodes have `candidate_from` pointing to their Writer. Writer and integration results record `candidate_sha` and `result_ref`; review/acceptance results must match the Writer candidate. Integration may produce a new Git SHA.

Supported states are `pending`, `running`, `succeeded`, `failed`, `blocked`, `cancelled`. Only `succeeded` releases dependencies, and it requires a candidate SHA plus durable result reference. A failed/blocked/cancelled prerequisite keeps descendants waiting; it does not block independent branches. There is no automatic retry or preemption.

## Priority and ownership

Priority follows Ticket 19's five categories shown in SKILL.md. Prerequisites inherit the highest urgency of unfinished dependents so a low-priority prerequisite cannot strand a critical path. Ties prefer the longer downstream path, then stable node ID. Recompute after state changes. This is finite-plan scheduling, not a promise of starvation-free service under an unbounded incoming workload.

Parallel Writers require disjoint scopes, different workspaces and no common exclusive boundary ID. Scopes support exact repository-relative paths or `directory/**`; ambiguous wildcard patterns are rejected so the scheduler cannot falsely infer disjoint ownership. Use the same canonical boundary ID for the same unstable schema/financial/API/event/transaction boundary even when files differ. Read-only reviewers claim no write locks and must inspect immutable snapshots. Integrations always serialize through one queue. Running nodes retain capacity and ownership even if their provider becomes unavailable; a timeout alone does not prove a Writer has stopped.

`max_parallel` limits the whole batch, including running work. Each provider also has its own limit. Priority never bypasses dependencies, scope conflicts or capacity. A running conflict is an error requiring Lead reconciliation, not an invitation to start another Writer.

## Dispatch and results

One Lead owns the state file and dispatch loop. `schedule` returns proposed `dispatch`, `waiting` reasons, `running` and `halted` nodes, and topological order. Repeating it without recording dispatch returns the same batch: it is not a durable job broker or distributed lock service. Do not dispatch the same proposal twice.

Before invoking the host tool, re-check worktree/base state, source alignment, current runtime availability and existing task authorization. Record the selected node as running with `assigned_route` equal to its proposed `route` and the proposed `candidate_sha`. Capture the actual host task ID in the Lead's execution record. On confirmed completion, record its actual candidate and durable result reference; on uncertain dispatch/timeout, reconcile the host task before retrying or releasing ownership. Do not mark acceptance succeeded until the existing evidence checker and independent reviews pass. Integration still follows the repository merge policy and user authorization.

The builder binds the source/ownership/evidence requirements and graph structure by hash. Scheduling rechecks source files and those contracts. Evidence/result records can grow without changing the contract. Changes to scope, dependencies, source decisions or base state require deliberate plan reconciliation and re-evaluation of affected evidence; rebuilding creates pending nodes and must not be used to duplicate still-running work. After a prerequisite integrates, verify the dependent worktree includes it and reconcile its base before dispatch.

Exit 0 means a valid planning result, even if every node is waiting. `all_succeeded` describes graph steps only; it is not milestone acceptance or Production GO. CLI configuration errors return nonzero. Provider connectivity, live task dispatch and distributed state persistence require the host runtime and are not proven by scheduler unit tests.

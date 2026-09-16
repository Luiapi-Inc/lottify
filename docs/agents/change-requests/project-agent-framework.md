# Change Request — reusable project-agent core

## User intent

Evolve the existing Lottify agent skill so that:

1. asking “what should we do next?”, “what is blocking us?”, or “continue” produces a direct source-aligned next action when the current state already determines one;
2. installed Matt Pocock / engineering runtime skills are selected automatically by role and action type without overriding Lottify requirements or acceptance gates;
3. the reusable decision/routing mechanism can later be used by projects other than Lottify.

## Difference from the existing Lottify contract

The approved Lottify product requirements, Ticket 19 ordering, Ticket 16 evidence chain, existing agent roles, review subskills, manifest v2 contract, release gates, and acceptance semantics remain unchanged.

This change extracts reusable decision/runtime-skill behavior into `tools/project-agent/` and makes Lottify the first project profile. Lottify-specific domain routing remains in `tools/lottify-skill/`.

## Acceptance criteria

- Existing Lottify skill unit/contract tests continue to pass.
- A generic project profile can define source locations, priority order, Lead role, and runtime skill configuration without Lottify domain logic in the generic core.
- The next-action resolver chooses the highest-priority executable action, continues an already-running higher-priority action, and returns a wait condition instead of inventing work when nothing is executable.
- Runtime skill routing combines role defaults with action packs and prevents specification/ticket-generating skills unless an explicit Change Request is active.
- The Lottify manifest records and validates the runtime skills selected for its routed agents/task while preserving the existing `lottify` skill alias and manifest v2 contract.

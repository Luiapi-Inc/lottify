---
name: luiapi-agent
description: Reusable evidence-gated project delivery core for source-aligned next-action decisions, capability routing, runtime skill selection, orchestration, and acceptance handoff.
---

# Luiapi Agent

Use this core through a project profile. The core must not invent product requirements, replace approved plans, or make project-specific domain decisions.

## Core decision chain

For planning/execution questions use:

`Plan -> Intended Result -> Current State -> Gap -> Next Executable Action`

For completion claims use:

`Requirement -> Plan -> Implementation -> Test -> Actual Result`

## Next-action behavior

When the user asks what to do next, what is blocking progress, which agent should act, or says continue, derive the answer from the active project profile, approved source of truth, latest checkpoint/execution state, unresolved gaps, dependencies, and acceptance evidence. If one executable action is determined by those inputs, return it directly rather than asking the user to choose again.

Return at least: current state, gap, recommended action, owner, project review capabilities/subskills, runtime skills, expected result, required evidence, and blocker/wait condition when applicable.

Do not invent work when no executable action exists. Return the actual wait/block state and the concrete resume condition.

## Runtime installation

Install the canonical core/profile into local agent runtimes with `scripts/install_runtime.py`. Supported targets are `hermes`, `codex`, and `all`. Run `--dry-run` first when an existing runtime already has a project skill; use `--migrate-existing` only when replacing that existing copy is intended. Migrated copies are backed up outside the runtime skill root.

The installer also bridges shared engineering/Matt skills from `~/.agents/skills` only when the target runtime does not already provide that identifier. It writes `$HOME/.local/share/luiapi-agent/<runtime>-inventory.json`; use that inventory when routing next actions so unavailable host skills are reported instead of selected.

`ask-matt` may remain installed for explicit use, but next-action decisions must not auto-route through it; the project Lead derives the recommendation from project source/state directly.

## Runtime skills

Project review subskills define **what must be proved**. Runtime skills define **how an agent performs the work**. Runtime skills never override the project profile, requirements, ownership, or acceptance gates.

Use `scripts/runtime_skill_router.py` with a project-selected skill-pack configuration. Skills that can create or redefine specification/requirements are guarded and require an explicit Change Request.

## Portability

Project-specific domain rules, source paths, priorities, roles and review subskills belong in the project profile/adapter. The generic core should contain no Lottify-specific domain logic.

# Lottify Skill Loader Flow

## Purpose

Select capability skills by agent role before starting implementation or review.

## Resolution order

1. Load Lottify role definition.
2. Resolve registry entries with `scripts/skill_resolver.py` and `skills/registry.yaml` to exact installed skill identifiers; skip conditional entries whose trigger is not in scope.
3. Check external skill candidates such as mattpocock/skills.
4. Avoid duplicate capability packs.
5. Record selected skills in the delegation packet.

Do not invoke a conceptual label such as `typescript`, `testing`, `architecture`, `documentation`, `performance`, or `security` as if it were an installed skill. External candidates remain advisory until their source has been reviewed and an installed identifier exists in the current runtime.

The canonical project alias `lottify-multi-agent` resolves to the installed `lottify` skill through the versioned registry. Unknown aliases, advisory-only entries, duplicate aliases and version mismatches are errors.

## Agent selection rules

### Implementation

Use:
- backend-agent for NestJS, Prisma, PostgreSQL, Redis, backend TypeScript changes.
- frontend-agent for Next.js, React, UI, client state, and browser behavior changes.

### Review

Use:
- domain-agent for business rules and state transitions.
- financial-integrity-agent for money movement boundaries.
- api-contract-agent for API surface changes.
- quality-gate-agent before merge.
- release-gate-agent before deployment.
- security-agent for auth, permission, webhook, secrets or candidate scan impact.

## External skill policy

mattpocock/skills candidates are mapped as capability references:

Tier 1:
- typescript
- testing
- code-review
- architecture

Tier 2:
- debugging
- performance
- documentation

Tier 3:
- security
- advanced React patterns

Before adding an external skill:

- verify source;
- compare with installed skills;
- keep one canonical capability owner;
- document why it improves Lottify workflow.

## Automatic runtime-skill routing

Use the reusable router in `../../project-agent/scripts/runtime_skill_router.py` with `../../project-agent/skills/runtime-skill-packs.yaml`. The Lottify manifest generator records the resolved runtime skills together with the canonical `lottify` and `project-agent` skills.

Role defaults and action packs may select installed engineering skills such as `tdd`, `diagnosing-bugs`, `code-review`, `domain-modeling`, `codebase-design`, `implement-spec`, `improve-codebase-architecture`, `vercel-react-best-practices`, `playwright`, or `ask-matt`. These skills do not become project source of truth.

`to-spec` and `to-tickets` are guarded: they are not selected unless the task is an explicit Change Request. This prevents runtime tooling from silently redefining an existing plan or requirement.

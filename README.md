# Lottify v1

Lottify is a private TypeScript monorepo for the Lottify v1 platform. The repository contains the API, background workers, Member web, Admin web, shared contracts, Prisma migrations, infrastructure, tests, implementation checkpoints, and the approved specification used to drive implementation.

> This README is an operating guide. Product requirements, architecture decisions, API contracts, and acceptance criteria remain governed by the project source-of-truth documents.

## Repository layout

```text
apps/
  api/          NestJS API entrypoint and OpenAPI generation
  workers/      Background workers
  member-web/   Member Next.js application
  admin-web/    Admin Next.js application
packages/
  contracts/    Generated/shared API contracts
prisma/         Prisma schema and migrations
src/
  contexts/     Bounded-context implementation
  platform/     Shared platform infrastructure
tests/
  architecture/
  contract/
  integration/
  unit/
docs/
  adr/          Architecture Decision Records
  implementation/ Implementation checkpoints and evidence
  agents/       Agent workflow and repository conventions
.scratch/lottify-v1-specification/
                Approved Wayfinder specification
infra/          Docker/deployment infrastructure
```

## Source of truth

Before changing implementation, inspect the active checkpoint and the relevant approved specification. Cross-cutting work starts with:

- `.scratch/lottify-v1-specification/issues/19-implementation-roadmap-and-delivery-sequencing.md`
- `.scratch/lottify-v1-specification/issues/02-end-to-end-business-workflows.md`
- `.scratch/lottify-v1-specification/issues/16-acceptance-criteria-and-test-traceability.md`
- the active domain ticket and applicable ADRs
- the matching document under `docs/implementation/`

The required implementation trace is:

```text
Plan -> Intended Result -> Current State -> Gap -> Implementation
Requirement -> Plan -> Implementation -> Test -> Actual Result
```

A green build or test suite alone does not establish requirement acceptance.

## Prerequisites

- Node.js `>=24 <25`
- pnpm `11.25.0`
- PostgreSQL reachable through `DATABASE_URL`
- Redis reachable through `REDIS_URL`

Create local environment configuration from the example file:

```bash
cp .env.example .env
```

At minimum, configure the database, Redis, JWT, and service settings required by the component being run. Do not commit secrets.

## Install

```bash
pnpm install
pnpm prisma:generate
```

Check database migration state when working against an existing database:

```bash
pnpm prisma:migrate:status
```

Apply migrations only to the intended environment:

```bash
pnpm prisma:migrate:deploy
```

## Development

Run each surface independently:

```bash
pnpm dev:api
pnpm dev:worker
pnpm dev:member
pnpm dev:admin
```

## Contracts

Generate the authoritative OpenAPI document and TypeScript client:

```bash
pnpm openapi:generate
```

Individual commands are also available:

```bash
pnpm openapi:spec
pnpm openapi:client
```

Generated contracts must stay aligned with the approved API contract and the implementation that serves it.

## Verification

Common checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Full repository check:

```bash
pnpm check
```

`pnpm check` runs Prisma generation, OpenAPI generation, type checking, tests, and all builds. Financial correctness, concurrency, reservation, idempotency, settlement/finalization, migration compatibility, and other release-critical behavior still require the deterministic evidence defined by Ticket 16.

## Multi-agent development

Lottify uses a Lead-controlled multi-agent workflow. Read:

- `AGENTS.md`
- `docs/agents/multi-agent-workflow.md`

The core operating rules are:

- The **Lead** owns source alignment, decomposition, dependency order, diff review, integration, and the final acceptance claim.
- **WIP=1 applies per unstable shared critical boundary**, not globally across the project.
- Multiple **Writers** may run in parallel only when prerequisites are stable and write scopes are proven disjoint.
- Shared Prisma/schema/migration boundaries, financial invariants, authoritative API/event contracts, and race-sensitive transaction/idempotency semantics remain single-writer while unstable.
- **Architecture Guard** and **Test/Evidence Guard** are read-only by default.
- Every Writer uses an isolated branch/worktree and returns the exact commit, changed paths, verification, evidence, and unresolved dependencies.
- The Lead integrates one candidate at a time in dependency order and verifies the exact diff before acceptance.

A delegated work package must identify its source requirement, immutable base commit, prerequisites, owner, allowed write scope, forbidden/shared boundaries, expected result, required evidence, completion rule, and escalation rule.


### Serena + Codex

The Hermes checkout is configured with the Serena project `lottify` and the `lottify` orchestration skill. Codex connects to Serena over stdio MCP for project-aware semantic navigation and editing; Codex multi-agent runtime is responsible for spawning and coordinating routed sub-agents.

Useful diagnostics:

```bash
serena project health-check /home/ubuntu/lottify
serena mode list
codex mcp get serena
codex mcp list
```

Serena provides code intelligence and project context. It is not the sub-agent scheduler and does not replace the approved source-of-truth documents.

## Git and integration discipline

Before starting work, record the current branch, immutable HEAD, and working-tree state:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
```

Do not absorb unrelated dirty files into a work package. Writer branches should be isolated from the integration checkout, and merge order must follow the dependencies established by the Lead.

Push, production deployment, production migrations, force-push, data deletion, and traffic switching are separate high-impact actions. Integration readiness does not imply authorization for those operations.

## Key references

- `AGENTS.md` — Hermes/Codex agent policy
- `docs/agents/multi-agent-workflow.md` — delegation, isolation, merge queue, evidence gates
- `docs/adr/` — architecture decisions
- `docs/implementation/` — current implementation checkpoints
- `.scratch/lottify-v1-specification/` — approved Lottify v1 specification

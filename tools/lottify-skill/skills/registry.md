# Lottify Agent Skill Registry

The machine-readable registry is `registry.yaml`; this document explains the routing policy and remains the human-readable reference. The resolver validates canonical identifiers, aliases, semantic versions, availability status and duplicate mappings before a delegation packet is accepted.

Mapping of agent roles to recommended capability packs.

The names below are exact installed Codex skill identifiers or Lottify-internal skills. Conceptual capability labels are kept only in the external-candidate section and must not be treated as loadable skills until resolved to an installed identifier.

## lead-agent

- manifest-generator
- codebase-design
- code-review
- domain-modeling
- writing-for-agents

Purpose:
- preserve architecture boundaries;
- validate implementation decisions against Lottify design.

## backend-agent

- diagnosing-bugs
- code-review
- build-web-apps:supabase-postgres-best-practices when PostgreSQL query/schema performance is in scope
- redis-development:redis-core when Redis data modeling is in scope
- redis-development:redis-connections when Redis connectivity is in scope

Purpose:
- maintain backend correctness, type safety, and behavior coverage.

## frontend-agent

- vercel-react-best-practices
- build-web-apps:frontend-testing-debugging when rendered UI verification/debugging is needed

Purpose:
- maintain Next.js and React quality.

## qa-agent

- playwright
- diagnosing-bugs
- code-review

Purpose:
- produce deterministic critical workflow and recovery evidence.

## security-agent

- security-best-practices
- security-threat-model for high-risk boundaries
- code-review

Purpose:
- review auth, policy denial, webhooks, secrets and candidate scan results.

## domain-agent

- domain-modeling
- codebase-design
- writing-for-agents
- code-review

Purpose:
- protect aggregates, invariants, state transitions, and domain events.

## financial-integrity-agent

- codebase-design
- diagnosing-bugs
- security-best-practices
- build-web-apps:supabase-postgres-best-practices

Purpose:
- review ledger, wallet, settlement, payout, refund, and transaction changes.

## api-contract-agent

- writing-for-agents
- code-review

Purpose:
- prevent DTO, OpenAPI, and client contract drift.

## quality-gate-agent

- code-review
- diagnosing-bugs

Purpose:
- check regression risk and merge readiness.

## release-gate-agent

- code-review
- writing-for-agents
- security-best-practices

Purpose:
- verify acceptance evidence and release readiness.

## memory-context-agent

- writing-for-agents
- create-handoff
- session-compression
- honcho-memory
- supermemory-status

Purpose:
- preserve decisions, ADRs, handoffs, and project context.

## External skill candidates

Recommended additions from mattpocock/skills:

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

Install only when the skill source is reviewed and does not duplicate existing capabilities.
These are discovery candidates, not loadable identifiers. Resolve the chosen candidate to an actually installed skill name before delegation and record that resolved name in the packet.

## Capability ownership

Sensitive domain routing is defined in `capability-registry.yaml`. Each capability must identify one owner, required reviewers, whether its boundary is exclusive, and the evidence required to review it. Financial, schema/migration, API and event capabilities remain single-writer while their boundary is unstable.

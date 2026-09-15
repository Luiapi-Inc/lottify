# Manifest Generator

## Purpose

Generate a routing draft from task text and scoped changed paths. The Lead confirms sources, one Writer and write scope before delegation.

## Inputs

- Task description
- Changed files
- Active checkpoint and domain ticket paths
- Applicable ADR paths
- Lead-assigned allowed write scope

## Pipeline

```
Task Description
      |
      v
Git Diff Analyzer
      |
      v
Domain Impact Classifier
      |
      v
Agent Router
      |
      v
Skill/Subskill Selector
      |
      v
Evidence Generator
      |
      v
Execution Manifest
```

## File Pattern Routing

| Signal | Agent | Subskill |
|---|---|---|
| prisma/schema | backend-agent, quality-gate-agent | prisma-schema-review |
| migration | backend-agent, quality-gate-agent, release-gate-agent | prisma-schema-review, database-migration-review |
| wallet, ledger, payment, settlement, withdrawal | financial-integrity-agent | payment-ledger-review |
| transaction, lock, isolation | financial-integrity-agent | postgres-transaction-review |
| entity, aggregate, domain, state | domain-agent | ddd-domain-review |
| command, query, event | domain-agent | cqrs-event-review |
| controller, dto, openapi | api-contract-agent | api-contract-review |
| components, pages, forms | frontend-agent | frontend-accessibility-review |
| e2e, playwright, browser flow | qa-agent | e2e-playwright-review |
| auth, RBAC, webhook, secret | security-agent | security-auth-review |
| observability | release-gate-agent | observability-review |
| performance, capacity | qa-agent, release-gate-agent | performance-load-review |
| dependency, vulnerability | security-agent | dependency-security-review |
| recovery, restore | release-gate-agent | chaos-recovery-review |
| docker, deploy, infra | release-gate-agent | production-readiness-review, infra-deployment-review |

## Generated Evidence Rules

Financial changes require:

- invariant verification;
- transaction evidence;
- regression tests.

API changes require:

- OpenAPI diff;
- compatibility verification.

Production changes require:

- Ticket 13 as an explicit release-gate source;
- critical functional E2E plus approved UX functional/visual evidence;
- performance and security release evidence;
- migration compatibility plus backup/PITR restore evidence;
- observability evidence;
- immutable candidate and deployment plan;
- rollback or governed roll-forward evidence.

## Output

The generator produces a manifest containing:

- selected agents;
- selected skills;
- selected subskills;
- proposed Writer candidates and Lead-supplied ownership scope;
- verification evidence;
- acceptance gates.

The generator records SHA-256 of each source file. It cannot infer which checkpoint, ADR or write scope is authoritative. `scripts/source_alignment_check.py` checks presence, drift, scope and evidence records after the Lead completes the draft. A matching filename or keyword is only a routing signal, not source approval.

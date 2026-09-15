# Lead Agent Routing Rules

## Purpose

Automatically select Lottify review agents and subskills from task scope and changed areas.

## Routing by change area

| Change | Required Agent | Subskill |
|---|---|---|
| Domain entity, aggregate, business rule | domain-agent | ddd-domain-review |
| CQRS command, query, event handler, event schema | domain-agent | cqrs-event-review |
| Prisma schema, migration, relation | backend-agent + quality-gate-agent | prisma-schema-review |
| Transaction, locking, isolation, concurrency | financial-integrity-agent | postgres-transaction-review |
| Wallet, ledger, payment, settlement, refund, withdrawal | financial-integrity-agent | payment-ledger-review |
| Auth, RBAC, ABAC, token, permission | security-agent | security-auth-review |
| Expand/backfill/contract migration | backend-agent + release-gate-agent | database-migration-review |
| Dependency or image vulnerabilities | security-agent | dependency-security-review |
| Telemetry, correlation, alerting | release-gate-agent | observability-review |
| Capacity, latency, load | qa-agent + release-gate-agent | performance-load-review |
| Restore, replay, recovery | release-gate-agent | chaos-recovery-review |
| Deployment topology, rollout | release-gate-agent | infra-deployment-review |
| Controller, DTO, OpenAPI, generated client | api-contract-agent | api-contract-review |
| React component, form, accessibility | frontend-agent | frontend-accessibility-review |
| Browser flow, customer journey, critical workflow | qa-agent | e2e-playwright-review |
| Environment, deployment, observability, release | release-gate-agent | production-readiness-review |

## Default routing sequence

```
Lead Agent
  |
  v
Source of Truth Check
  |
  v
Impact Classification
  |
  v
Select Agent
  |
  v
Load Subskill
  |
  v
Create Delegation Packet
  |
  v
Review Evidence
```

## Multiple matches

When multiple areas are affected:

1. Financial correctness takes priority for money movement; this does not remove other applicable reviews.
2. Domain review is required for business invariant changes.
3. API contract review is required for public API changes.
4. Release review is required before production deployment.

## Evidence requirement

The Lead Agent records:

- selected agents;
- selected subskills;
- source documents checked;
- verification evidence;
- unresolved gaps.

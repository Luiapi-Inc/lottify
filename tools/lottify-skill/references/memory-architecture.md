# Lottify Agent Memory Architecture

## Context lifecycle

These integrations are optional. Repository sources, checkpoints and durable evidence remain authoritative; see [memory-policy.md](memory-policy.md) for capture, conflict and privacy rules.

```
Honcho
  |
  | lifecycle management
  v
Supermemory
  |
  | semantic retrieval
  v
Agent Context
```

## Responsibilities

### Honcho

Own lifecycle operations:

- session lifecycle;
- agent state transitions;
- context checkpoints;
- handoff timing;
- workflow continuity.

### Supermemory

Own semantic retrieval:

- decision retrieval;
- ADR lookup;
- incident history;
- previous implementation rationale;
- relevant project knowledge.

### Agent Context

The working context provided to an agent:

- current task;
- source of truth;
- retrieved memories;
- constraints;
- verification requirements.

## Lottify review subskills

```
subskills/
├── ddd-domain-review
├── cqrs-event-review
├── prisma-schema-review
├── postgres-transaction-review
├── payment-ledger-review
├── security-auth-review
├── api-contract-review
├── frontend-accessibility-review
├── e2e-playwright-review
└── production-readiness-review
```

Each subskill should provide:

- purpose;
- trigger conditions;
- required source documents;
- review checklist;
- evidence output.

## Context flow

```
Task
 |
 v
Honcho lifecycle checkpoint
 |
 v
Supermemory retrieval
 |
 v
Agent Context assembly
 |
 v
Agent execution
 |
 v
Evidence + decision capture
 |
 v
Supermemory update
```


Subskill metadata standard is defined in [references/subskill-metadata-standard.md](subskill-metadata-standard.md).

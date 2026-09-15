# Agent Execution Manifest

## Purpose

Define the generated routing draft and the Lead-completed execution contract. The generator never assigns write authority or declares acceptance.

## Manifest Structure

```yaml
contract:
  name: lottify-agent-execution-manifest
  version: 2

task:
  objective: <objective>
  source_of_truth:
    - kind: roadmap
      path: <repo-relative path>
      sha256: <source content hash>

dependencies: []

capabilities: []

records:
  decisions: []
  handoffs: []
  checkpoints: []
  evidence_refs: []

source_alignment:
  confirmed_by_lead: false
  decision_ids: []
  adr_disposition: null

risk_assessment:
  suggested_level: <standard|high|critical>
  shared_boundaries: []
  parallelism: <Lead decision>

routing:
  lead_agent: lead-agent
  agents: []
  subskills: []
  matched_signals: []

skills:
  required: [lottify]

ownership:
  writer_candidates: []
  writer: null
  allowed_scope: []
  forbidden_scope: []

evidence:
  required: []
  records:
    - candidate_sha: <same immutable Git SHA as acceptance.candidate_sha>

reviews:
  required: []
  records: []

acceptance:
  status: pending
  candidate_sha: null
  level: local-checkpoint
  gaps: [<missing checkpoint, ticket, or scope>]

execution:
  checkpoint_version: 2
  state: SOURCE_ALIGNMENT
  objective_id: <stable objective identity>
```

## Routing Examples

### Wallet / Ledger Change

```yaml
agents:
  - financial-integrity-agent
  - quality-gate-agent
subskills:
  - payment-ledger-review
  - postgres-transaction-review
evidence:
  - ledger invariant verification
  - transaction test evidence
```

### API Change

```yaml
agents:
  - api-contract-agent
  - quality-gate-agent
subskills:
  - api-contract-review
evidence:
  - OpenAPI diff
  - compatibility result
```

### Production Deployment

```yaml
agents:
  - qa-agent
  - security-agent
  - quality-gate-agent
  - release-gate-agent
subskills:
  - production-readiness-review
  - infra-deployment-review
  - observability-review
  - performance-load-review
  - dependency-security-review
  - security-auth-review
  - chaos-recovery-review
  - e2e-playwright-review
  - database-migration-review
evidence:
  - critical functional E2E result
  - critical Member/Admin health and smoke result
  - approved UX functional/visual result
  - production-like performance result
  - security release gate result
  - migration compatibility result
  - backup/PITR restore result
  - observability release result
  - deployment plan
  - rollback or governed roll-forward plan
```

## Lead Agent Output Requirements

Every Lead-completed execution manifest must record:

- selected agents;
- selected skills;
- selected subskills;
- ownership boundaries;
- verification evidence;
- unresolved gaps.

The contract version, resolved skill identifiers and execution state are validated before graph compilation. Acceptance evidence and required review records must use the exact immutable candidate SHA recorded in `acceptance.candidate_sha`.

The Lead adds the active domain ticket, checkpoint and applicable ADRs with `--source`/`--checkpoint`, confirms the exact source decisions, selects one Writer, and narrows the scope. Validate delegation and later acceptance with [acceptance-evidence.md](acceptance-evidence.md). Source hashes detect drift; they do not prove the documents were read.

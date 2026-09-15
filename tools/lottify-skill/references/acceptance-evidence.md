# Acceptance evidence

Ticket 16 requires stable `Requirement/Decision → Acceptance Criterion → Scenario → Test Level → Evidence` traceability. A record must identify the environment, immutable build, execution time and durable result artifact. The requirement owner approves criteria; implementation does not relax them.

Generate a draft manifest with `scripts/manifest_generator.py`. Fill source alignment, applicable ADR disposition (`reviewed` with an ADR source, or `not-applicable`), one Writer and exact allowed scope before delegation. Run `scripts/source_alignment_check.py MANIFEST --stage delegation` to check paths, source hashes and required fields. The checker cannot prove that a person read a document; `confirmed_by_lead` is an explicit Lead attestation. Risk and parallelism fields are suggestions for Lead review, never permission for concurrent Writers.

For acceptance, place records under `evidence.records`:

```yaml
evidence:
  required: ["deterministic ledger/invariant integration result"]
  records:
    - requirement_id: "Ticket 04: ledger invariant"
      acceptance_id: "approved criterion identity"
      scenario_id: "concurrent reservation rejection"
      level: integration
      environment: CI/PostgreSQL
      build_id: "immutable commit or release SHA"
      candidate_sha: "same immutable Git SHA as acceptance.candidate_sha"
      result: passed
      executed_at: "2026-09-14T12:00:00Z"
      artifact: "durable CI run/report reference"
      implementation: ["apps/api/src/example.ts"]
      actual_result: "one reservation succeeds; overspend rejected"
      covers: ["deterministic ledger/invariant integration result"]
```

`covers` maps records to `evidence.required` items. Before acceptance, set `acceptance.candidate_sha` to the immutable Git SHA being judged. Every evidence record and required review must carry that same exact `candidate_sha`; evidence or review for another candidate is stale and must not satisfy the gate. `build_id` remains the immutable build/release artifact identity and may differ from the Git SHA. Run `scripts/source_alignment_check.py MANIFEST --stage acceptance` after setting `acceptance.status: verified` and resolving gaps. The checker independently enforces the mandatory Ticket 13/16 production matrix and required release reviewers/subskills so a hand-edited manifest cannot weaken the release gate. Critical financial and state transitions need deterministic PostgreSQL integration evidence. A production candidate additionally requires the Ticket 13/16 chain for critical Member/Admin health and smoke paths, functional/visual behavior, performance/security, migration and backup/restore, observability, deployment and rollback/roll-forward recovery.

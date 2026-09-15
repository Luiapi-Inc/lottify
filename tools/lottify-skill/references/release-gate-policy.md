# Release Gate Policy

Production deployment requires release-gate-agent review.

Flow:

```
Implementation
 |
 v
Quality Gate
 |
 v
Acceptance Evidence
 |
 v
Production Readiness Review
 |
 v
Deploy Decision
```

Required evidence:

- requirement/specification trace bound to the exact candidate;
- critical functional E2E plus approved UX functional/visual result;
- production-like performance evidence;
- security release-gate evidence;
- migration compatibility and backfill/data-integrity evidence;
- backup/PITR restore evidence with the approved RPO/RTO and integrity checks;
- production observability/correlation/alert evidence;
- reviewed deployment plan/readiness for the immutable candidate;
- rollback or governed roll-forward recovery plan/readiness.

For production, the checker independently enforces this Ticket 13/16 matrix, required release subskills/reviewers, and exact candidate binding; removing an item from a hand-edited manifest cannot weaken the gate. The reviewer checks the immutable candidate, blue/green migration compatibility, backup/PITR checkpoint, health and critical Member/Admin smoke evidence before a deliberate traffic switch. Application rollback is valid only while schema/data compatibility holds; otherwise document the governed roll-forward recovery path. Missing mandatory Ticket 13/16 evidence is NO-GO. Review approval does not deploy, migrate production, or switch traffic.

A passing test suite alone is insufficient for release acceptance.

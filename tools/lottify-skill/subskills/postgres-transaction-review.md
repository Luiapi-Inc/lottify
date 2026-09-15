# postgres-transaction-review

## Owner Agent

financial-integrity-agent.

## Purpose

Protect race-sensitive PostgreSQL transaction semantics.

## Trigger Conditions

Use for locking, uniqueness, idempotency, Reservation, finalization or concurrent command paths.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Identify the owning use case and exact atomic invariant boundary.
- Check locks, constraints, isolation, ordering, retry semantics and transaction duration.
- Ensure provider/network calls do not run inside the database transaction.
- Require deterministic competing-request and crash/replay integration results.

## Required Tools

Relevant tools and evidence sources.

## Severity Rules

- Blocker: prevents acceptance.
- High: requires resolution or explicit acceptance.
- Medium: track follow-up.
- Low: improvement.

## Blocking Criteria

Conditions that block merge or release.

## Evidence Output

Provide:

- Findings
- Risk level
- Required changes
- Verification evidence

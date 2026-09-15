# prisma-schema-review

## Owner Agent

backend-agent with quality-gate-agent review.

## Purpose

Protect persistence ownership and Prisma schema compatibility.

## Trigger Conditions

Use for Prisma model, relation, constraint, index or migration changes.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Check bounded-context ownership of tables, repositories and migrations.
- Verify financial/race constraints live in PostgreSQL where required.
- Inspect migration order, existing-data compatibility and old/new application behavior.
- Require migration and invariant tests; invoke database-migration-review for backfills or rollout changes.

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

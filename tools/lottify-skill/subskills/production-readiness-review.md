# production-readiness-review

## Owner Agent

release-gate-agent.

## Purpose

Evaluate Ticket 13/16 production GO evidence for the immutable candidate.

## Trigger Conditions

Use for production candidate, deployment or recovery readiness review.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Trace release-critical requirements to deterministic evidence for the exact candidate.
- Check security, load, migration compatibility, backup/restore, observability and critical Member/Admin smoke results.
- Validate blue/green traffic-switch criteria and rollback or governed roll-forward path.
- Mark missing mandatory evidence NO-GO; review is not deployment authorization.

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

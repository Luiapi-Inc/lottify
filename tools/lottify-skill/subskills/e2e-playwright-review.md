# e2e-playwright-review

## Owner Agent

qa-agent.

## Purpose

Verify critical Member/Admin journeys end to end.

## Trigger Conditions

Use for Quote→Confirm→Receipt, Withdrawal, correction/history and governed Admin flows.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Use controlled seed/time/provider behavior for repeatable scenarios.
- Verify both authoritative business result and user-visible state.
- Cover applicable denial, retry, ambiguous failure and recovery paths.
- Tie report artifacts to scenario ID, environment, build SHA and execution time.

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

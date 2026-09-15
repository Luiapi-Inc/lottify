# frontend-accessibility-review

## Owner Agent

frontend-agent, reviewed by qa-agent when acceptance journeys change.

## Purpose

Protect Member/Admin UX behavior and accessibility against approved flows.

## Trigger Conditions

Use for React components, forms, Member/Admin pages or user-visible states.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Compare normal, validation, denial, loading and recovery states with approved UX flows.
- Check keyboard, focus, labels, errors and responsive behavior where applicable.
- Confirm generated API client and authoritative server state drive the result.
- Use functional E2E evidence for critical journeys; screenshots are supplemental.

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

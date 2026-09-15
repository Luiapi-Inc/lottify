# ddd-domain-review

## Owner Agent

domain-agent.

## Purpose

Protect bounded-context ownership, aggregates and approved business invariants.

## Trigger Conditions

Use for domain rules, aggregate state or lifecycle changes.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Compare transitions and forbidden effects with Tickets 01–03 and the active domain ticket.
- Check aggregate ownership and cross-context seams; reject shared mutable domain authority.
- Verify illegal-state rejection and recovery behavior with focused tests.
- Record any source conflict instead of redefining the invariant in code.

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

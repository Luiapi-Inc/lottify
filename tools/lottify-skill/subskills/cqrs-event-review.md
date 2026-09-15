# cqrs-event-review

## Owner Agent

domain-agent.

## Purpose

Protect command ownership, durable events and replay semantics.

## Trigger Conditions

Use for commands, events, Outbox, queue or cross-context orchestration.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Verify one owning command/use case and explicit cross-context contract.
- Check event schema compatibility, Transactional Outbox durability and idempotent consumers.
- Ensure Redis/BullMQ and realtime are non-authoritative.
- Require deterministic duplicate/redelivery and crash recovery evidence.

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

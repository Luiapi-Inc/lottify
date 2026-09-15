# api-contract-review

## Owner Agent

api-contract-agent.

## Purpose

Protect the authoritative `/api/v1` contract and generated-client compatibility.

## Trigger Conditions

Use for controllers, DTOs, OpenAPI, error codes or generated clients.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Compare actual request/response, auth and domain error behavior with approved OpenAPI.
- Check idempotency/concurrency semantics where applicable and review the contract diff.
- Verify generated Member/Admin client compatibility plus behavioral contract tests.
- Record breaking changes and affected acceptance evidence for re-evaluation.

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

# security-auth-review

## Owner Agent

security-agent.

## Purpose

Protect identity, policy denial, webhook authenticity and sensitive data.

## Trigger Conditions

Use for auth, sessions, OTP/MFA, RBAC/contextual policy, Admin approval, webhooks or secrets.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Check positive and denial paths, role/context restrictions, maker-checker and re-authentication.
- Verify session rotation/revocation and webhook signature/replay handling where applicable.
- Inspect audit records, sensitive-data masking, rate limits and secret exposure.
- Require deterministic negative-path evidence tied to the exact candidate.

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

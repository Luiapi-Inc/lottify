# payment-ledger-review

## Owner Agent

financial-integrity-agent.

## Purpose

Protect authoritative money movement and Ledger invariants.

## Trigger Conditions

Use for Wallet, Ledger, Deposit, Bet posting, Refund, Settlement, Withdrawal, Promotion monetary effects or reconciliation.

## Required Source Documents

- Active Lottify specification
- Implementation roadmap
- Acceptance criteria
- Applicable ADRs
- Current implementation checkpoint

## Review Checklist

- Verify PostgreSQL Ledger authority and Wallet projection semantics; no mutable balance shortcut.
- Check posting balance, Reservation lifecycle, reversal/correction linkage, uniqueness and idempotent retries.
- Require deterministic integration evidence for concurrency, failure/recovery and forbidden monetary effects.
- Record unresolved invariant or reconciliation gaps against the active checkpoint.

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

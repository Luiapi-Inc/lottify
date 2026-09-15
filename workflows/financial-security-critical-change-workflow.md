# Financial / Security Critical Change Workflow

## Purpose

Control changes that can affect money correctness, privileged access, trust boundaries, once-only effects, authoritative contracts, or recovery semantics. This route has stricter serialization and evidence requirements than the general Feature or Bug workflow.

## Trigger

Run when the main router classifies the change as high risk, including changes to Ledger/Wallet/Reservation, Deposit/Withdrawal, Bet Confirm/refund/settlement/correction, financial promotions, idempotency/replay/concurrency/finalization, identity/session/authorization/Admin privilege, provider webhooks, secrets/security policy, or their authoritative schema/API/event/provider boundaries.

## Workflow

1. **Requirement and invariant lock**
   - Read the active source Requirement/Decision, Ticket 02 workflow semantics, Ticket 16 evidence obligations, Ticket 19 dependency/release sequencing, relevant ADRs, and authoritative contracts.
   - State the invariant being protected and the failure modes that must remain impossible.
2. **Threat/trust analysis**
   - Run `security-threat-model` because this route is explicitly high risk.
   - Run `security-best-practices` for the affected language/framework/security surface.
   - Threat-model output informs implementation/test coverage but cannot redefine the approved business invariant.
3. **Plan and ownership**
   - Establish `Plan -> Intended Result -> Current State -> Gap -> Implementation`.
   - Keep WIP=1 on each unstable shared financial/schema/migration/API/event/transaction boundary.
   - Use `lottify` whenever multiple agents are delegated. Parallel Writers are limited to proven-disjoint work with stable prerequisites; unstable shared critical boundaries remain serialized under one Writer while read-only Architecture/Test-Evidence Guards may still participate.
4. **Implementation**
   - Use `tdd` for deterministic invariant/regression seams.
   - Preserve authoritative once-only effects, durable orchestration state, compensation/reconciliation paths, and approved transaction ordering.
   - Do not replace an approved financial model with a simpler mutable-balance or best-effort substitute.
5. **Mandatory evidence**
   - Deterministic integration tests anchor the applicable Ledger balance/integrity, reservation concurrency, Bet Confirm, refund, settlement/correction, Withdrawal finalization, idempotency/replay, and illegal-transition invariants.
   - Cover applicable happy, denial/rejection, duplicate/retry, race/concurrency, timeout/ambiguous outcome, partial failure, recovery/compensation, and replay cases.
   - Provider/async changes require authenticity/signature, duplicate delivery, timeout/ambiguity, retry/DLQ/replay, and once-only business-effect evidence where applicable. When Transactional Outbox or async delivery/once-only effects are affected, include crash/redelivery proof showing that replay/redelivery can occur while the authoritative business or financial effect remains once-only.
   - Security-sensitive authentication/session/OTP/MFA/re-authentication, RBAC/contextual denial, maker-checker/separation-of-duties, webhook, secrets/PII, and abuse/rate-limit surfaces require applicable positive and negative acceptance scenarios. Threat-model or code-review output may inform these scenarios but cannot substitute for Ticket 16 acceptance evidence.
   - Schema/data changes require migration compatibility, backfill/data-integrity verification, and rollback or governed roll-forward evidence.
6. **Actual Result**
   - Verify the authoritative financial/security state directly after the scenario, including absence of duplicate or orphaned effects.
   - For affected Member/Admin flows, run `vercel:agent-browser-verify` in addition to backend/integration evidence.
7. **Review**
   - Run `code-review` before merge.
   - Standards and Spec review must both be clear of blocking findings.
   - Re-run targeted security review when the review changes a trust-sensitive implementation detail.
8. **Acceptance record**
   - Record the complete Ticket 16 trace, immutable build/environment identity, specialist reports, Actual Result, and unresolved risk/evidence gaps.

## Definition of done

The change is merge-ready only when the protected invariant is still proven under applicable failure/retry/race/recovery scenarios, security review is complete, Actual Result is observed, code review has no blocker, and mandatory evidence is durable and traceable.

Any unexplained flaky critical test, unresolved race, ambiguous financial result, missing specialist evidence, or source-of-truth conflict remains blocking.

## Checkpoint policy

Do not interrupt for routine reversible implementation or evidence collection. Escalate when the approved invariant/contract must change, a critical ambiguity cannot be resolved from source/evidence, or the next action is destructive/production-impacting. The brief must include the invariant, threat/failure mode, proven evidence, unresolved risk, and the exact decision required.

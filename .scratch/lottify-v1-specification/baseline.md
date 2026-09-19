# Lottify v1 locked baseline — Q1–Q156

This file persists the decisions explicitly confirmed before the Wayfinder map was charted. It is the baseline for this effort; later tickets refine unresolved details without silently changing these decisions.

## Destination and scope

- Q1: Destination is an implementation-ready specification before product-code implementation.
- Q2: Do not inspect, compare with, or design from the previous Lottify implementation in this effort.
- Q3: Actors in scope are MEMBER, ADMIN, SUPER_ADMIN, AUDITOR, and SYSTEM/WORKER. AGENT exists as a role name but its model/hierarchy is not designed in this effort.
- Q4: Lottery is a generic multi-product model that can add future products without changing the core workflow.
- Q7/Q156: Agent model/hierarchy is out of scope. Multi-tenant/operator support is out of scope; v1 is single operator.
- Q154: Source-of-truth deliverables include workflow, domain glossary, state machines, business rules, permission/policy matrix, API contract, UX flows, acceptance criteria, and implementation roadmap with traceability.
- Q155: The specification includes a technology baseline, separated clearly from business requirements.

## Identity, authentication, member and security

- Q17: Login identity is phone number + OTP only. Email may be added after registration but is not a login identifier.
- Q27: Sessions use short-lived access tokens plus rotating refresh tokens and per-device revocation/session management.
- Q28: Admin has MFA; sensitive-action re-authentication is configurable.
- Q56: Account restrictions are capability-specific (for example betting-blocked or withdrawal-blocked), not one overloaded account status.
- Q57: Phone/device/bank/KYC verifications are separate verification capabilities.
- Q58: Device/session risk can allow, challenge, re-authenticate, or block according to policy.
- Q99: OTP has expiry, attempt limits, resend cooldown, old-code invalidation, anti-enumeration, and security audit events.
- Q103: Members can manage/revoke sessions/devices and perform sensitive self-service with OTP/re-auth according to policy.
- Q117: Duplicate-account detection uses phone/KYC/bank/device/risk signals; device alone is not a hard block.
- Q118: Lost-phone recovery is a high-risk identity-verification/KYC/manual-review workflow.
- Q142: OTP registration creates the account, but betting opens only after mandatory onboarding/policies pass; registration is not coupled to KYC.
- Q143: Terms/privacy/betting rules are versioned and acceptance evidence is retained; important versions may require re-acceptance.

## Lottery product, draw and betting

- Q6/Q29: Draws are generated from Lottery Product + Schedule Template, with per-draw overrides for date/cutoff/result source/status and support for irregular real-world draw dates.
- Q8: Betting flow is Quote → Validate → Reserve/Commit Funds → Confirm Bet; the member sees the actual payout before confirmation.
- Q9: Member cancellation is allowed before cutoff according to Product policy; refunds go through Ledger entries.
- Q15: Exposure/risk includes blocked/restricted numbers and configurable max exposure/max bet controls, checked at Quote and Confirm.
- Q32: Bet Types are defined per Lottery Product and carry their own validation, payout, limits, and settlement rules.
- Q33: Default payout is defined per Bet Type with optional Draw override; accepted payout is snapshotted at Quote/Confirm.
- Q34: All Bet Types in a Draw share the Draw cutoff; there is no Bet-Type-specific cutoff in v1.
- Q35: Number restrictions support BLOCKED, REDUCED_PAYOUT, and MAX_AMOUNT with applicability per Draw/Bet Type/time window.
- Q36/Q42: A Bet Order contains multiple Bet Lines and is accepted atomically; any invalid line rejects the whole Order.
- Q37: Draw lifecycle uses explicit states including scheduled/open/closed/result-pending/result-confirmed/settling/settled and cancelled, with governed transitions.
- Q38: Cancelling a Draw with bets triggers an idempotent full refund workflow through Ledger entries.
- Q40: Each Product has its own business timezone; persisted business instants are canonical/server-authoritative.
- Q43: Quote snapshots apply until expiry only while still permissible; hard emergency/risk controls may invalidate a quote immediately.
- Q44: Confirm reserves/commits funds for the whole Order transactionally before the Bet is final.
- Q45: Liability/max-payout limits can apply at Member/Order/Draw/Product levels; the strictest applicable limit governs.
- Q46: Emergency betting kill switches exist at system/Product/Draw scope with permission, reason, re-auth/approval policy, and audit.
- Q77: Member betting UX is Product → Draw → Bet Type → numbers/amount → Quote preview → Confirm, showing cutoff/payout/restrictions/total.
- Q119: Closed Draws are not normally reopened; exceptional reopen requires privileged approval/audit and is forbidden after Result exists.
- Q128: Confirm rechecks exposure/liability; a quote does not reserve capacity and can be rejected/requoted if limits are exceeded.
- Q129: Schedule Templates generate Draws on a configurable rolling horizon; Admin can add/move/cancel specific Draws.
- Q130: Draw configuration is snapshotted from Product and changed only by versioned per-Draw override, so later Product changes do not mutate an active Draw.
- Q132: Bet-number canonicalization preserves semantic leading zeroes according to Bet Type.
- Q133: Duplicate equivalent Bet Lines are normalized/aggregated before Quote.
- Q134: Bet Type has min/max stake per line with optional Draw override; stricter Member/risk limits may also apply.
- Q135: Entry helpers (reverse, run, permutations, bulk paste, etc.) expand into canonical Bet Lines shown to the member before Quote.
- Q136: Confirmed bets have an immutable receipt/reference that reconstructs Order, Lines, stake, payout snapshots, and confirmation time.
- Q137: Quote expiry is the configured TTL or Draw cutoff, whichever comes first.
- Q138: v1 does not reserve exposure/liability when creating a Quote; Confirm is authoritative.
- Q139: Large-bet review is configurable; normal default is reject/requote rather than an opaque wait state.
- Q140: v1 member cancellation is whole-Bet-Order only, not partial Bet-Line cancellation.
- Q141: Concurrent/repeated Confirm of the same Order has exactly one business effect through idempotency + transactional uniqueness.
- Q144/Q145: Lottery Product lifecycle is DRAFT → ACTIVE → SUSPENDED → RETIRED. A Draw may be deleted only while unpublished and without business activity; afterward it is cancelled/voided with audit.
- Q151: Server time, never client time, governs cutoff, quote expiry, OTP expiry, schedules, and settlement timing.

## Result and settlement

- Q10: Result intake supports external providers and manual Admin entry; manual results have approval/audit controls.
- Q11: Settlement is deterministic, idempotent, retryable, and re-runnable without duplicate payout.
- Q16: Corrected results use reversal/compensating Ledger entries and re-settlement; historical Ledger entries are not edited.
- Q39: Each Lottery Product defines its Result Schema and settlement rules.
- Q41: Missing/late results keep the Draw in RESULT_PENDING; incomplete/unvalidated results never settle automatically.
- Q64: Settlement is calculated per Bet Line and aggregated into Bet Order summary.
- Q65: v1 has no partial settlement; the complete Draw Result must validate before settlement.
- Q100: External Result data is validated for duplicates/conflicts; conflicting sources require review and cannot auto-settle.
- Q125: Result approval policy is configurable per Product/Result Source; trusted sources may auto-confirm, manual/conflicting sources require approval.
- Q126/Q127: Draw settlement is exposed atomically as a batch; partial progress is never member-visible and retry/restart is idempotent.
- Q131: Members see an understandable correction/refund/re-settlement history without internal sensitive details.

## Wallet, ledger and financial correctness

- Q5: Wallet + Ledger are the financial core; Ledger is the money source of truth.
- Q22: Balance buckets include CASH, BONUS, and LOCKED with defined spending/withdrawal priority.
- Q26: Manual credit/debit requires permission, reason, approval policy, immutable Ledger entry, and never direct balance mutation.
- Q47: Ledger balance is distinct from Wallet projection of available/reserved/locked balances.
- Q62: Ledger is full double-entry; every movement balances and posted entries are immutable.
- Q63: Every financial operation has a business transaction id plus correlation/idempotency identity spanning subsystems.
- Q66: Historical decisions can be reconstructed from immutable snapshots/config versions used at transaction time.
- Q88: PostgreSQL is the authoritative transactional store for the financial core; async events propagate state but do not replace required atomic local transactions.
- Q115: Money/payout calculations use fixed precision or integer minor units, never floating point; rounding rules are part of the financial contract.
- Q121: Ledger may represent a debt/negative position after recovery/chargeback, but available balance blocks betting/withdrawal until policy resolves it.
- Q146: Financial/accounting periods can close; later corrections post compensating transactions in the current period instead of mutating closed history.

## Deposit, withdrawal and payment providers

- Q12: Deposit workflow covers Payment Request → Provider → Callback/Webhook → Verify → Ledger Credit → Reconciliation.
- Q13: Withdrawal workflow covers Request → Reserve Balance → KYC/Risk → Approval → Payout → Confirmation → Ledger Finalize → Reconciliation.
- Q25: Multiple payment providers are supported behind adapters; core workflow does not couple to a vendor.
- Q48: Provider callbacks are idempotent and state-transition validated; duplicate credit is forbidden.
- Q49: Member withdrawal can be cancelled before payout/processing; after provider processing begins, recovery/reversal workflow is required.
- Q54: Unmatched/ambiguous deposits become UNMATCHED/REVIEW_REQUIRED and are not auto-credited.
- Q55: Verified payout destination is a configurable policy; payout-destination changes are audited.
- Q61: Reconciliation covers Ledger ↔ Wallet projection ↔ Payment Provider ↔ Settlement with discrepancy queue and audited manual resolution.
- Q109: Provider reversal/chargeback uses compensating financial transactions and recovery controls; original Deposit/Ledger is never erased.
- Q114: Deposit/withdrawal fees are configurable by provider/method/amount and shown before member confirmation.
- Q120: Withdrawal min/max, daily limits, frequency, and review thresholds are configurable with KYC/risk/account restrictions.
- Q122: Default policy forbids sharing a payout bank account between Members; compliance/risk policy may handle exceptions.
- Q123: Multiple pending withdrawals are supported with independent reserves and configurable pending-request limits.
- Q148: Provider credentials are secret references with masked display, rotation, and audit; secrets are not ordinary configuration values.
- Q149: Providers have health/routing controls; automatic failover is configurable and may not switch provider mid-workflow when unsafe.
- Q150: Incoming webhooks verify authenticity/signature, enforce timestamp/replay protection, and retain evidence for audit.

## KYC, eligibility, risk and responsible gaming

- Q14: KYC-before-withdrawal is configurable; registration/deposit may occur before KYC according to policy.
- Q20: v1 includes configurable responsible-gaming limits, even when policies default to disabled.
- Q31: High-risk operations use a common configurable approval framework with maker-checker and threshold rules.
- Q102: Compliance rules such as KYC thresholds, withdrawal review, retention, and responsible-gaming limits are versioned policy configuration with effective periods and audit.
- Q107: KYC supports multiple provider adapters plus normalized results and manual review/escalation.
- Q108: Centralized eligibility policy checks age/account restrictions/responsible-gaming/self-exclusion/jurisdiction before Quote and again before Confirm.
- Change impact (2026-09-19): `docs/changes/2026-09-19-age-jurisdiction-policy-deferred.md` explicitly defers the concrete age threshold, jurisdiction allow/deny policy, jurisdiction-specific evidence requirements, and jurisdiction-specific policy outcomes from the current v1 engineering implementation/acceptance scope. The remaining Q108 restriction/responsible-gaming/eligibility architecture remains unchanged; deferred bindings must not be invented.
- Q116: Self-exclusion blocks betting immediately and is not normally Admin-overridable; eligible withdrawal remains subject to compliance policy.

## Promotion, bonus and referral

- Q19: Bonus, promotions, cashback, referral, and turnover requirements are in v1 scope.
- Q23: Turnover rules can configure multiplier, eligible Products/Bet Types, minimum payout/odds, expiry, and contribution percentage.
- Q24: Referral is one level in v1.
- Q50: Promotion terms are snapshotted when Member entitlement is granted.
- Q51: Campaigns may be stackable or exclusive with deterministic priority.
- Q52: BONUS cannot be withdrawn directly; successful turnover converts eligible value to CASH according to Campaign policy.
- Q53: Winnings from BONUS can become BONUS or CASH according to Campaign configuration.
- Q110: Referral rewards use configurable milestones such as signup/KYC/first deposit/turnover plus anti-abuse checks.
- Q111: Campaign lifecycle is separate from Member Entitlement lifecycle.
- Q112: Expiry removes only bonus tied to the relevant entitlement via Ledger movement and does not touch CASH.
- Q113: Turnover contribution starts from confirmed eligible bets and is finalized only when the bet is not cancelled/refunded.

## Authorization, approval, admin configuration and audit

- Q21: Important Admin actions (payout/cutoff/result/manual money/withdrawal approval etc.) have immutable audit trails.
- Q28/Q31: Admin sensitive actions may require re-auth and configurable approval.
- Q59: Authorization uses RBAC plus policy conditions/thresholds/resource state.
- Q60: Important configuration is versioned and immutable once used, with effective dates/periods.
- Q70: Capability-level maintenance controls can disable only affected capabilities separately from emergency kill switches.
- Q74: Audit and Ledger retention policies are configurable for compliance; historical records are immutable.
- Q75: Sensitive data uses least privilege, field masking, and audited access.
- Q76: Admin v1 is an operational control plane for Draw/Betting/Payments/Withdrawals/Settlement/Reconciliation/Alerts, not just CRUD.
- Q95: Risky features/policies can be staged via versioned feature/config controls with audit.
- Q101: High-risk Admin configuration changes require preview/diff, effective time, confirmation, and approval when policy requires.
- Q105: Important configuration follows DRAFT → REVIEW/APPROVAL → PUBLISHED rather than direct mutation of live values.
- Q106: No true Member-session impersonation; support uses audited, permissioned, masked diagnostic/read-only views.
- Q124: Post-cutoff Bet cancellation is an exceptional correction/refund workflow with reason, approval, and immutable audit, not a normal Admin action.
- Q147: Config rollback creates a new version from historical content and publishes it; historical versions are never edited.

## API, applications and UX

- Q30: Notification domain covers OTP, deposit/withdrawal, bet confirmation, result/winning, and security events through provider adapters.
- Q78: Member Bet history shows Orders/Lines/payout snapshot/settlement/cancellation/refund with Product/Draw/date/status filters.
- Q79: Member Wallet statement connects Deposit/Bet/Win/Refund/Bonus/Withdrawal to actual Ledger-backed transactions.
- Q80/Q81: REST + OpenAPI is the primary API contract; generated clients are the consumer interface; endpoints are versioned under /api/v1.
- Q82: APIs use a common machine-readable error contract including code/message/details/correlationId.
- Q83: List APIs share pagination/filter/sort conventions.
- Q84: Member App and Admin App are separate applications that may share API client/types/UI primitives.
- Q85: Realtime/event capability is designed in from the start; non-critical v1 views may fall back to polling.
- Q90: Architecture supports i18n; Thai is the primary v1 UI language.
- Q91: Admin/Auditor exports are supported; large exports are async and governed by permission/masking/audit.
- Q104: Members can disable only non-critical notifications; security/financial/regulatory notifications remain mandatory according to policy.

## Reliability, operations and observability

- Q67: Critical mutating APIs support idempotency keys; duplicates return the same result without duplicate effects.
- Q68: Cross-subsystem domain events use Transactional Outbox + idempotent consumers; delivery may be at-least-once while business effect remains once-only.
- Q69: Async jobs use retry policy, dead-letter/review queues, replay controls, failure reasons, and audit.
- Q71: Backup + point-in-time recovery + restore verification are production acceptance criteria.
- Q72: Production observability includes metrics, structured logs, distributed tracing, and error tracking with shared correlation IDs for business/financial transactions.
- Q73: Business alerts cover stuck settlement, reconciliation mismatch, payment backlog, draw timing failures, abnormal exposure, etc., separately from infrastructure monitoring.
- Q89: Reporting includes turnover, GGR, payout, deposits, withdrawals, liabilities, and reconciliation via read/reporting models separate from the transactional write path.
- Q97: v1 defines measurable capacity/performance targets for concurrency, betting throughput, callbacks, and settlement throughput.
- Q98: Login OTP, Quote, Confirm, Withdrawal, and Admin APIs have configurable endpoint/risk-based rate limits and abuse protection.

## Architecture, deployment, testing and release

- Q86: Acceptance Criteria trace to unit/integration/contract/E2E tests; deterministic integration tests anchor financial/state workflows.
- Q92: v1 architecture baseline is Modular Monolith with separate worker processes by workload and explicit domain boundaries.
- Q93: Redis may serve cache/session/rate-limit/queue roles but is not a business source of truth.
- Q94: Production DB migrations are backward-compatible and support rolling/blue-green deployment using expand → migrate/backfill → contract; no destructive one-step migration.
- Q96: Production release gate checks Requirement → Approved Plan → Implementation → Tests → Functional/Visual Result → Migration/Backup → Rollback; passing build/CI alone is insufficient.
- Q152: Bounded contexts are Identity & Access, Member, Lottery, Betting, Wallet & Ledger, Payments, KYC/Risk, Promotion, Result & Settlement, Notification, Admin/Approval, Audit, and Reporting, each owning its state.
- Q153: Cross-domain workflows use explicit orchestration rather than distributed transactions; atomic operations inside one database consistency boundary use local transactions.

## Explicitly out of scope

- Agent hierarchy/model design.
- Multi-tenant / multi-operator architecture.
- Product-code implementation during this Wayfinder planning effort.

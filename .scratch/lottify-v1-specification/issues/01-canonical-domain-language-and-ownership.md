# Lock canonical domain language and bounded-context ownership

Type: grilling
Status: resolved
Blocked by:

## Question

What is the final canonical domain glossary and exact ownership boundary for Identity & Access, Member, Lottery, Betting, Wallet & Ledger, Payments, KYC/Risk, Promotion, Result & Settlement, Notification, Admin/Approval, Audit, and Reporting, including which context owns each aggregate/state transition and which cross-context references are identifiers rather than shared mutable models?

## Comments

### Ownership round 1 — confirmed

- Identity & Access owns phone Login Identity, OTP/authentication factors, Sessions, Devices, MFA, and re-authentication. Member owns profile/contact data, onboarding state, terms acceptance, and effective Member capability restrictions. Cross-context identity is referenced by `memberId`; mutable identity/session models are not shared.
- Payments owns Deposit, Withdrawal, provider interaction/state, Payout Destination, and provider/webhook workflow state. Wallet & Ledger owns financial accounts, Balance Buckets, reservations, Ledger entries, and monetary postings. Payments never mutates balances directly.
- Lottery owns Lottery Product, Bet Type configuration, Schedule Template, Draw, and Draw lifecycle. Result & Settlement owns Result validation/correction and Settlement outcomes/batches. Result & Settlement references Draw identity/state and requests transitions explicitly rather than owning a mutable Draw copy.
- KYC/Risk owns Verification Cases, provider verification results, Risk Signals, Eligibility Decisions, responsible-gaming/self-exclusion policy evaluation. Member owns only the effective capability restrictions that must govern Member behavior.
- Admin/Approval owns Approval workflows but not another domain's configuration. Audit owns immutable Audit Records. Notification owns notification preferences/templates/delivery outcomes. Reporting is read-only and cannot mutate authoritative business state. Promotion owns Campaign, Entitlement, and Turnover; Wallet & Ledger remains authoritative for monetary/bonus balances.

### Ownership round 2 — confirmed

- Betting owns Quote, Bet Order, Bet Line, Bet Receipt, cancellation state, and live consumed betting exposure. Lottery owns the versioned Product/Draw configuration that Betting references.
- Lottery owns configured payout, number restrictions, stake limits, and liability/exposure limits by Product/Draw. Betting owns real-time consumed exposure and the final acceptance/rejection decision at Confirm. KYC/Risk owns Member/session eligibility and risk decisions, not betting exposure.
- There is no generic shared Workflow bounded context. The initiating business context owns orchestration state: Betting for bet confirmation/cancellation, Payments for deposit/withdrawal, Result & Settlement for settlement/correction, and Promotion for reward/turnover flows.
- Canonical configuration remains owned by its business context. Admin/Approval owns review/approval workflow and evidence only; it does not become the source of truth for Lottery, Promotion, KYC/Risk, Payments, or other domain configuration.
- Cross-context relationships use stable identifiers such as `memberId`, `drawId`, `betOrderId`, and `ledgerTransactionId`. Immutable snapshots are allowed when required for historical reproducibility, but mutable aggregates/models are never shared across bounded contexts.

## Answer

Lottify v1 uses thirteen explicit bounded contexts with single ownership of mutable business state:

1. **Identity & Access** — owns phone Login Identity, OTP/authentication factors, Sessions, Devices, MFA, and re-authentication.
2. **Member** — owns Member profile/contact data, onboarding state, terms acceptance, and effective capability restrictions.
3. **Lottery** — owns Lottery Product, Bet Type configuration, Schedule Template, Draw, Draw lifecycle, and versioned Product/Draw betting configuration.
4. **Betting** — owns Quote, Bet Order, Bet Line, Bet Receipt, cancellation state, consumed betting exposure, and Confirm acceptance/rejection.
5. **Wallet & Ledger** — owns financial accounts, Balance Buckets, reservations, immutable double-entry Ledger entries, and every monetary posting.
6. **Payments** — owns Deposit, Withdrawal, Payout Destination, provider interaction/state, and payment/payout webhook workflow state; it never mutates balances directly.
7. **KYC/Risk** — owns Verification Cases, provider verification results, Risk Signals, Eligibility Decisions, responsible-gaming/self-exclusion policy evaluation, and related risk decisions.
8. **Promotion** — owns Promotion Campaign, Promotion Entitlement, Turnover, referral/cashback reward semantics, and promotion orchestration; monetary balances remain under Wallet & Ledger.
9. **Result & Settlement** — owns Result intake/validation/correction, Settlement evaluation/outcomes/batches, and settlement/correction orchestration; Lottery remains owner of Draw state and transitions it through explicit commands/events.
10. **Notification** — owns notification preferences, templates/content policy, communication requests, and delivery attempts/outcomes.
11. **Admin/Approval** — owns Approval requests/workflows, maker-checker/threshold evidence, and administrative authorization flow; it does not own another context's canonical configuration.
12. **Audit** — owns immutable Audit Records for security-sensitive, administrative, and business-significant actions.
13. **Reporting** — owns read-only reporting/projection models and has no authority to mutate business state.

Cross-context contracts use identifiers and explicit commands/events/policy decisions. Mutable aggregates are not shared across contexts. Immutable snapshots are permitted only where a historical decision must be reproduced exactly.

No generic Workflow context is introduced. Cross-domain orchestration state belongs to the initiating business context.

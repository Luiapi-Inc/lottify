# Lock end-to-end business workflows and orchestration boundaries

Type: grilling
Status: resolved
Blocked by: 01

## Question

What are the exact happy-path and exceptional workflows for registration/onboarding, deposit, betting/quote/confirm/cancel, draw lifecycle, result intake, settlement/correction, withdrawal, promotion/referral, and account recovery, and where does each cross-domain workflow persist orchestration state?

## Comments

### Workflow round 1 — confirmed

- Registration/onboarding: after OTP succeeds, Identity & Access establishes the Login Identity and Member creates the Member record. Member-owned onboarding then evaluates required terms, onboarding requirements, and eligibility before capabilities such as betting are enabled. Registration completion does not imply betting eligibility, and registration is not intrinsically coupled to KYC.
- Deposit: Payments owns the orchestration from payment request/provider interaction through callback verification. A Deposit is complete only after the provider payment is verified and Wallet & Ledger confirms the authoritative credit posting. Receipt of a webhook or provider acknowledgement alone is not completion.
- Bet confirmation: Betting owns orchestration. Confirm revalidates Quote validity, Member eligibility, Draw/cutoff, restrictions and live exposure/liability, then coordinates the required Wallet & Ledger reserve/commit before the Bet Order becomes CONFIRMED. Any failed critical step leaves the Order unconfirmed and must not leave an orphaned debit/reservation.
- Bet cancellation: Betting owns Member cancellation before cutoff. It validates the Product/Draw cancellation policy, records cancellation intent, coordinates the Wallet & Ledger refund posting, and only then finalizes the Bet Order as cancelled. A cancellation is not complete while its required refund remains unposted.
- Withdrawal: Payments owns orchestration from request through balance reservation, KYC/Risk and Approval gates, provider payout, payout confirmation/evidence, and Ledger finalization. A Withdrawal becomes complete only when both payout evidence and authoritative Ledger finalization are complete; provider acceptance alone is not completion.

### Workflow round 2 — confirmed

- Draw lifecycle: Lottery owns orchestration from Schedule Template generation through publish/open, cutoff/close, result-pending, settled/cancelled lifecycle transitions. Automation and Admin manual override use the same governed transition rules.
- Result intake and settlement: Result & Settlement owns result intake, normalization, validation/conflict detection, approval according to policy, settlement-batch orchestration and per-Bet-Line calculation. It requests the relevant Draw transitions from Lottery, coordinates monetary effects with Wallet & Ledger, commits the settlement batch atomically for Member visibility, then requests the Draw transition to SETTLED.
- Result correction: corrections create a new Result revision instead of mutating historical Result data. The revision is validated/approved, the prior financial outcome is reversed through compensating Ledger postings, and the Draw is re-settled with a complete Member-visible correction trail.
- Promotion/referral: Promotion owns eligibility, Promotion Entitlement grant, reward/bonus requests, Turnover tracking, completion/expiry/conversion, referral milestones and cashback orchestration. Every monetary effect is posted by Wallet & Ledger rather than mutated inside Promotion.
- Account recovery: Identity & Access owns the recovery case. It collects identity evidence, obtains KYC/Risk/manual review and Approval when policy requires, changes Login Identity only after the recovery decision is authorized, revokes old Sessions and emits security notification/audit evidence. A new-phone OTP by itself is insufficient to recover the account.

### Workflow round 3 — confirmed

- Deposit exceptions: duplicate provider callbacks are idempotent no-ops after the already-recorded business effect is identified. Unmatched/ambiguous deposits move to `REVIEW_REQUIRED` and are not credited automatically. A provider reversal/chargeback after credit creates compensating Ledger postings and a recovery workflow; historical Deposit/Ledger records are never edited or deleted.
- Bet Confirm failure/retry: Betting persists orchestration state and the request/business idempotency identity. If a durable Wallet & Ledger effect has already committed but a later response/step fails, the workflow resumes/reconciles from durable state rather than debiting again or creating a duplicate Bet Order.
- Draw cancellation with existing bets: Lottery initiates cancellation and blocks further betting; Betting identifies affected confirmed Orders; Wallet & Ledger posts refunds idempotently. The Draw reaches fully completed `CANCELLED` only after all refund obligations are durably satisfied. Partial failure remains a recoverable operational state rather than being hidden as complete.
- Withdrawal provider failure: transient failures retry under provider policy. A definitive failure before successful payout releases the reserved balance through authoritative financial posting. An unknown/ambiguous provider outcome never releases funds immediately; it remains reserved and enters reconciliation/review until payout status is proven.
- Orchestration durability: every cross-context workflow persists explicit owner-controlled durable state, carries business transaction/correlation/idempotency identity, and can resume after process failure. Message/event delivery may be at-least-once, but every business effect is once-only through idempotent handling and authoritative state checks.

### Workflow round 4 — confirmed

- Settlement failure/retry: Result & Settlement persists durable Settlement Batch state. A failed batch never exposes partial financial outcome to Members; retry/resume continues from durable state, and every Ledger posting is idempotent so replay cannot duplicate payout or reversal.
- Promotion monetary failure: Promotion never finalizes an Entitlement/Turnover transition that requires a monetary effect until Wallet & Ledger confirms the authoritative posting. Failed postings leave the Promotion workflow in a recoverable state that can be retried safely.
- Approval pending behavior: when a workflow requires Approval, the owning domain persists an explicit waiting-for-approval state and resumes the same workflow after the approval decision. Admin/Approval owns the approval decision/evidence, not a replacement copy of the business workflow.
- Notification failure: ordinary notification delivery does not roll back or block completion of an already-committed authoritative business transaction. Notification retries independently inside Notification unless an explicit policy marks a particular notification/acknowledgement as a prerequisite.
- Unknown external outcome: provider operations with ambiguous outcome are never blindly retried or compensated. The owner records an ambiguous/reconciliation state, queries/reconciles with the provider until the authoritative outcome is known, then resumes or compensates exactly once.

## Answer

Lottify v1 uses explicit, owner-controlled durable orchestration for every cross-domain workflow. The initiating business context owns workflow state and resumes from durable checkpoints after process or integration failure; there is no generic shared Workflow context.

The end-to-end workflow contracts are:

1. **Registration / onboarding** — Identity & Access establishes the phone Login Identity after OTP verification; Member creates the Member record and owns onboarding/terms/eligibility progression. Registration completion is distinct from betting eligibility and does not intrinsically require KYC.
2. **Deposit** — Payments owns payment-request/provider/callback/verification orchestration. A Deposit completes only after provider payment is verified and Wallet & Ledger commits the authoritative credit. Duplicate callbacks are idempotent, unmatched deposits require review, and later chargeback/reversal uses compensating financial postings.
3. **Bet Quote / Confirm** — Betting owns Quote and Confirm orchestration. Confirm revalidates Quote, Member eligibility, Draw/cutoff, restrictions and live exposure/liability, then coordinates authoritative Wallet & Ledger reserve/commit before the Bet Order becomes confirmed. Idempotency and durable state prevent duplicate Orders or duplicate debit on retries.
4. **Bet cancellation** — Betting validates the pre-cutoff Product/Draw cancellation policy, records cancellation intent, coordinates authoritative refund posting, and marks the Order cancelled only after the refund is durably committed.
5. **Draw lifecycle / cancellation** — Lottery owns Draw generation and lifecycle. Automation and Admin override use the same transition rules. Draw cancellation blocks new betting, coordinates idempotent refunds for affected confirmed Orders, and reaches fully completed CANCELLED only after all refund obligations are satisfied.
6. **Result intake / settlement** — Result & Settlement owns result normalization, validation/conflict detection, approval, Settlement Batch execution and Bet-Line evaluation. It requests Draw transitions from Lottery and coordinates Wallet & Ledger postings. Settlement is Member-visible only as an atomic completed batch; failed batches resume idempotently without partial financial exposure.
7. **Result correction** — correction creates a new immutable Result revision, validates/approves it, reverses prior financial effects with compensating Ledger postings, then re-settles the Draw and preserves a complete Member-visible correction trail.
8. **Withdrawal** — Payments owns request → reserve → KYC/Risk/Approval → provider payout → confirmation/evidence → Ledger finalization. Provider acceptance is not completion. Definitive pre-payout failure releases the reserve through authoritative posting; ambiguous provider outcomes remain reserved and enter reconciliation until proven.
9. **Promotion / referral** — Promotion owns eligibility, Entitlement grant, rewards, Turnover, expiry/conversion, referral milestones and cashback orchestration. Monetary effects are always posted by Wallet & Ledger; Promotion state that depends on money does not finalize before the posting succeeds.
10. **Account recovery** — Identity & Access owns the recovery case, identity evidence, policy-driven KYC/Risk/manual review/Approval integration, Login Identity change and revocation of old Sessions. A new-phone OTP alone is insufficient; security notification and audit evidence are emitted after recovery actions.
11. **Approval gates** — the business context remains workflow owner while waiting for Approval. Admin/Approval owns only the approval decision/evidence, and the original workflow resumes after the decision.
12. **Notification side effects** — Notification delivery normally runs independently after authoritative business completion; failure does not undo the business transaction unless an explicit policy defines notification/acknowledgement as a prerequisite.
13. **Unknown provider outcomes** — ambiguous external outcomes always enter reconciliation/query state before retry or compensation; blind duplicate external side effects are forbidden.

All cross-context workflows carry business transaction, correlation and idempotency identity. At-least-once message delivery is acceptable only when every business effect remains once-only through idempotent consumers and authoritative state checks.

# Lock promotion, referral, bonus and turnover semantics

Type: grilling
Status: resolved
Blocked by: 01, 04

## Question

What exact Campaign and Entitlement models govern eligibility, reward issuance, CASH/BONUS/LOCKED interactions, stacking/exclusivity, bonus-funded winnings, turnover contribution/finalization, expiry, conversion to CASH, referral milestones, cashback, anti-abuse, and historical term snapshots?

## Comments

### Promotion round 1 — confirmed

- Campaign model: Promotion Campaign is a versioned configuration root defining eligibility criteria, reward type/value, eligible Products/Bet Types, turnover rules, stacking/exclusivity, effective period, expiry, anti-abuse policy, and reward-funding/bucket behavior. A published Campaign version is immutable for historical use.
- Entitlement snapshot: when a Member earns or is granted a promotion, Promotion creates a Member-specific Entitlement snapshot containing the exact Campaign version, granted reward, turnover target, eligible scope, contribution rules, expiry, winnings-destination rule, and stacking decision. Later Campaign changes do not rewrite existing Entitlements.
- Reward issuance: an Entitlement transition that claims reward grant/completion waits for the required Wallet & Ledger posting to succeed. Monetary promotion postings are linked to `promotionEntitlementId`; bonus grant posts through explicit Promotion funding/control to Member BONUS accounting rather than direct balance mutation.
- CASH/BONUS spending priority: spending allocation is deterministic and governed by the applicable promotion/wallet policy, snapshotted at Bet Confirm. Default v1 priority is eligible BONUS before CASH. BONUS may fund only the Product/Bet Type scope allowed by its Entitlement; otherwise CASH is used according to policy or Confirm rejects for insufficient eligible funds. The accepted source allocation is preserved under the financial invariants.
- Stacking/exclusivity: Campaign conflicts are resolved deterministically before grant. Exclusive Campaigns suppress conflicting Campaigns by explicit priority; stackable Campaigns combine only under explicit compatibility rules. Priority uses defined ordering with a stable tie-breaker, and the resulting grant/stacking decision is snapshotted rather than depending on query or database ordering.

### Promotion round 2 — confirmed

- Turnover contribution begins from a `CONFIRMED` Bet that falls within the Entitlement's snapshotted eligible scope. Contribution is calculated from the accepted source allocation and Campaign terms such as eligible funding source, Product/Bet Type, contribution percentage, minimum payout/odds rule, and exact Campaign version. A Bet that is later cancelled or refunded does not retain finalized turnover credit.
- Turnover completion is financial-state dependent. When accumulated finalized turnover reaches the snapshotted target, Promotion requests an authoritative Ledger conversion of the eligible value from `BONUS` to `CASH`; the Entitlement cannot transition to `COMPLETED` until that conversion posting succeeds.
- Bonus-funded winnings use the destination rule captured in the Entitlement snapshot, such as `BONUS`, `CASH`, or an explicitly supported proportional outcome based on accepted source allocation. Settlement never consults the latest Campaign configuration to determine historical winnings treatment.
- Entitlement expiry removes only remaining BONUS value traceable to that Entitlement through a new Ledger posting. CASH is never removed by bonus expiry. Turnover history is preserved for audit, and anti-abuse revocation/correction uses governed compensating Ledger transactions rather than deleting historical financial or promotion facts.
- Referral is single-level in v1. Referral milestones such as signup, KYC, first deposit, or turnover are immutable versioned rules and each `referral + milestone` reward is idempotent. Cashback is calculated from immutable eligible transaction/settlement facts. Both referral and cashback rewards must pass current eligibility and anti-abuse policy before grant.

### Promotion round 3 — confirmed

- Multiple Entitlements: when several eligible Entitlements can fund a Bet, source selection is deterministic by eligibility, nearest expiry, explicit priority, then stable tie-breaker. The exact Entitlement/bucket allocation is snapshotted at Bet Confirm so settlement, refund, turnover, expiry, and correction reuse the accepted allocation.
- Turnover lifecycle: a confirmed eligible Bet creates provisional contribution. Cancellation/refund removes that provisional contribution; terminal non-refunded Bet/Settlement facts finalize contribution. Later correction/re-settlement creates compensating turnover adjustments rather than rewriting contribution history.
- Expiry while a Bet is in flight: expiry removes only unreserved/unconsumed BONUS traceable to the Entitlement. BONUS already reserved/consumed by a confirmed Bet continues through settlement using its original snapshot and is never clawed back mid-workflow.
- Anti-abuse decisions return `ALLOW`, `REVIEW_REQUIRED`, `DENY`, or `REVOKE` with reason codes, evidence references, and policy version. Manual override/revocation requires explicit permission, reason, and audit evidence.
- Promotion correction: incorrect reward, turnover, referral, or cashback outcomes are corrected through idempotent correction/compensating events and, when monetary, linked Ledger transactions referencing the original transaction and Entitlement. Historical promotion records are never edited in place.

## Answer

Lottify v1 models promotions through immutable Campaign versions and Member-specific Entitlement snapshots so eligibility, funding, turnover, winnings, expiry, referral, cashback, and corrections remain reproducible from the exact terms that governed each decision.

1. Campaign versions define eligibility, reward value/type, eligible Product/Bet Type scope, turnover, stacking/exclusivity, effective period, expiry, anti-abuse, and reward-funding rules. Published versions are immutable.
2. Each Entitlement snapshots the exact Campaign version and resolved Member-specific terms, including reward, turnover target, eligible scope, expiry, winnings destination, and stacking decision.
3. Monetary grant/completion states wait for authoritative Wallet & Ledger postings; every promotion posting references the Entitlement.
4. Eligible BONUS is consumed before CASH by default, subject to the Entitlement scope. Multiple eligible Entitlements are selected deterministically and the accepted source allocation is snapshotted at Bet Confirm.
5. Campaign stacking/exclusivity resolves through explicit priority and compatibility rules with stable tie-breaking; database/query order never decides the outcome.
6. Turnover starts provisionally from confirmed eligible Bets, is removed by cancellation/refund, and becomes finalized only from terminal non-refunded outcomes. Corrections use compensating turnover adjustments.
7. Reaching the turnover target does not complete an Entitlement until the required `BONUS → CASH` Ledger conversion succeeds.
8. Bonus-funded winnings follow the Entitlement snapshot (`BONUS`, `CASH`, or explicitly supported proportional treatment), never the latest Campaign configuration.
9. Expiry removes only remaining value traceable to that Entitlement and never touches CASH; already consumed/reserved value in confirmed Bets completes under its original snapshot.
10. Referral is single-level in v1, milestone rewards are idempotent, and cashback derives from immutable eligible financial/settlement facts.
11. Anti-abuse decisions are explicit, evidence-backed, versioned outcomes; manual override/revocation is permissioned and audited.
12. Promotion/referral/cashback corrections never mutate history; they use idempotent compensating events and linked Ledger postings where money is affected.

These rules preserve deterministic source provenance, financial integrity, historical terms, and once-only reward behavior across all promotion flows.

# Lock financial ledger, balance and accounting invariants

Type: grilling
Status: resolved
Blocked by: 01

## Question

What exact double-entry account model, posting rules, balance-bucket semantics, reservation mechanics, compensation/reversal patterns, period-close rules, rounding rules, transaction identities, and reconciliation invariants make every Deposit, Bet, Win, Refund, Bonus, Adjustment, Chargeback, and Withdrawal reproducible and balanced?

## Comments

### Financial round 1 — confirmed

- Ledger scope: Lottify uses a balanced operational double-entry subledger as the financial source of truth. It includes Member accounts plus system/counterparty accounts such as provider clearing, betting settlement, promotion, adjustment/recovery. Every Financial Transaction balances debit and credit within one currency. This subledger is not required to be the operator's complete statutory/corporate General Ledger; finance/reporting integration can map outward separately.
- Member balance accounts: Member monetary value is represented by Ledger subaccounts for `CASH`, `BONUS`, and `LOCKED`. No mutable balance field is authoritative. Posted balance is derived from Ledger postings, and bucket conversion such as `BONUS → CASH` is itself a balanced Ledger transaction rather than a field update.
- Reservation semantics: a Reservation is a durable Wallet & Ledger hold but is not a posted Ledger ownership transfer. `available = posted spendable balance - active reservations`. Bet/Withdrawal reservations have unique reservation identities and business references; reserve/release/consume are idempotent. Consuming a Reservation and creating its final Ledger posting is atomic inside the financial consistency boundary, and concurrent reservations cannot drive available balance below zero.
- Financial transaction identity: each monetary effect has an immutable Financial Transaction carrying business transaction identity, operation type, correlation identity, source/idempotency identity, relevant domain references, currency, postings, posted/effective times, and reversal/compensation linkage when applicable. Reusing the same idempotency key with the same payload returns the original financial result; reuse with a different payload is a conflict.
- Monetary precision: THB v1 posts integer minor units (satang). Intermediate calculations use exact decimal/fixed precision and round once at the financial posting boundary according to a versioned operation/payout rounding contract. Binary floating point and independently implemented frontend/service rounding are forbidden for financial authority.

### Financial round 2 — confirmed

- Deposit/Withdrawal postings: a verified Deposit posts from Provider/Clearing to Member CASH. Withdrawal reservation remains a Reservation, not a Ledger posting; successful payout atomically consumes the Reservation and posts Member CASH to Provider/Payout Clearing. Fees are explicit traceable postings rather than hidden balance adjustments.
- Bet/Win/Refund postings: Confirm first reserves stake, then consumes that reserve into a posting from the actual Member source bucket(s) to Betting Settlement. Winnings post from Betting Settlement to Member CASH or BONUS according to the accepted promotion/payout snapshot. Cancellation/refund restores the economic effect to the exact original source bucket composition through compensating postings; current balance composition is never used to reconstruct refund allocation.
- Reversal versus compensation: posted Ledger data is immutable. A reversible error in an open period creates an explicit reversal transaction referencing the original transaction. Corrections after downstream effects or after period close use business-semantic compensating transactions. Both patterns preserve an immutable audit/reference chain and once-only semantics.
- Negative position/debt: chargeback/recovery may create a negative net financial position or recovery receivable, but Wallet projection never exposes negative value as spendable CASH. While debt remains unresolved, available-for-bet and available-for-withdrawal are zero according to recovery policy.
- Period close: every Financial Transaction belongs to an effective/accounting period. A CLOSED period rejects mutation, backdating, and new postings into that period. Later corrections post in a current open period while referencing the originating transaction/period. Period close requires reconciliation/exception policy to pass or explicitly documented approved exceptions.

### Financial round 3 — confirmed

- Wallet projection consistency: Wallet is derived from authoritative Ledger postings plus active Reservations. If the projection differs from Ledger, Ledger remains authoritative and the projection is rebuilt or reconciled.
- Reconciliation invariants: reconciliation covers Ledger ↔ Wallet projection, Payments ↔ Provider, Betting/Settlement ↔ Ledger, and Promotion Entitlement ↔ BONUS/LOCKED postings. Every mismatch creates a durable Discrepancy with amount, source references, detected time, status, and resolution trail.
- Manual reconciliation: financial discrepancy resolution cannot directly edit balances. Any monetary resolution creates an approved Adjustment or Compensation transaction with reason, evidence, and audit linkage.
- Bonus accounting: Promotion grants, expiry, and BONUS-to-CASH conversion are separate balanced Ledger transactions linked to `promotionEntitlementId`; source provenance remains traceable across entitlements.
- Source-bucket allocation: mixed-bucket Bet funding is snapshotted at acceptance and that same allocation is reused for refund, settlement, turnover, and correction instead of being recomputed from the current Wallet.

### Financial round 4 — accounting-period cadence change request approved

- Accounting Period cadence for v1 is **monthly**.
- This decision changes only the cadence. It does not yet define the accounting timezone, exact month-boundary instant, period creation/ownership, overlap/gap enforcement, bootstrap/backfill treatment for existing Financial Transactions, period close metadata/workflow, or reconciliation-exception control semantics.
- Implementation must not infer those remaining controls from the monthly cadence decision alone.

## Answer

Lottify v1 uses a balanced operational double-entry subledger as the financial source of truth. Wallet values are derived from immutable Ledger postings plus active Reservations; no other domain owns an authoritative mutable balance.

1. Member value is separated into `CASH`, `BONUS`, and `LOCKED` subaccounts; bucket movement is a balanced Financial Transaction.
2. Reservations are durable holds, not posted ownership transfers. Reserve, release, and consume are idempotent, concurrency-safe, and final consumption is atomic with the resulting Ledger posting.
3. Every financial effect has immutable business/correlation/idempotency identity, domain references, currency, postings, timestamps, and correction linkage.
4. THB v1 posts integer satang; intermediate calculations use exact decimal/fixed precision and one versioned rounding rule at the posting boundary.
5. Deposit, Withdrawal, Bet, Win, Refund, Bonus, fee, Adjustment, Chargeback, and recovery effects use explicit traceable double-entry postings rather than hidden balance changes.
6. Refund and correction preserve the accepted source-bucket allocation. Posted history is never edited: open-period mistakes use reversals; later or closed-period corrections use compensating transactions.
7. Debt/recovery may create a negative net position, but spendable betting/withdrawal availability is zero until policy resolves it.
8. Accounting periods use a monthly cadence in v1. Closed periods cannot be backdated or mutated; later corrections post in a current open period and reference the originating transaction/period. The remaining timezone, ownership, boundary, backfill, and close-control semantics require their own approved decisions before implementation.
9. Wallet is a projection of Ledger + Reservations. On disagreement, Ledger is authoritative and the projection is rebuilt/reconciled.
10. Reconciliation covers Ledger/Wallet, Payments/Provider, Betting-Settlement/Ledger, and Promotion Entitlement/bonus postings. Mismatches become durable auditable Discrepancies.
11. Manual discrepancy resolution that changes money creates an approved Adjustment/Compensation transaction with reason, evidence, and audit; balances are not edited directly.
12. Promotion grants, expiry, and BONUS→CASH conversion remain separate transactions tied to the originating Promotion Entitlement.

These invariants make every financial outcome reproducible from immutable transactions, reservations, configuration snapshots, and linked business identities.

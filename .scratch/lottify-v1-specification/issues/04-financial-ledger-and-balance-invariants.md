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

### Financial round 4 — accounting-period cadence change request superseded

- The earlier monthly-only Accounting Period cadence decision was approved and subsequently superseded by Financial round 5.

### Financial round 5 — accounting-period modes change request approved

- Lottify v1 supports two Accounting Period modes: **Automatic weekly** and **Custom**.
- The authoritative v1 accounting timezone is `Asia/Bangkok`; Accounting Periods do not inherit Lottery Product timezones.
- Wallet & Ledger owns Accounting Period creation/lifecycle and authoritative period assignment. Admin/Approval governs sensitive administrative actions but does not own the financial aggregate.
- Automatic weekly is the default mode. Custom periods are governed overrides for specific ranges rather than an unconstrained parallel period stream.
- `ADMIN` and `SUPER_ADMIN` may initiate a Custom-period change. `ADMIN` activation requires a different authorized approver; `SUPER_ADMIN` may self-approve Custom activation. `AUDITOR` is read-only. The self-approval exception is limited to Custom activation; period close remains maker-checker.
- Automatic weekly means the system creates periods on a weekly cadence. The exact week-start boundary remains unresolved.
- Custom means an authorized Admin can define explicit period start/end boundaries. Overlap/gap behavior and the exact API/Admin interaction contract remain unresolved.
- Every Financial Transaction must still belong to exactly one authoritative Accounting Period; CLOSED-period and correction invariants remain unchanged.
- Implementation must not infer the remaining boundary, overlap/gap, backfill, close-control, or concurrency semantics from these decisions alone.

### Financial round 6 — accounting-period boundary and coverage controls approved

- Automatic weekly Accounting Periods use half-open `[start, end)` ranges from Monday `00:00` to the following Monday `00:00` in `Asia/Bangkok`.
- Custom Accounting Periods choose explicit start/end calendar dates; boundaries are normalized to `00:00` in `Asia/Bangkok` and use the same half-open range semantics.
- Effective Accounting Periods cannot overlap and cannot leave a gap across time in which Financial Transactions are permitted. Every permitted Financial Transaction instant must resolve to exactly one authoritative Accounting Period.
- Once an Accounting Period is OPEN, or any Financial Transaction has been assigned to it, its effective start/end boundaries are immutable. Existing Financial Transactions are never reassigned by editing period boundaries.

### Financial round 7 — accounting-period identity, finality and concurrency controls approved

- Every Accounting Period has an opaque immutable `AccountingPeriodId`; dates, mode, and labels are attributes rather than identity.
- A Custom request cannot activate retroactively if approval completes at or after its requested start boundary. It must expire/reject and be resubmitted with a future start if still required; dates are never silently shifted.
- Period resolution from server-authoritative `postedAt`, OPEN/acceptance validation, and resulting Ledger posting execute within one financial consistency boundary. Exact boundary instants resolve to the succeeding half-open period, without relying on a cron race.
- `CLOSED` is terminal and cannot be reopened. Corrections after close use current-OPEN-period Adjustment/Compensation with linkage to originating transaction/period.
- Close evidence is immutable and includes at least `closedAt`, maker-checker Approval reference, reconciliation run/checkpoint references, accepted-exception references when present, and actor/Audit Record linkage.
- Custom Admin flow is date selection, reason, replacement preview, submit, approve, then `SCHEDULED`; `ADMIN` requires a different authorized approver while `SUPER_ADMIN` may self-approve activation. Raw recurrence/rule configuration is not exposed and OPEN/CLOSING/CLOSED boundaries are not editable.

### Financial round 8 — accounting-period assignment, lifecycle, close and bootstrap controls approved

- Accounting Period assignment uses the server-authoritative `postedAt` instant. `effectiveAt` remains historical/economic context and cannot be used to backdate a new posting into a CLOSED period.
- An approved Custom period override may replace only future generated weekly coverage. Replacement is atomic and surrounding future weekly coverage is split/rebuilt as necessary so the resulting effective schedule still has neither overlap nor gap. OPEN or transaction-referenced periods cannot be overridden.
- The canonical lifecycle is `DRAFT -> PENDING_APPROVAL -> SCHEDULED -> OPEN -> CLOSING -> CLOSED`. Automatic weekly periods may be created directly as SCHEDULED; Custom periods traverse the governed draft/approval path before scheduling.
- At an end boundary, the succeeding period opens immediately while the preceding period may remain CLOSING for reconciliation. Financial posting availability does not wait for the old period to become CLOSED.
- `CLOSING -> CLOSED` requires the applicable reconciliation evidence, no unresolved blocking discrepancy unless explicitly accepted through an approved exception with evidence, and maker-checker close approval. Close evidence is immutable.
- Existing Financial Transactions are bootstrapped into historical weekly periods from their `postedAt` instants using the approved Monday `00:00` / `Asia/Bangkok` boundaries. Historical periods become CLOSED only after backfill verification; existing amounts and postings are not rewritten.

### Financial round 9 — accounting-period final operational controls approved

- Custom activation approval is role-sensitive: `ADMIN` cannot self-approve and requires a different authorized approver; `SUPER_ADMIN` may self-approve Custom activation. The separately approved `CLOSING -> CLOSED` transition remains maker-checker.
- Before OPEN, `DRAFT` may be cancelled by its creator, `PENDING_APPROVAL` may be withdrawn by its creator, and cancelling a `SCHEDULED` Custom period requires governed approval plus atomic restoration of the Automatic weekly coverage it replaced. A never-opened period/request may terminate as `CANCELLED`; after OPEN, cancellation and boundary editing are forbidden.
- Automatic weekly generation guarantees at least the current and next period. Additional future periods may be pre-generated, but scheduler success is not a correctness dependency: if the required next period is absent at a boundary, the posting path synchronously and transactionally establishes the correct authoritative period before accepting the Ledger posting.
- `AccountingPeriod` is the Admin/API resource. Mutation is command-oriented through `create-custom`, `submit`, `approve`, `cancel`, and `close`; generic boundary/lifecycle PATCH is forbidden. Exact route/DTO encoding belongs to the specification layer.

## Answer

Lottify v1 uses a balanced operational double-entry subledger as the financial source of truth. Wallet values are derived from immutable Ledger postings plus active Reservations; no other domain owns an authoritative mutable balance.

1. Member value is separated into `CASH`, `BONUS`, and `LOCKED` subaccounts; bucket movement is a balanced Financial Transaction.
2. Reservations are durable holds, not posted ownership transfers. Reserve, release, and consume are idempotent, concurrency-safe, and final consumption is atomic with the resulting Ledger posting.
3. Every financial effect has immutable business/correlation/idempotency identity, domain references, currency, postings, timestamps, and correction linkage.
4. THB v1 posts integer satang; intermediate calculations use exact decimal/fixed precision and one versioned rounding rule at the posting boundary.
5. Deposit, Withdrawal, Bet, Win, Refund, Bonus, fee, Adjustment, Chargeback, and recovery effects use explicit traceable double-entry postings rather than hidden balance changes.
6. Refund and correction preserve the accepted source-bucket allocation. Posted history is never edited: open-period mistakes use reversals; later or closed-period corrections use compensating transactions.
7. Debt/recovery may create a negative net position, but spendable betting/withdrawal availability is zero until policy resolves it.
8. Accounting periods use `Asia/Bangkok` and are owned by Wallet & Ledger. v1 uses Automatic weekly as the default plus governed future Custom overrides. `ADMIN` requires a different approver for Custom activation; `SUPER_ADMIN` may self-approve activation, while period close remains maker-checker. Automatic weeks run Monday `00:00` to Monday `00:00`; Custom boundaries are explicit calendar dates normalized to `00:00`; both use half-open `[start,end)` ranges with no overlap or posting-time gaps. Assignment is authoritative from `postedAt`; lifecycle is `DRAFT -> PENDING_APPROVAL -> SCHEDULED -> OPEN -> CLOSING -> CLOSED` with `CANCELLED` available only before OPEN; successor opening does not wait for predecessor close. Boundaries become immutable once OPEN/referenced, CLOSED is terminal, historical bootstrap uses `postedAt` without rewriting money, and current/next period availability cannot depend solely on the scheduler. Mutations are explicit AccountingPeriod commands rather than generic PATCH. Later corrections post in the current OPEN period and reference the originating transaction/period.
9. Wallet is a projection of Ledger + Reservations. On disagreement, Ledger is authoritative and the projection is rebuilt/reconciled.
10. Reconciliation covers Ledger/Wallet, Payments/Provider, Betting-Settlement/Ledger, and Promotion Entitlement/bonus postings. Mismatches become durable auditable Discrepancies.
11. Manual discrepancy resolution that changes money creates an approved Adjustment/Compensation transaction with reason, evidence, and audit; balances are not edited directly.
12. Promotion grants, expiry, and BONUS→CASH conversion remain separate transactions tied to the originating Promotion Entitlement.

These invariants make every financial outcome reproducible from immutable transactions, reservations, configuration snapshots, and linked business identities.

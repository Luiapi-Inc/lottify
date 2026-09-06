# Lock reporting, reconciliation and export semantics

Type: grilling
Status: resolved
Blocked by: 04, 09

## Question

What are the canonical definitions, source-of-truth lineage, freshness expectations, dimensions, period rules, discrepancy states, and export controls for turnover, GGR, payout, deposits, withdrawals, liabilities, Ledger/Wallet/Provider/Settlement reconciliation, audit reporting, and large asynchronous exports?

## Comments

### Reporting round 1 — confirmed

- Reporting source of truth: Reporting owns rebuildable read models/projections only and never becomes an authoritative transactional source. Money derives from Ledger; reservation/availability derives from Ledger plus Reservations; betting/turnover facts from Betting; result/payout facts from Result & Settlement; deposit/withdrawal workflow facts from Payments; provider-observed facts from retained provider evidence; audit facts from immutable Audit records. Every reportable fact retains source references sufficient for lineage, drill-down, and projection rebuild.
- Canonical betting metrics: `Bet Turnover` is stake from confirmed eligible Bet Lines under the report's declared basis, excluding cancelled/refunded stake as defined by that basis. `Gross Winnings/Payout` is finalized settlement winnings. `GGR` is finalized turnover minus finalized winnings/payout before promotion bonus/cashback or operating cost unless an explicitly named adjusted metric states otherwise. Corrections use linked compensating adjustments rather than rewriting historical facts, and metric definition/version is part of the report contract.
- Deposit/withdrawal reporting: Deposit reporting distinguishes initiated, provider-verified, Ledger-credited, and reversed/chargeback states. Withdrawal reporting distinguishes requested, reserved, approved, payout-confirmed, Ledger-finalized, cancelled, failed, and reconciling states. Financial “completed/successful” amounts are based on the authoritative Ledger-completed state rather than provider acceptance or request creation.
- Liability reporting: liabilities are separated into current confirmed stake exposure, projected maximum payout liability, unsettled winning liability, reserved Withdrawal liability, and outstanding BONUS/Entitlement exposure. Operational liability can drill down System → Product → Draw → Bet Type → number/risk bucket, and time-specific views are reproducible from accepted Bet facts plus the governing configuration snapshots.
- Period/time semantics: Ledger/accounting reports use posting instant and accounting period; Product/Draw operational reporting uses the Product timezone; global/Admin aggregates always declare their reporting timezone. Date ranges use half-open `[from, to)` boundaries. Closed-period facts are not rewritten: later corrections appear as current-period adjustments linked to the original transaction/period. Every report/export exposes generation time and data-freshness/as-of time.

### Reporting round 2 — confirmed

- Reconciliation model: reconciliation is explicit per authoritative pair: Ledger ↔ Wallet projection, Payments ↔ Provider, Betting/Settlement ↔ Ledger, and Promotion Entitlement ↔ Ledger. Every reconciliation run records `asOf`, source ranges/checkpoints, counts, totals, and a result summary so the exact inspected data window is provable and replayable.
- Discrepancy lifecycle: durable discrepancies follow `DETECTED → INVESTIGATING → RESOLUTION_PENDING → RESOLVED`, with governed `FALSE_POSITIVE` or `ACCEPTED_EXCEPTION` outcomes when supported by reason/evidence. Each discrepancy stores expected/observed facts, amount difference when applicable, source references, severity, detection time/age, owner, and resolution evidence. Any monetary resolution invokes the approved Adjustment/Compensation workflow rather than merely marking the discrepancy resolved.
- Freshness/completeness semantics: every report/read model exposes `dataAsOf`, projection lag, and an explicit completeness state such as `CURRENT`, `LAGGING`, `PARTIAL`, or `REBUILDING`. Financial and reconciliation outputs that are partial or lagging cannot be presented as definitive without a clear warning/state indicator.
- Standard dimensions: canonical dimensions include time/accounting period, Product, Draw, Bet Type, Member, transaction type, CASH/BONUS bucket, provider, payment method, Promotion/Campaign, and status/outcome. Each report allowlists only semantically valid dimensions and filters; arbitrary persistence-schema joins/query builders are not exposed.
- Audit/export controls: large exports are asynchronous Jobs/Operations. An export request snapshots filters, selected columns, timezone, masking policy, requester, and definition/version. Sensitive values are masked by default; unmasked export requires explicit permission, reason, and audit. Generated artifacts use controlled/expiring access and include `generatedAt`, `dataAsOf`, metric/definition version, and effective filters. Transport/job retries preserve the same logical export identity unless the user intentionally creates a new export request.

### Reporting round 3 — accounting-period cadence change request superseded

- The earlier monthly-only reporting cadence decision was approved and subsequently superseded by Reporting round 4.

### Reporting round 4 — accounting-period modes change request approved

- Ledger/accounting reporting consumes authoritative Accounting Periods created under either **Automatic weekly** or **Custom** mode.
- Reporting must use the authoritative period identity persisted by Wallet & Ledger rather than deriving weekly/custom boundaries independently.
- This decision does not select the accounting timezone, exact automatic-week boundary, Custom-period validation, or overlap/gap semantics.

### Reporting round 5 — accounting-period boundary semantics approved

- Accounting Period ranges are authoritative half-open `[start, end)` windows in `Asia/Bangkok`.
- Automatic weekly periods run Monday `00:00` to the following Monday `00:00`; Custom periods use explicit calendar-date boundaries normalized to `00:00`.
- Reporting must not synthesize overlaps or gaps independently: it groups by the authoritative Accounting Period identity, under the invariant that every permitted Financial Transaction instant resolves to exactly one period.
- Once an Accounting Period is OPEN or referenced by a Financial Transaction, reporting treats its boundaries as immutable historical facts.

### Reporting round 6 — accounting-period identity and close evidence approved

- Reports group by immutable authoritative `AccountingPeriodId`; period dates/labels are descriptive attributes and never reconstructed identities.
- `postedAt` is the accounting-period assignment authority. `effectiveAt` remains available as a business/economic dimension but cannot rewrite closed-period membership.
- `CLOSED` is terminal. Later corrections appear in the current OPEN period and retain linkage to the originating transaction/period.
- Close reporting/audit evidence includes the immutable close instant, approval reference, reconciliation/checkpoint references, accepted exceptions when any, and actor/Audit Record linkage.

### Reporting round 7 — accounting-period assignment and historical bootstrap semantics approved

- Financial accounting attribution uses the authoritative Accounting Period selected from the transaction's server-authoritative `postedAt`; `effectiveAt` does not reclassify a posting into a historical period.
- At a boundary, reporting may observe the preceding period in CLOSING while the succeeding period is already OPEN; these states are not an accounting-coverage gap.
- Historical bootstrap groups existing Financial Transactions into verified historical weekly periods from `postedAt`, after which those historical periods are CLOSED without rewriting the original monetary postings.
- Close reporting must retain immutable reconciliation, approved-exception, and close-approval evidence associated with the authoritative period.
- A never-opened Custom period/request may end as `CANCELLED`; Reporting must not treat CANCELLED coverage as an authoritative accounting window for Financial Transactions.

## Answer

Lottify v1 reporting is a rebuildable, lineage-preserving read model over authoritative domain facts, with explicit metric definitions, time semantics, reconciliation evidence, freshness state, and governed export controls.

1. Reporting projections never become transactional sources of truth; each fact links back to its authoritative Ledger, Betting, Settlement, Payments, provider-evidence, Promotion, or Audit source.
2. Turnover, payout/winnings, GGR, promotion cost, and liabilities use canonical versioned definitions so reports with the same metric name cannot silently calculate different semantics.
3. Deposit and Withdrawal reports distinguish workflow stages, while financial completion is based on authoritative Ledger completion rather than provider acceptance alone.
4. Liability reporting separates confirmed stake exposure, projected maximum payout, unsettled winnings, reserved Withdrawals, and outstanding BONUS/Entitlement exposure with reproducible operational drill-down.
5. Accounting uses the authoritative `postedAt` posting instant/accounting period with Automatic weekly and Custom v1 period modes in `Asia/Bangkok`. Automatic weeks run Monday `00:00` to Monday `00:00`; Custom periods use explicit calendar-date boundaries normalized to `00:00`; all period ranges are half-open `[start,end)`. Product operations still use Product timezone and aggregate reports declare timezone. Closed-period corrections are current-period adjustments linked to original facts, and Reporting consumes the authoritative period identity rather than deriving competing boundaries.
6. Reconciliation runs are explicit for Ledger/Wallet, Payments/Provider, Betting-Settlement/Ledger, and Promotion/Ledger and retain `asOf`, checkpoints/ranges, counts, totals, and result evidence.
7. Discrepancies are durable governed objects with lifecycle, severity, expected/observed facts, ownership, evidence, and monetary-resolution linkage to Adjustment/Compensation workflows.
8. Every report exposes `dataAsOf`, projection lag, and completeness state; partial/lagging financial outputs cannot masquerade as definitive data.
9. Reporting dimensions and filters are semantic allowlists rather than arbitrary persistence-schema joins.
10. Large exports are asynchronous, permissioned, masked by default, audited, versioned, access-controlled/expiring, and reproducible from snapshotted filters, columns, timezone, and definition metadata.

These rules make reporting, reconciliation, audit analysis, and exports traceable, reproducible, freshness-aware, and incapable of overriding authoritative financial/business state.

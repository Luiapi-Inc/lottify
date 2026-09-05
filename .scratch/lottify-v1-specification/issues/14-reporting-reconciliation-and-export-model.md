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

### Reporting round 3 — accounting-period cadence change request approved

- Ledger/accounting reporting groups authoritative accounting periods on the same **monthly v1 cadence** approved by the financial invariant contract.
- This does not select the accounting timezone or exact monthly boundary instant; reporting must consume the authoritative Accounting Period identity once those remaining financial controls are approved and implemented rather than deriving a competing period definition.

## Answer

Lottify v1 reporting is a rebuildable, lineage-preserving read model over authoritative domain facts, with explicit metric definitions, time semantics, reconciliation evidence, freshness state, and governed export controls.

1. Reporting projections never become transactional sources of truth; each fact links back to its authoritative Ledger, Betting, Settlement, Payments, provider-evidence, Promotion, or Audit source.
2. Turnover, payout/winnings, GGR, promotion cost, and liabilities use canonical versioned definitions so reports with the same metric name cannot silently calculate different semantics.
3. Deposit and Withdrawal reports distinguish workflow stages, while financial completion is based on authoritative Ledger completion rather than provider acceptance alone.
4. Liability reporting separates confirmed stake exposure, projected maximum payout, unsettled winnings, reserved Withdrawals, and outstanding BONUS/Entitlement exposure with reproducible operational drill-down.
5. Accounting uses posting instant/accounting period with a monthly v1 Accounting Period cadence. Product operations use Product timezone, aggregate reports declare timezone, ranges are half-open `[from,to)`, and closed-period corrections are current-period adjustments linked to original facts. Reporting does not independently define the still-unresolved accounting timezone/boundary control.
6. Reconciliation runs are explicit for Ledger/Wallet, Payments/Provider, Betting-Settlement/Ledger, and Promotion/Ledger and retain `asOf`, checkpoints/ranges, counts, totals, and result evidence.
7. Discrepancies are durable governed objects with lifecycle, severity, expected/observed facts, ownership, evidence, and monetary-resolution linkage to Adjustment/Compensation workflows.
8. Every report exposes `dataAsOf`, projection lag, and completeness state; partial/lagging financial outputs cannot masquerade as definitive data.
9. Reporting dimensions and filters are semantic allowlists rather than arbitrary persistence-schema joins.
10. Large exports are asynchronous, permissioned, masked by default, audited, versioned, access-controlled/expiring, and reproducible from snapshotted filters, columns, timezone, and definition metadata.

These rules make reporting, reconciliation, audit analysis, and exports traceable, reproducible, freshness-aware, and incapable of overriding authoritative financial/business state.

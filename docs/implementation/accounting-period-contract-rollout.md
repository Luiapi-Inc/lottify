# Accounting Period contract rollout and recovery

This record implements the approved `expand -> backfill -> verify -> contract` sequence for the
Financial Transaction Accounting Period linkage.

## Compatibility window

- Expand keeps `financial_transactions.accounting_period_id` nullable while the application version
  introduced before contract already writes an authoritative Accounting Period on every financial
  posting path.
- Historical backfill and verification must complete before contract. A nullable row or a reference
  whose `posted_at` falls outside its referenced period blocks the contract migration.
- During the additive window, application rollback remains schema-compatible because the database
  still accepts the pre-contract shape. Only application versions that already populate the
  Accounting Period reference are eligible to cross the contract boundary.
- Contract sets `accounting_period_id` `NOT NULL` and adds effective-period overlap protection. The
  restrictive foreign key and reporting index from expand remain in place.

## Recovery boundary

Before contract, rollback may return to the verified pre-contract writer while the additive schema
remains compatible. After contract, do not drop the mandatory linkage, remove coverage protection,
or rewrite historical financial data to recover an incompatible application. Keep or restore traffic
to a version that writes the authoritative reference and use a reviewed forward migration/application
fix. Production traffic switching and migration execution remain subject to the separate release
GO/NO-GO and blue/green controls.

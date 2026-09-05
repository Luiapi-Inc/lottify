# Change Request: v1 Accounting Period cadence is monthly

Status: approved by product owner on 2026-09-05

## Change

Lottify v1 Accounting Periods use a **monthly cadence**.

This resolves the previously open cadence decision only.

## Unchanged financial invariants

- Every Financial Transaction belongs to an authoritative Accounting Period.
- A CLOSED period rejects mutation, backdating, and new postings into that period.
- Later corrections post in a current OPEN period and reference the originating transaction/period.
- Period close remains subject to reconciliation and approved-exception controls.

## Still unresolved

- Accounting timezone and exact monthly boundary instant.
- Period creation/ownership and lifecycle controller.
- Overlap/gap enforcement.
- Bootstrap/backfill treatment for existing Financial Transactions.
- Period identity and close metadata.
- Concrete reconciliation/approved-exception close workflow.
- API/Admin control surfaces, if any.

No schema, migration, API, or Admin contract is authorized by this cadence-only decision until those remaining source-of-truth controls are approved.

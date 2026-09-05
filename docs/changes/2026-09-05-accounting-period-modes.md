# Change Request: v1 Accounting Period modes

Status: approved by product owner on 2026-09-05

Supersedes: `2026-09-05-monthly-accounting-period-cadence.md`

## Change

Lottify v1 Accounting Periods support two approved modes:

1. **Automatic weekly** — the system creates Accounting Periods on a weekly cadence.
2. **Custom** — an authorized Admin can define an Accounting Period's start and end boundaries explicitly.

The prior monthly-only cadence decision is superseded.

## Unchanged financial invariants

- Every Financial Transaction belongs to one authoritative Accounting Period.
- A CLOSED period rejects mutation, backdating, and new postings into that period.
- Later corrections post in a current OPEN period and reference the originating transaction/period.
- Period close remains subject to reconciliation and approved-exception controls.
- Reporting consumes the authoritative Accounting Period identity and does not derive a competing period definition.

## Still unresolved

- Accounting timezone.
- Exact automatic-week boundary, including which weekday/time starts a week.
- Period creation/ownership and lifecycle controller beyond the approved Admin ability to define Custom boundaries.
- Authorization/approval policy for creating or changing Custom periods.
- Overlap/gap enforcement across Automatic weekly and Custom periods.
- Bootstrap/backfill treatment for existing Financial Transactions.
- Period identity and close metadata.
- Concrete reconciliation/approved-exception close workflow.
- Exact API/Admin interaction contract and validation behavior.

No schema, migration, API, or Admin implementation is authorized by this mode decision alone until the remaining persistence/control semantics required for deterministic period assignment and close enforcement are approved.

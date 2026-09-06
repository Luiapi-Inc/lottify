# Change Request: v1 Accounting Period modes

Status: approved by product owner on 2026-09-05

Supersedes: `2026-09-05-monthly-accounting-period-cadence.md`

## Change

Lottify v1 Accounting Periods support two approved modes:

1. **Automatic weekly** — the system creates Accounting Periods on a weekly cadence.
2. **Custom** — an authorized Admin can define an Accounting Period's start and end boundaries explicitly.

The prior monthly-only cadence decision is superseded.

## Approved control decisions

- **Accounting timezone:** `Asia/Bangkok` is the authoritative v1 accounting timezone. Accounting periods do not inherit Lottery Product timezones.
- **Ownership:** Wallet & Ledger owns Accounting Period creation/lifecycle and authoritative period assignment. Admin/Approval governs sensitive administrative actions but does not own the financial aggregate.
- **Mode relationship:** Automatic weekly is the default. Custom periods are governed overrides for specific ranges rather than a separate unconstrained period stream.
- **Custom authorization:** `ADMIN` and `SUPER_ADMIN` may initiate a Custom-period change. `ADMIN` activation requires approval by a different authorized actor; `SUPER_ADMIN` may self-approve the Custom activation. `AUDITOR` is read-only. This self-approval exception applies to Custom activation only; close approval remains maker-checker as separately approved.
- **Automatic-week boundary:** Automatic weekly periods use half-open `[start, end)` ranges from Monday `00:00` to the following Monday `00:00` in `Asia/Bangkok`.
- **Custom boundary precision:** Custom periods choose explicit start and end calendar dates; each boundary is `00:00` in `Asia/Bangkok` and the effective range is half-open `[start, end)`.
- **Coverage invariant:** Effective Accounting Periods may not overlap and may not leave a gap across time in which Financial Transactions are permitted. Any permitted posting instant must resolve to exactly one authoritative Accounting Period.
- **Boundary immutability:** Once an Accounting Period is OPEN, or once any Financial Transaction has been assigned to it, its effective start/end boundaries are immutable. Historical transactions are never reassigned by editing a period boundary.
- **Assignment authority:** Accounting Period assignment is based on the server-authoritative `postedAt` instant. `effectiveAt` records business/economic effect time but cannot move a posting into a historical or CLOSED period.
- **Custom override replacement:** An approved Custom override replaces only future generated weekly coverage. The replacement is applied atomically and the surrounding future schedule is split/rebuilt as needed so effective coverage still has neither overlap nor gap. An OPEN period or a period already referenced by a Financial Transaction cannot be overridden.
- **Lifecycle:** The canonical v1 active lifecycle is `DRAFT -> PENDING_APPROVAL -> SCHEDULED -> OPEN -> CLOSING -> CLOSED`, with terminal `CANCELLED` available only before OPEN. Automatic weekly periods may enter as `SCHEDULED`; Custom periods use the governed draft/approval path before scheduling.
- **Boundary turnover:** At a period end boundary, the succeeding period becomes OPEN immediately even if the preceding period is still reconciling in CLOSING. Closing work never blocks current financial posting availability.
- **Close gate:** `CLOSING -> CLOSED` requires the required reconciliation evidence, no unresolved blocking discrepancy unless it is an explicitly approved exception with evidence, and governed maker-checker close approval. Close evidence is immutable.
- **Historical bootstrap:** Existing Financial Transactions are backfilled into generated historical weekly periods using `postedAt` and the approved Monday `00:00` / `Asia/Bangkok` boundaries. Historical periods are marked CLOSED only after backfill verification; existing monetary postings are not rewritten.
- **Period identity:** Every Accounting Period has an opaque immutable `AccountingPeriodId` as its canonical identity. Mode, start/end boundaries, and display labels are attributes and are not identity.
- **Late Custom approval:** A Custom-period request that reaches or passes its requested start boundary before approval completes cannot activate retroactively. It must expire or be rejected and, if still needed, be resubmitted with a future start boundary; the system does not silently shift dates.
- **Posting/boundary concurrency:** Resolving the authoritative Accounting Period from server `postedAt`, validating that the period accepts posting, and creating the Ledger posting must participate in one financial transaction boundary. At an exact boundary instant, half-open semantics assign the posting to the succeeding period; correctness must not depend on a cron transition racing successfully.
- **Closed-period finality:** `CLOSED` is terminal in v1 and cannot be reopened, including by `SUPER_ADMIN`. Later corrections use Adjustment/Compensation in the current OPEN period with linkage to the originating transaction/period.
- **Minimum close evidence:** Closing retains immutable `closedAt`, maker-checker Approval reference, reconciliation run/checkpoint references, accepted-exception references when present, and actor/Audit Record linkage.
- **Custom Admin flow:** The v1 Admin interaction is `select start/end dates -> enter reason -> preview weekly coverage replacement -> submit -> approve -> SCHEDULED`. For `ADMIN`, approve must be performed by a different authorized actor; `SUPER_ADMIN` may self-approve activation. Admins are not exposed to raw recurrence/rule configuration and cannot edit OPEN/CLOSING/CLOSED period boundaries.

## Unchanged financial invariants

- Every Financial Transaction belongs to one authoritative Accounting Period.
- A CLOSED period rejects mutation, backdating, and new postings into that period.
- Later corrections post in a current OPEN period and reference the originating transaction/period.
- Period close remains subject to reconciliation and approved-exception controls.
- Reporting consumes the authoritative Accounting Period identity and does not derive a competing period definition.

## Final approved controls

- **Custom activation approval:** `ADMIN` may not self-approve; a different authorized approver is required. `SUPER_ADMIN` may self-approve Custom activation. This exception does not weaken the separately approved maker-checker requirement for period close.
- **Pre-OPEN cancellation:** `DRAFT` may be cancelled immediately by its creator; `PENDING_APPROVAL` may be withdrawn by its creator; `SCHEDULED` cancellation requires governed approval and atomically restores the Automatic weekly coverage it replaced. After OPEN, cancellation or boundary editing is forbidden. A never-opened request/period may terminate as `CANCELLED`.
- **Automatic generation resilience:** the system must ensure at least the current and next Automatic weekly periods exist. It may pre-generate farther ahead for operations/UX. If the next required period is missing at a boundary, the financial posting path must synchronously and transactionally establish the correct authoritative period before accepting the Ledger posting; scheduler success is not a correctness prerequisite.
- **Admin command contract:** `AccountingPeriod` is the resource; mutations use explicit commands `create-custom`, `submit`, `approve`, `cancel`, and `close`. A generic boundary/lifecycle `PATCH` is not exposed. Exact HTTP route/DTO encoding is a specification concern, not an unresolved product semantic.

## Design disposition

The Accounting Period product/control frontier is resolved sufficiently for `/to-spec`. No schema, migration, API DTO, or Admin implementation is authorized by this decision document alone; those concrete contracts must be derived in the specification and acceptance criteria from the approved semantics above.

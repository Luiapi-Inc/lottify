# Reporting / reconciliation REST surface implementation status

Source of truth: GitHub Issue #53 and Wayfinder Tickets 10 (REST/OpenAPI resource model), 14
(reporting/reconciliation/export semantics), 16 (acceptance criteria and test traceability), 19
(implementation roadmap). This record does not redefine those requirements. It reports a local
implementation checkpoint, not milestone acceptance.

## Work package

The merged Reporting bounded context (Ledger ↔ Wallet reconciliation service and the
accounting-period financial report service) had durable models and services but no REST surface,
so the Admin control-plane's *Reconciliation* and *Audit / Reports* areas were unreachable. This
package exposes those existing read/reconciliation capabilities under `/api/v1/admin` without
recreating reconciliation logic, without inventing authoritative sources, and without any
financial or schema mutation.

## Implementation

| Surface | Path | Handler |
| --- | --- | --- |
| Reconciliation run list | `GET /api/v1/admin/reconciliation/runs` | `AdminReconciliationController.listRuns` |
| Reconciliation run detail | `GET /api/v1/admin/reconciliation/runs/{id}` | `AdminReconciliationController.getRun` |
| Discrepancy list | `GET /api/v1/admin/reconciliation/discrepancies` | `AdminReconciliationController.listDiscrepancies` |
| Discrepancy detail | `GET /api/v1/admin/reconciliation/discrepancies/{id}` | `AdminReconciliationController.getDiscrepancy` |
| Accounting-period financial report | `GET /api/v1/admin/reports/accounting-period-financial` | `AdminReportingController.accountingPeriodFinancial` |

- `src/contexts/reporting/reconciliation-inspection.service.ts` is the Reporting-owned read model
  over the durable reconciliation evidence the accepted reconciliation service persists
  (`asOf`, source ranges/checkpoints, inspected counts, totals, result summary, discrepancy
  facts/age/owner/resolution). Filters (member, currency, result, lifecycle status, severity,
  `[from, to)` on `asOf`/`detectedAt`) are explicit allowlists; ordering is
  `asOf|detectedAt desc, id desc` with keyset `cursor`/`limit` pagination.
- `src/contexts/reporting/accounting-period-financial-report.service.ts` gained
  `buildForRange` (explicit half-open `[from, to)`) and `buildForAccountingPeriod`
  (authoritative Accounting Period identity). Facts are selected by the accounting-period
  assignment authority (`postedAt`) and grouped by the stored `accountingPeriodId`; the report
  never derives competing boundaries. `build()` keeps its previous whole-snapshot behaviour.
- Freshness: every output carries `generatedAt`, `dataAsOf` (database clock inside one
  `RepeatableRead` snapshot), `projectionLagMs` (0: authoritative facts are read directly, no
  projection) and an explicit `completeness`. `CURRENT` = observable window fully covered by
  non-`CANCELLED` authoritative periods; `LAGGING` = the window extends past `dataAsOf`
  (`coverage.unobservedRange`); `PARTIAL` = observable spans without authoritative coverage
  (`coverage.uncoveredRanges`). `REBUILDING` is reserved for projection-backed outputs and is
  never returned by this authoritative read. Reports declare `reportingTimezone: "Asia/Bangkok"`.
- Authorization: `reconciliation.read` and `report.read` are new Admin capabilities, granted as
  read-only authority to `SUPER_ADMIN`, `ADMIN` and `AUDITOR`; every new route carries
  `RequireAdminCapabilities` and is evaluated by the existing server-side `AdminCapabilityGuard`.
- Errors: `src/contexts/reporting/reporting-rule-error.ts` plus `apps/api/src/reporting-error.mapper.ts`
  map to the shared `code` / `message` / `details` / `correlationId` contract
  (`VALIDATION_ERROR`, `NOT_FOUND`, `UNSUPPORTED_REPORTING_TIME_ZONE`, `EVIDENCE_MALFORMED`).
- OpenAPI is generated from explicit response classes: no Prisma model, table or repository type
  appears in the published contract, and money stays integer minor units rendered as strings.

## Traceability

| Requirement (Issue #53 / Ticket 14) | Implementation | Test |
| --- | --- | --- |
| Run list/detail with `asOf`, source ranges/checkpoints, counts, totals, result summary | `reconciliation-inspection.service.ts`, `AdminReconciliationController` | `tests/integration/reporting-rest.integration.spec.ts` — "lists and reads reconciliation runs…" |
| Discrepancy list/detail with expected/observed, amount difference, severity, age, owner, resolution evidence, lifecycle | same | same spec — "lists and reads discrepancies…", including a `RESOLVED` + `ACCEPTED_EXCEPTION` record |
| Financial report exposes period, timezone, half-open range, `generatedAt`/`dataAsOf`, completeness | `accounting-period-financial-report.service.ts`, `AdminReportingController` | same spec — "reports authoritative accounting-period financials as CURRENT…", "resolves the report window from the authoritative Accounting Period identity" |
| Partial/lagging outputs explicitly flagged, never definitive | completeness + coverage derivation | same spec — "flags a window no authoritative Accounting Period covers as PARTIAL", "flags a window beyond the data snapshot as LAGGING…" |
| No invented authoritative source; no persistence joins/arbitrary query builders | read model selects only Reporting-owned reconciliation evidence; report groups by authoritative period identity; allowlisted filters | `tests/contract/reporting-api.contract.spec.ts` (no mutation verbs, no persistence tokens) + source review |
| Admin capability guard on every endpoint, canonical error codes, OpenAPI without Prisma leakage | `RequireAdminCapabilities` on all five routes; `reporting-error.mapper.ts`; explicit DTOs | contract spec — capability metadata, bearer security, error/enum/money shape, leakage assertions |
| Deterministic integration tests (populated, empty, lagging/partial, denial) + typecheck/build green | — | `tests/integration/reporting-rest.integration.spec.ts` (9 scenarios), contract spec (7 scenarios) |

## Decisions and explicit non-goals

- No on-demand reconciliation run trigger. It is optional under the issue, and validating the
  requested member as a real reconciliation target requires a new Wallet & Ledger
  target-existence port; the surface would otherwise persist bogus `MATCHED` evidence for an
  arbitrary member id. Deferred to a follow-up slice rather than invented here.
- No discrepancy resolution commands (assign owner, resolve, accept exception). The Adjustment /
  Compensation workflow exists elsewhere and is out of scope; this slice exposes the lifecycle
  fields read-only, so the governed resolution writer remains a separate work package.
- Masking policy, asynchronous exports/jobs and frontend binding remain out of scope
  (`apps/admin-web` navigation entries were deliberately left untouched).

## Local verification

- `pnpm check` (prisma generate → OpenAPI generate → typecheck → vitest → build): exit 0,
  376 passed / 184 skipped (integration gated off by default).
- `RUN_INTEGRATION_TESTS=1 pnpm test` (full integration-enabled suite against the shared
  development Postgres): **exit 0, 552 passed / 8 skipped / 0 failed** (the 8 skips are the
  dedicated suites gated by their own env flags).
- `tests/integration/reporting-rest.integration.spec.ts`: 9/9 with `RUN_INTEGRATION_TESTS=1`,
  including denial (401), populated run/discrepancy evidence, cursor paging, `CURRENT` /
  `PARTIAL` / `LAGGING`, authoritative-period scope and the canonical error codes.
- `tests/contract/reporting-api.contract.spec.ts`: 7/7 without a database.
- The fixture cleans up after itself: no reconciliation runs, accounts, 2019 fixtures or
  Accounting Periods remain in the shared database after the run.
- `tests/unit/admin-auth-security.spec.ts` and `tests/integration/admin-auth.integration.spec.ts`
  were updated because they deliberately lock the role → capability mapping.

## Observations for the Lead

1. **Shared-development-DB hazard (pre-existing, not caused by this change).** The currently
   `OPEN` Automatic week is transitioned to `CLOSING` by any financial posting whose clock
   instant passes that week (`ensureAutomaticAccountingPeriodCoverage`). Running the gated
   `tests/integration/accounting-period-reporting.integration.spec.ts`, which posts with a fixed
   future clock (2033), therefore closes the current week of `lottify_dev`; every subsequent
   suite that posts at "now" then fails with `Accounting Period is not postable for
   authoritative postedAt`. That is what produced an otherwise inexplicable 59-failure
   integration run mid-task. The collateral state was repaired (current week restored to `OPEN`)
   and the whole integration-enabled suite then passed cleanly. CI, which recreates a fresh
   database, is unaffected; local runs share one mutable calendar.
2. **Pre-existing orphaned rows.** `lottify_dev` contains two `financial_transactions` whose
   `accounting_period_id` no longer exists (fixture marker `accounting-period-close-test`,
   `posted_at` 2199). `AccountingPeriodFinancialReportService` rejects a transaction whose
   Accounting Period relation is inconsistent, so the gated
   `tests/integration/accounting-period-reporting.integration.spec.ts` fails with
   `Cannot read properties of null (reading 'id')`. This reproduces identically on the
   unmodified service (verified by stashing the change), so it is database drift rather than a
   regression from this work package. The spec is not part of the default or
   integration-enabled suites. Recreating `lottify_dev` from `prisma migrate deploy` per the
   shared-DB drift policy would clear it.

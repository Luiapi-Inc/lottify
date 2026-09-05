-- Enable governed Custom Accounting Period proposals without making proposal
-- boundaries participate in the effective-calendar uniqueness rule.
--
-- Effective coverage remains protected by the partial GiST exclusion
-- constraint introduced by the contract migration. DRAFT/PENDING_APPROVAL/
-- CANCELLED rows are proposals and intentionally may share boundaries with
-- future Automatic coverage.

BEGIN;

WITH calendar_lock AS MATERIALIZED (
  SELECT pg_advisory_xact_lock(19002026, 1)
)
SELECT 1::int AS "locked"
FROM calendar_lock;

ALTER TABLE "accounting_periods"
ADD COLUMN "reason" TEXT,
ADD COLUMN "created_by_admin_id" UUID;

DROP INDEX IF EXISTS "accounting_periods_effective_start_effective_end_key";

CREATE UNIQUE INDEX "accounting_periods_effective_automatic_nominal_bounds_key"
ON "accounting_periods"("effective_start", "effective_end")
WHERE "mode" = 'AUTOMATIC_WEEKLY'
  AND "generation_kind" = 'NOMINAL_WEEK'
  AND "state" IN ('SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED');

CREATE INDEX "accounting_periods_created_by_admin_id_created_at_idx"
ON "accounting_periods"("created_by_admin_id", "created_at");

ALTER TABLE "accounting_periods"
ADD CONSTRAINT "accounting_periods_created_by_admin_id_fkey"
FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

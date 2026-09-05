-- SCHEDULED Custom cancellation regenerates Automatic coverage with new identities.
-- The original expand migration created a global range uniqueness index that would
-- otherwise prevent a regenerated nominal week from reusing the same boundaries as
-- its CANCELLED predecessor. Effective overlap is already protected by the partial
-- GiST exclusion constraint for SCHEDULED/OPEN/CLOSING/CLOSED rows.
DROP INDEX IF EXISTS "accounting_periods_effective_start_effective_end_key";

ALTER TABLE "accounting_periods"
ADD COLUMN "cancellation_requested_by_admin_id" UUID,
ADD COLUMN "cancellation_reason" TEXT,
ADD COLUMN "cancellation_requested_at" TIMESTAMP(3),
ADD CONSTRAINT "accounting_periods_cancellation_request_metadata_check"
CHECK (
  (
    "cancellation_requested_by_admin_id" IS NULL
    AND "cancellation_reason" IS NULL
    AND "cancellation_requested_at" IS NULL
  )
  OR
  (
    "cancellation_requested_by_admin_id" IS NOT NULL
    AND "cancellation_reason" IS NOT NULL
    AND "cancellation_requested_at" IS NOT NULL
  )
);

ALTER TABLE "accounting_periods"
ADD CONSTRAINT "accounting_periods_cancellation_requested_by_admin_id_fkey"
FOREIGN KEY ("cancellation_requested_by_admin_id") REFERENCES "admin_users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "accounting_periods_cancellation_requested_by_admin_id_cancellation_requested_at_idx"
ON "accounting_periods"("cancellation_requested_by_admin_id", "cancellation_requested_at");

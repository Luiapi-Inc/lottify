-- Preserve a direct, immutable Accounting Period -> Custom activation Approval reference.
-- Existing approved Custom periods are backfilled from the already-authoritative immutable
-- Admin Approval evidence; no financial transaction, posting, amount, or period boundary changes.

BEGIN;

ALTER TABLE "accounting_periods"
ADD COLUMN "activation_approval_id" UUID;

ALTER TABLE "accounting_periods"
ADD CONSTRAINT "accounting_periods_activation_approval_id_fkey"
FOREIGN KEY ("activation_approval_id") REFERENCES "admin_approval_evidence"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- This is a one-time metadata backfill. CLOSED rows are intentionally protected from
-- normal application updates, so disable only the CLOSED-finality trigger for this
-- deterministic metadata copy. Other Accounting Period triggers and all FK checks stay active.
ALTER TABLE "accounting_periods"
DISABLE TRIGGER "accounting_periods_closed_finality_guard";

UPDATE "accounting_periods" period
SET "activation_approval_id" = approval."id"
FROM "admin_approval_evidence" approval
WHERE approval."action" = 'ACCOUNTING_PERIOD_CUSTOM_ACTIVATION'
  AND approval."resource_type" = 'ACCOUNTING_PERIOD'
  AND approval."resource_id" = period."id"
  AND period."activation_approval_id" IS NULL;

ALTER TABLE "accounting_periods"
ENABLE TRIGGER "accounting_periods_closed_finality_guard";

CREATE UNIQUE INDEX "accounting_periods_activation_approval_id_key"
ON "accounting_periods"("activation_approval_id");

CREATE OR REPLACE FUNCTION "validate_accounting_period_activation_approval_reference"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."activation_approval_id" IS NOT NULL
     AND NEW."activation_approval_id" IS DISTINCT FROM OLD."activation_approval_id" THEN
    RAISE EXCEPTION 'Accounting Period activation Approval reference is immutable';
  END IF;

  IF NEW."activation_approval_id" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."activation_approval_id" IS DISTINCT FROM OLD."activation_approval_id")
     AND NOT EXISTS (
       SELECT 1
       FROM "admin_approval_evidence" approval
       WHERE approval."id" = NEW."activation_approval_id"
         AND approval."action" = 'ACCOUNTING_PERIOD_CUSTOM_ACTIVATION'
         AND approval."resource_type" = 'ACCOUNTING_PERIOD'
         AND approval."resource_id" = NEW."id"
     ) THEN
    RAISE EXCEPTION 'Accounting Period activation Approval reference is invalid';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "accounting_periods_activation_approval_reference_insert_guard"
BEFORE INSERT ON "accounting_periods"
FOR EACH ROW EXECUTE FUNCTION "validate_accounting_period_activation_approval_reference"();

CREATE TRIGGER "accounting_periods_activation_approval_reference_guard"
BEFORE UPDATE OF "activation_approval_id" ON "accounting_periods"
FOR EACH ROW EXECUTE FUNCTION "validate_accounting_period_activation_approval_reference"();

COMMIT;

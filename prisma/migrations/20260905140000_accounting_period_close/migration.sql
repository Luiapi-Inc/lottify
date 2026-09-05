-- Govern CLOSING -> CLOSED with maker-checker approval and immutable evidence.
-- Reconciliation/checkpoint/discrepancy identifiers remain opaque references;
-- the Reporting/Reconciliation ownership is intentionally not introduced here.

BEGIN;

WITH calendar_lock AS MATERIALIZED (
  SELECT pg_advisory_xact_lock(19002026, 1)
)
SELECT 1::int AS "locked"
FROM calendar_lock;

ALTER TABLE "accounting_periods"
ADD COLUMN "close_requested_by_admin_id" UUID,
ADD COLUMN "close_reason" TEXT,
ADD COLUMN "close_requested_at" TIMESTAMP(3),
ADD COLUMN "close_reconciliation_references" JSONB,
ADD COLUMN "close_checkpoint_references" JSONB,
ADD COLUMN "close_blocking_discrepancy_references" JSONB,
ADD COLUMN "close_accepted_exception_references" JSONB,
ADD CONSTRAINT "accounting_periods_close_request_metadata_check"
CHECK (
  (
    "close_requested_by_admin_id" IS NULL
    AND "close_reason" IS NULL
    AND "close_requested_at" IS NULL
    AND "close_reconciliation_references" IS NULL
    AND "close_checkpoint_references" IS NULL
    AND "close_blocking_discrepancy_references" IS NULL
    AND "close_accepted_exception_references" IS NULL
  )
  OR
  (
    "close_requested_by_admin_id" IS NOT NULL
    AND "close_reason" IS NOT NULL
    AND length(btrim("close_reason")) > 0
    AND "close_requested_at" IS NOT NULL
    AND jsonb_typeof("close_reconciliation_references") = 'array'
    AND jsonb_array_length("close_reconciliation_references") > 0
    AND jsonb_typeof("close_checkpoint_references") = 'array'
    AND jsonb_array_length("close_checkpoint_references") > 0
    AND jsonb_typeof("close_blocking_discrepancy_references") = 'array'
    AND jsonb_typeof("close_accepted_exception_references") = 'array'
  )
);

ALTER TABLE "accounting_periods"
ADD CONSTRAINT "accounting_periods_close_requested_by_admin_id_fkey"
FOREIGN KEY ("close_requested_by_admin_id") REFERENCES "admin_users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "accounting_periods_close_requested_by_admin_id_close_requested_at_idx"
ON "accounting_periods"("close_requested_by_admin_id", "close_requested_at");

CREATE TABLE "accounting_period_close_evidence" (
  "id" UUID NOT NULL,
  "accounting_period_id" UUID NOT NULL,
  "closed_at" TIMESTAMP(3) NOT NULL,
  "approval_id" UUID NOT NULL,
  "reconciliation_references" JSONB NOT NULL,
  "checkpoint_references" JSONB NOT NULL,
  "blocking_discrepancy_references" JSONB NOT NULL,
  "accepted_exception_references" JSONB NOT NULL,
  "actor_admin_id" UUID NOT NULL,
  "audit_record_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_period_close_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_period_close_evidence_reference_shape_check" CHECK (
    jsonb_typeof("reconciliation_references") = 'array'
    AND jsonb_array_length("reconciliation_references") > 0
    AND jsonb_typeof("checkpoint_references") = 'array'
    AND jsonb_array_length("checkpoint_references") > 0
    AND jsonb_typeof("blocking_discrepancy_references") = 'array'
    AND jsonb_typeof("accepted_exception_references") = 'array'
  )
);

CREATE UNIQUE INDEX "accounting_period_close_evidence_accounting_period_id_key"
ON "accounting_period_close_evidence"("accounting_period_id");
CREATE UNIQUE INDEX "accounting_period_close_evidence_approval_id_key"
ON "accounting_period_close_evidence"("approval_id");
CREATE UNIQUE INDEX "accounting_period_close_evidence_audit_record_id_key"
ON "accounting_period_close_evidence"("audit_record_id");
CREATE INDEX "accounting_period_close_evidence_actor_admin_id_closed_at_idx"
ON "accounting_period_close_evidence"("actor_admin_id", "closed_at");

ALTER TABLE "accounting_period_close_evidence"
ADD CONSTRAINT "accounting_period_close_evidence_accounting_period_id_fkey"
FOREIGN KEY ("accounting_period_id") REFERENCES "accounting_periods"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "accounting_period_close_evidence_approval_id_fkey"
FOREIGN KEY ("approval_id") REFERENCES "admin_approval_evidence"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "accounting_period_close_evidence_actor_admin_id_fkey"
FOREIGN KEY ("actor_admin_id") REFERENCES "admin_users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "accounting_period_close_evidence_audit_record_id_fkey"
FOREIGN KEY ("audit_record_id") REFERENCES "audit_records"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "protect_accounting_period_close_request"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."close_requested_by_admin_id" IS NOT NULL AND (
    NEW."close_requested_by_admin_id" IS DISTINCT FROM OLD."close_requested_by_admin_id"
    OR NEW."close_reason" IS DISTINCT FROM OLD."close_reason"
    OR NEW."close_requested_at" IS DISTINCT FROM OLD."close_requested_at"
    OR NEW."close_reconciliation_references" IS DISTINCT FROM OLD."close_reconciliation_references"
    OR NEW."close_checkpoint_references" IS DISTINCT FROM OLD."close_checkpoint_references"
    OR NEW."close_blocking_discrepancy_references" IS DISTINCT FROM OLD."close_blocking_discrepancy_references"
    OR NEW."close_accepted_exception_references" IS DISTINCT FROM OLD."close_accepted_exception_references"
  ) THEN
    RAISE EXCEPTION 'Accounting Period close request evidence is immutable';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "accounting_periods_close_request_immutable"
BEFORE UPDATE ON "accounting_periods"
FOR EACH ROW EXECUTE FUNCTION "protect_accounting_period_close_request"();

CREATE OR REPLACE FUNCTION "validate_accounting_period_close_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approval_row "admin_approval_evidence"%ROWTYPE;
  audit_row "audit_records"%ROWTYPE;
  period_state TEXT;
BEGIN
  SELECT "state" INTO period_state
  FROM "accounting_periods"
  WHERE "id" = NEW."accounting_period_id";

  IF period_state IS DISTINCT FROM 'CLOSING' THEN
    RAISE EXCEPTION 'Accounting Period close evidence requires CLOSING state';
  END IF;

  SELECT * INTO approval_row
  FROM "admin_approval_evidence"
  WHERE "id" = NEW."approval_id";

  IF approval_row."action" IS DISTINCT FROM 'ACCOUNTING_PERIOD_CLOSE'
     OR approval_row."resource_type" IS DISTINCT FROM 'ACCOUNTING_PERIOD'
     OR approval_row."resource_id" IS DISTINCT FROM NEW."accounting_period_id"
     OR approval_row."requester_admin_id" = approval_row."approver_admin_id"
     OR approval_row."approver_admin_id" IS DISTINCT FROM NEW."actor_admin_id"
     OR approval_row."approved_at" IS DISTINCT FROM NEW."closed_at" THEN
    RAISE EXCEPTION 'Accounting Period close approval evidence is invalid';
  END IF;

  SELECT * INTO audit_row
  FROM "audit_records"
  WHERE "id" = NEW."audit_record_id";

  IF audit_row."action" IS DISTINCT FROM 'ACCOUNTING_PERIOD_CLOSE'
     OR audit_row."resource_type" IS DISTINCT FROM 'ACCOUNTING_PERIOD'
     OR audit_row."resource_id" IS DISTINCT FROM NEW."accounting_period_id"
     OR audit_row."approval_id" IS DISTINCT FROM NEW."approval_id"
     OR audit_row."actor_admin_id" IS DISTINCT FROM NEW."actor_admin_id"
     OR audit_row."outcome" IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'Accounting Period close Audit Record linkage is invalid';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "accounting_period_close_evidence_validate"
BEFORE INSERT ON "accounting_period_close_evidence"
FOR EACH ROW EXECUTE FUNCTION "validate_accounting_period_close_evidence"();

CREATE OR REPLACE FUNCTION "protect_immutable_accounting_period_close_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Immutable Accounting Period close evidence cannot be updated or deleted';
END
$$;

CREATE TRIGGER "accounting_period_close_evidence_immutable"
BEFORE UPDATE OR DELETE ON "accounting_period_close_evidence"
FOR EACH ROW EXECUTE FUNCTION "protect_immutable_accounting_period_close_evidence"();

CREATE OR REPLACE FUNCTION "enforce_accounting_period_close_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."state" = 'CLOSED' THEN
    RAISE EXCEPTION 'CLOSED Accounting Period is terminal';
  END IF;

  IF NEW."state" = 'CLOSED' AND OLD."state" <> 'CLOSED' THEN
    IF OLD."state" <> 'CLOSING' THEN
      RAISE EXCEPTION 'Accounting Period can close only from CLOSING';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "accounting_period_close_evidence" evidence
      WHERE evidence."accounting_period_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'Accounting Period cannot close without immutable close evidence';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "accounting_periods_close_transition_guard"
BEFORE UPDATE OF "state" ON "accounting_periods"
FOR EACH ROW EXECUTE FUNCTION "enforce_accounting_period_close_transition"();

CREATE OR REPLACE FUNCTION "protect_closed_accounting_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."state" = 'CLOSED' THEN
    RAISE EXCEPTION 'CLOSED Accounting Period is terminal';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "accounting_periods_closed_finality_guard"
BEFORE UPDATE OR DELETE ON "accounting_periods"
FOR EACH ROW EXECUTE FUNCTION "protect_closed_accounting_period"();

-- A new or moved Financial Transaction must always land in the currently OPEN
-- authoritative period. Historical CLOSED rows remain untouched by this migration.
CREATE OR REPLACE FUNCTION "enforce_financial_transaction_accounting_period_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "accounting_periods" period
    WHERE period."id" = NEW."accounting_period_id"
      AND period."state" = 'OPEN'
      AND NEW."posted_at" >= period."effective_start"
      AND NEW."posted_at" < period."effective_end"
  ) THEN
    RAISE EXCEPTION 'Financial Transaction must post into its authoritative OPEN Accounting Period';
  END IF;

  RETURN NEW;
END
$$;

COMMIT;

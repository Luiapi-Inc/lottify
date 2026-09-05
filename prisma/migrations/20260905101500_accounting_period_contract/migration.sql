-- Contract-stage Accounting Period linkage after verified historical backfill.
--
-- This migration must never repair or rewrite Financial Transactions. It proves
-- the additive/backfill state is valid, then contracts the schema.

BEGIN;

-- Serialize contract with the live posting-path/scheduler accounting calendar.
WITH calendar_lock AS MATERIALIZED (
  SELECT pg_advisory_xact_lock(19002026, 1)
)
SELECT 1::int AS "locked"
FROM calendar_lock;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'financial_transactions_accounting_period_id_fkey'
      AND conrelid = 'financial_transactions'::regclass
  ) THEN
    RAISE EXCEPTION 'Accounting Period contract failed: restrictive Financial Transaction foreign key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'financial_transactions'
      AND indexname = 'financial_transactions_accounting_period_id_idx'
  ) THEN
    RAISE EXCEPTION 'Accounting Period contract failed: Financial Transaction Accounting Period index is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "financial_transactions"
    WHERE "accounting_period_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Accounting Period contract failed: Financial Transaction linkage is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "financial_transactions" ft
    LEFT JOIN "accounting_periods" period
      ON period."id" = ft."accounting_period_id"
    WHERE period."id" IS NULL
      OR ft."posted_at" < period."effective_start"
      OR ft."posted_at" >= period."effective_end"
  ) THEN
    RAISE EXCEPTION 'Accounting Period contract failed: Financial Transaction linkage is invalid for postedAt';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "accounting_periods" left_period
    JOIN "accounting_periods" right_period
      ON left_period."id" < right_period."id"
      AND left_period."effective_start" < right_period."effective_end"
      AND right_period."effective_start" < left_period."effective_end"
    WHERE left_period."state" IN ('SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED')
      AND right_period."state" IN ('SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'Accounting Period contract failed: effective Accounting Period coverage overlaps';
  END IF;
END
$$;

ALTER TABLE "financial_transactions"
ALTER COLUMN "accounting_period_id" SET NOT NULL;

CREATE OR REPLACE FUNCTION "enforce_financial_transaction_accounting_period_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "accounting_periods" period
    WHERE period."id" = NEW."accounting_period_id"
      AND NEW."posted_at" >= period."effective_start"
      AND NEW."posted_at" < period."effective_end"
  ) THEN
    RAISE EXCEPTION 'Financial Transaction postedAt is outside its authoritative Accounting Period';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "financial_transactions_accounting_period_membership" ON "financial_transactions";
CREATE TRIGGER "financial_transactions_accounting_period_membership"
BEFORE INSERT OR UPDATE OF "accounting_period_id", "posted_at"
ON "financial_transactions"
FOR EACH ROW
EXECUTE FUNCTION "enforce_financial_transaction_accounting_period_membership"();

CREATE OR REPLACE FUNCTION "protect_referenced_accounting_period_bounds"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."effective_start" IS DISTINCT FROM OLD."effective_start"
    OR NEW."effective_end" IS DISTINCT FROM OLD."effective_end"
  ) AND EXISTS (
    SELECT 1
    FROM "financial_transactions" ft
    WHERE ft."accounting_period_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'Referenced Accounting Period boundaries are immutable';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "accounting_periods_referenced_bounds_immutable" ON "accounting_periods";
CREATE TRIGGER "accounting_periods_referenced_bounds_immutable"
BEFORE UPDATE OF "effective_start", "effective_end"
ON "accounting_periods"
FOR EACH ROW
EXECUTE FUNCTION "protect_referenced_accounting_period_bounds"();

-- PostgreSQL protects the effective calendar from committed overlaps. Draft,
-- pending-approval and cancelled proposals intentionally do not participate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounting_periods_effective_range_excl'
      AND conrelid = 'accounting_periods'::regclass
  ) THEN
    ALTER TABLE "accounting_periods"
    ADD CONSTRAINT "accounting_periods_effective_range_excl"
    EXCLUDE USING gist (
      tsrange("effective_start", "effective_end", '[)') WITH &&
    )
    WHERE ("state" IN ('SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED'));
  END IF;
END
$$;

COMMIT;

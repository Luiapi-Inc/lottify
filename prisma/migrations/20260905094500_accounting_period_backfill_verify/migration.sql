-- Backfill historical Financial Transactions into authoritative Accounting Periods.
--
-- This is the backfill + verify stage of expand -> backfill -> verify -> contract.
-- The linkage remains nullable until the later contract migration.

BEGIN;

-- Serialize with the live posting-path/scheduler Accounting Period runtime.
WITH calendar_lock AS MATERIALIZED (
  SELECT pg_advisory_xact_lock(19002026, 1)
)
SELECT 1::int AS "locked"
FROM calendar_lock;

CREATE TEMP TABLE "_accounting_period_backfill_clock" ON COMMIT DROP AS
WITH local_clock AS (
  SELECT date_trunc(
    'week',
    transaction_timestamp() AT TIME ZONE 'Asia/Bangkok'
  ) AS "current_start_local"
)
SELECT
  (("current_start_local" AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC')::timestamp(3)
    AS "current_start",
  ((("current_start_local" + INTERVAL '1 week') AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC')::timestamp(3)
    AS "current_end",
  ((("current_start_local" + INTERVAL '2 weeks') AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC')::timestamp(3)
    AS "next_end"
FROM local_clock;

-- Compact immutable snapshots prove that the backfill changes only Accounting Period linkage/state.
CREATE TEMP TABLE "_accounting_period_backfill_transaction_snapshot" ON COMMIT DROP AS
SELECT
  "id",
  md5(
    jsonb_build_array(
      "business_transaction_id",
      "operation_type",
      "correlation_id",
      "idempotency_scope",
      "idempotency_key",
      "fingerprint",
      "domain_references",
      "currency",
      "effective_at",
      "posted_at",
      "correction_kind",
      "corrects_transaction_id",
      "created_at"
    )::text
  ) AS "signature"
FROM "financial_transactions";

CREATE TEMP TABLE "_accounting_period_backfill_posting_snapshot" ON COMMIT DROP AS
SELECT
  "id",
  md5(
    jsonb_build_array(
      "transaction_id",
      "account_id",
      "side",
      "amount_minor"::text,
      "created_at"
    )::text
  ) AS "signature"
FROM "ledger_postings";

-- Generate every Automatic nominal week needed by existing postedAt values, plus current + next.
WITH transaction_weeks AS (
  SELECT DISTINCT
    (
      date_trunc(
        'week',
        ("posted_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok'
      ) AT TIME ZONE 'Asia/Bangkok' AT TIME ZONE 'UTC'
    )::timestamp(3) AS "effective_start",
    (
      (
        date_trunc(
          'week',
          ("posted_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok'
        ) + INTERVAL '1 week'
      ) AT TIME ZONE 'Asia/Bangkok' AT TIME ZONE 'UTC'
    )::timestamp(3) AS "effective_end"
  FROM "financial_transactions"
),
required_periods AS (
  SELECT "effective_start", "effective_end" FROM transaction_weeks
  UNION
  SELECT "current_start", "current_end"
  FROM "_accounting_period_backfill_clock"
  UNION
  SELECT "current_end", "next_end"
  FROM "_accounting_period_backfill_clock"
)
INSERT INTO "accounting_periods" (
  "id",
  "mode",
  "generation_kind",
  "effective_start",
  "effective_end",
  "state"
)
SELECT
  gen_random_uuid(),
  'AUTOMATIC_WEEKLY',
  'NOMINAL_WEEK',
  required."effective_start",
  required."effective_end",
  CASE
    WHEN required."effective_end" <= clock."current_start" THEN 'CLOSING'
    WHEN required."effective_start" = clock."current_start" THEN 'OPEN'
    ELSE 'SCHEDULED'
  END
FROM required_periods required
CROSS JOIN "_accounting_period_backfill_clock" clock
ON CONFLICT ("effective_start", "effective_end") DO NOTHING;

-- A current period may have been created as SCHEDULED immediately before boundary turnover.
UPDATE "accounting_periods" period
SET
  "state" = 'OPEN',
  "version" = "version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM "_accounting_period_backfill_clock" clock
WHERE period."mode" = 'AUTOMATIC_WEEKLY'
  AND period."generation_kind" = 'NOMINAL_WEEK'
  AND period."effective_start" = clock."current_start"
  AND period."effective_end" = clock."current_end"
  AND period."state" = 'SCHEDULED';

-- Historical effective periods enter CLOSING first. CLOSED is applied only after verification below.
UPDATE "accounting_periods" period
SET
  "state" = 'CLOSING',
  "version" = "version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM "_accounting_period_backfill_clock" clock
WHERE period."mode" = 'AUTOMATIC_WEEKLY'
  AND period."generation_kind" = 'NOMINAL_WEEK'
  AND period."effective_end" <= clock."current_start"
  AND period."state" IN ('OPEN', 'SCHEDULED');

DO $$
BEGIN
  -- Each postedAt week must resolve to exactly one effective Automatic nominal period.
  IF EXISTS (
    SELECT 1
    FROM "financial_transactions" ft
    LEFT JOIN "accounting_periods" period
      ON period."mode" = 'AUTOMATIC_WEEKLY'
      AND period."generation_kind" = 'NOMINAL_WEEK'
      AND period."state" IN ('SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED')
      AND ft."posted_at" >= period."effective_start"
      AND ft."posted_at" < period."effective_end"
    GROUP BY ft."id"
    HAVING COUNT(period."id") <> 1
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: postedAt does not resolve to exactly one Automatic nominal period';
  END IF;

  -- Effective Accounting Period coverage must not overlap.
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
    RAISE EXCEPTION 'Accounting Period backfill verification failed: effective period coverage overlaps';
  END IF;

  -- Current + next Automatic lifecycle must match the approved runtime model.
  IF NOT EXISTS (
    SELECT 1
    FROM "accounting_periods" period
    CROSS JOIN "_accounting_period_backfill_clock" clock
    WHERE period."mode" = 'AUTOMATIC_WEEKLY'
      AND period."generation_kind" = 'NOMINAL_WEEK'
      AND period."effective_start" = clock."current_start"
      AND period."effective_end" = clock."current_end"
      AND period."state" = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: current Automatic period is not OPEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "accounting_periods" period
    CROSS JOIN "_accounting_period_backfill_clock" clock
    WHERE period."mode" = 'AUTOMATIC_WEEKLY'
      AND period."generation_kind" = 'NOMINAL_WEEK'
      AND period."effective_start" = clock."current_end"
      AND period."effective_end" = clock."next_end"
      AND period."state" = 'SCHEDULED'
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: next Automatic period is not SCHEDULED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "accounting_periods" period
    CROSS JOIN "_accounting_period_backfill_clock" clock
    WHERE period."mode" = 'AUTOMATIC_WEEKLY'
      AND period."generation_kind" = 'NOMINAL_WEEK'
      AND period."state" = 'OPEN'
      AND (
        period."effective_start" <> clock."current_start"
        OR period."effective_end" <> clock."current_end"
      )
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: more than one Automatic period is OPEN';
  END IF;
END
$$;

-- Link only rows that are still nullable. Existing authoritative links are validation-only.
UPDATE "financial_transactions" ft
SET "accounting_period_id" = period."id"
FROM "accounting_periods" period
WHERE ft."accounting_period_id" IS NULL
  AND period."mode" = 'AUTOMATIC_WEEKLY'
  AND period."generation_kind" = 'NOMINAL_WEEK'
  AND period."state" IN ('SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED')
  AND ft."posted_at" >= period."effective_start"
  AND ft."posted_at" < period."effective_end";

DO $$
BEGIN
  -- Every row must now be linked, and the original postedAt must lie in the referenced half-open range.
  IF EXISTS (
    SELECT 1
    FROM "financial_transactions" ft
    LEFT JOIN "accounting_periods" period
      ON period."id" = ft."accounting_period_id"
    WHERE ft."accounting_period_id" IS NULL
      OR period."id" IS NULL
      OR ft."posted_at" < period."effective_start"
      OR ft."posted_at" >= period."effective_end"
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: authoritative linkage is missing or outside the referenced half-open range';
  END IF;

  -- Existing financial transactions must remain balanced before this migration may close history.
  IF EXISTS (
    SELECT 1
    FROM "financial_transactions" ft
    LEFT JOIN "ledger_postings" posting
      ON posting."transaction_id" = ft."id"
    GROUP BY ft."id"
    HAVING COUNT(posting."id") = 0
      OR COALESCE(SUM(CASE WHEN posting."side" = 'DEBIT' THEN posting."amount_minor" ELSE 0 END), 0)
        <> COALESCE(SUM(CASE WHEN posting."side" = 'CREDIT' THEN posting."amount_minor" ELSE 0 END), 0)
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: Ledger balance invariant is not satisfied';
  END IF;

  -- Prove business/idempotency identities, timestamps, correction links and other immutable FT data are unchanged.
  IF EXISTS (
    SELECT 1
    FROM "_accounting_period_backfill_transaction_snapshot" snapshot
    FULL JOIN (
      SELECT
        "id",
        md5(
          jsonb_build_array(
            "business_transaction_id",
            "operation_type",
            "correlation_id",
            "idempotency_scope",
            "idempotency_key",
            "fingerprint",
            "domain_references",
            "currency",
            "effective_at",
            "posted_at",
            "correction_kind",
            "corrects_transaction_id",
            "created_at"
          )::text
        ) AS "signature"
      FROM "financial_transactions"
    ) current_state USING ("id")
    WHERE snapshot."id" IS NULL
      OR current_state."id" IS NULL
      OR snapshot."signature" IS DISTINCT FROM current_state."signature"
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: immutable Financial Transaction data changed';
  END IF;

  -- Prove postings and amounts are byte-for-byte stable at the logical-row level.
  IF EXISTS (
    SELECT 1
    FROM "_accounting_period_backfill_posting_snapshot" snapshot
    FULL JOIN (
      SELECT
        "id",
        md5(
          jsonb_build_array(
            "transaction_id",
            "account_id",
            "side",
            "amount_minor"::text,
            "created_at"
          )::text
        ) AS "signature"
      FROM "ledger_postings"
    ) current_state USING ("id")
    WHERE snapshot."id" IS NULL
      OR current_state."id" IS NULL
      OR snapshot."signature" IS DISTINCT FROM current_state."signature"
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: Ledger postings changed';
  END IF;
END
$$;

-- Verification succeeded. Historical Automatic periods can now become terminal CLOSED.
UPDATE "accounting_periods" period
SET
  "state" = 'CLOSED',
  "version" = "version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM "_accounting_period_backfill_clock" clock
WHERE period."mode" = 'AUTOMATIC_WEEKLY'
  AND period."generation_kind" = 'NOMINAL_WEEK'
  AND period."effective_end" <= clock."current_start"
  AND period."state" = 'CLOSING';

DO $$
BEGIN
  -- Every historical period referenced by backfilled Financial Transactions is terminal only after verification.
  IF EXISTS (
    SELECT 1
    FROM "financial_transactions" ft
    JOIN "accounting_periods" period
      ON period."id" = ft."accounting_period_id"
    CROSS JOIN "_accounting_period_backfill_clock" clock
    WHERE period."mode" = 'AUTOMATIC_WEEKLY'
      AND period."generation_kind" = 'NOMINAL_WEEK'
      AND period."effective_end" <= clock."current_start"
      AND period."state" <> 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'Accounting Period backfill verification failed: verified historical period did not become CLOSED';
  END IF;
END
$$;

COMMIT;

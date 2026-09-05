-- Expand-stage Accounting Period persistence and nullable Financial Transaction linkage.

CREATE TABLE "accounting_periods" (
    "id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "generation_kind" TEXT NOT NULL,
    "effective_start" TIMESTAMP(3) NOT NULL,
    "effective_end" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "accounting_periods_mode_check" CHECK ("mode" IN ('AUTOMATIC_WEEKLY', 'CUSTOM')),
    CONSTRAINT "accounting_periods_generation_kind_check" CHECK ("generation_kind" IN ('NOMINAL_WEEK', 'DERIVED_FRAGMENT', 'CUSTOM')),
    CONSTRAINT "accounting_periods_state_check" CHECK ("state" IN ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED', 'CANCELLED')),
    CONSTRAINT "accounting_periods_bounds_check" CHECK ("effective_end" > "effective_start"),
    CONSTRAINT "accounting_periods_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "accounting_periods_effective_start_effective_end_key"
ON "accounting_periods"("effective_start", "effective_end");

CREATE INDEX "accounting_periods_state_effective_start_effective_end_idx"
ON "accounting_periods"("state", "effective_start", "effective_end");

ALTER TABLE "financial_transactions"
ADD COLUMN "accounting_period_id" UUID;

CREATE INDEX "financial_transactions_accounting_period_id_idx"
ON "financial_transactions"("accounting_period_id");

ALTER TABLE "financial_transactions"
ADD CONSTRAINT "financial_transactions_accounting_period_id_fkey"
FOREIGN KEY ("accounting_period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed only the current nominal Automatic week for the expand-stage rollout.
-- Historical rows intentionally remain nullable until the dedicated backfill ticket.
INSERT INTO "accounting_periods" (
    "id",
    "mode",
    "generation_kind",
    "effective_start",
    "effective_end",
    "state"
)
VALUES (
    gen_random_uuid(),
    'AUTOMATIC_WEEKLY',
    'NOMINAL_WEEK',
    (
      date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
      AT TIME ZONE 'Asia/Bangkok'
      AT TIME ZONE 'UTC'
    ),
    (
      (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok') + INTERVAL '1 week')
      AT TIME ZONE 'Asia/Bangkok'
      AT TIME ZONE 'UTC'
    ),
    'OPEN'
);

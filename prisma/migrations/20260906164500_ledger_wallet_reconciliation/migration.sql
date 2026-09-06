-- Durable Reporting/Reconciliation evidence for the Ledger <-> Wallet projection pair.
-- These tables are read-model/evidence state only and do not own or mutate Ledger money.

CREATE TABLE "reconciliation_runs" (
  "id" UUID NOT NULL,
  "pair" TEXT NOT NULL,
  "checkpoint_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "member_id" UUID NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "as_of" TIMESTAMP(3) NOT NULL,
  "source_range" JSONB NOT NULL,
  "source_checkpoint" JSONB NOT NULL,
  "inspected_counts" JSONB NOT NULL,
  "totals" JSONB NOT NULL,
  "result" TEXT NOT NULL,
  "result_summary" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reconciliation_runs_pair_check" CHECK ("pair" = 'LEDGER_WALLET'),
  CONSTRAINT "reconciliation_runs_result_check" CHECK ("result" IN ('MATCHED', 'MISMATCH')),
  CONSTRAINT "reconciliation_runs_evidence_shape_check" CHECK (
    jsonb_typeof("source_range") = 'object'
    AND jsonb_typeof("source_checkpoint") = 'object'
    AND jsonb_typeof("inspected_counts") = 'object'
    AND jsonb_typeof("totals") = 'object'
    AND jsonb_typeof("result_summary") = 'object'
  )
);

CREATE UNIQUE INDEX "reconciliation_runs_pair_checkpoint_key_key"
ON "reconciliation_runs"("pair", "checkpoint_key");
CREATE INDEX "reconciliation_runs_member_id_currency_as_of_idx"
ON "reconciliation_runs"("member_id", "currency", "as_of");
CREATE INDEX "reconciliation_runs_pair_as_of_idx"
ON "reconciliation_runs"("pair", "as_of");

CREATE TABLE "reconciliation_discrepancies" (
  "id" UUID NOT NULL,
  "reconciliation_run_id" UUID NOT NULL,
  "identity_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "expected_facts" JSONB NOT NULL,
  "observed_facts" JSONB NOT NULL,
  "amount_difference_minor" BIGINT,
  "source_references" JSONB NOT NULL,
  "detected_at" TIMESTAMP(3) NOT NULL,
  "owner_reference" TEXT,
  "resolution_trail" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "resolution_evidence" JSONB,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reconciliation_discrepancies_status_check" CHECK (
    "status" IN (
      'DETECTED',
      'INVESTIGATING',
      'RESOLUTION_PENDING',
      'RESOLVED',
      'FALSE_POSITIVE',
      'ACCEPTED_EXCEPTION'
    )
  ),
  CONSTRAINT "reconciliation_discrepancies_fact_shape_check" CHECK (
    jsonb_typeof("expected_facts") = 'object'
    AND jsonb_typeof("observed_facts") = 'object'
    AND jsonb_typeof("source_references") = 'object'
    AND jsonb_typeof("resolution_trail") = 'array'
    AND ("resolution_evidence" IS NULL OR jsonb_typeof("resolution_evidence") = 'object')
  )
);

CREATE UNIQUE INDEX "reconciliation_discrepancies_run_identity_key_key"
ON "reconciliation_discrepancies"("reconciliation_run_id", "identity_key");
CREATE INDEX "reconciliation_discrepancies_status_detected_at_idx"
ON "reconciliation_discrepancies"("status", "detected_at");
CREATE INDEX "reconciliation_discrepancies_severity_detected_at_idx"
ON "reconciliation_discrepancies"("severity", "detected_at");

ALTER TABLE "reconciliation_discrepancies"
ADD CONSTRAINT "reconciliation_discrepancies_reconciliation_run_id_fkey"
FOREIGN KEY ("reconciliation_run_id") REFERENCES "reconciliation_runs"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

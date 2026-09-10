-- Result & Settlement persistence (vertical 4).
--
-- A ResultRevision is the immutable, validated Product-shaped winning data for
-- a Draw. Confirmed revisions are immutable: a correction creates a NEW
-- revision that relationally SUPERSEDES the prior one (never edits it). A
-- SettlementBatch is the durable execution unit whose Member-visible outcome is
-- authoritative only on COMPLETED; SettlementOrder rows are the per-Order
-- checkpoints that make a crashed batch resumable without re-posting a payout.
-- Additive and backward-compatible with the existing v1 schema.

CREATE TABLE "result_revisions" (
    "id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "result_schema_version_ref" TEXT NOT NULL,
    "result_source_ref" TEXT,
    "result_data" JSONB NOT NULL,
    "winning_numbers" JSONB NOT NULL,
    "supersedes_revision_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "result_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "result_revisions_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "result_revisions_state_check" CHECK (
        "state" IN ('RECEIVED','VALIDATING','REVIEW_REQUIRED','CONFIRMED','SUPERSEDED')
    ),
    -- A CONFIRMED revision must carry the instant and actor of confirmation.
    CONSTRAINT "result_revisions_confirmed_effect_check" CHECK (
        "state" <> 'CONFIRMED'
        OR ("confirmed_at" IS NOT NULL AND "confirmed_by_admin_id" IS NOT NULL)
    ),
    -- A revision that supersedes another must not also be the first revision.
    CONSTRAINT "result_revisions_supersedes_chain_check" CHECK (
        ("supersedes_revision_id" IS NULL AND "revision" = 1)
        OR ("supersedes_revision_id" IS NOT NULL AND "revision" > 1)
    )
);

CREATE TABLE "settlement_batches" (
    "id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "result_revision_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "correlation_id" TEXT NOT NULL,
    "total_stake_minor" BIGINT NOT NULL DEFAULT 0,
    "total_payout_minor" BIGINT NOT NULL DEFAULT 0,
    "winning_order_count" INTEGER NOT NULL DEFAULT 0,
    "losing_order_count" INTEGER NOT NULL DEFAULT 0,
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_batches_state_check" CHECK (
        "state" IN ('PENDING','CALCULATING','POSTING','COMMITTING','COMPLETED','FAILED','RETRY_PENDING')
    ),
    CONSTRAINT "settlement_batches_version_check" CHECK ("version" >= 1),
    CONSTRAINT "settlement_batches_totals_check" CHECK (
        "total_stake_minor" >= 0 AND "total_payout_minor" >= 0
        AND "winning_order_count" >= 0 AND "losing_order_count" >= 0
    ),
    -- A COMPLETED batch must have finalized its financial totals and instant.
    CONSTRAINT "settlement_batches_completed_effect_check" CHECK (
        "state" <> 'COMPLETED' OR ("completed_at" IS NOT NULL)
    )
);

CREATE TABLE "settlement_orders" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "stake_minor" BIGINT NOT NULL,
    "payout_minor" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "payout_transaction_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "settlement_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_orders_outcome_check" CHECK ("outcome" IN ('WIN','LOSE')),
    CONSTRAINT "settlement_orders_status_check" CHECK ("status" IN ('EVALUATED','POSTED')),
    CONSTRAINT "settlement_orders_stake_check" CHECK ("stake_minor" > 0),
    CONSTRAINT "settlement_orders_payout_check" CHECK ("payout_minor" >= 0),
    -- A durable per-Order checkpoint: an EVALUATED WIN row records the
    -- evaluated outcome before the payout is posted; a POSTED WIN row must carry
    -- the authoritative payout transaction; a LOSE row never posts money.
    CONSTRAINT "settlement_orders_payout_effect_check" CHECK (
        ("outcome" = 'WIN' AND "payout_minor" > 0 AND "status" = 'POSTED' AND "payout_transaction_id" IS NOT NULL)
        OR ("outcome" = 'WIN' AND "payout_minor" > 0 AND "status" = 'EVALUATED' AND "payout_transaction_id" IS NULL)
        OR ("outcome" = 'LOSE' AND "payout_minor" = 0 AND "payout_transaction_id" IS NULL)
    )
);

-- Per-Draw revision uniqueness and the immutable correction chain.
CREATE UNIQUE INDEX "result_revisions_draw_id_revision_key"
  ON "result_revisions"("draw_id", "revision");
-- A prior revision may be superseded by at most one correction revision.
CREATE UNIQUE INDEX "result_revisions_supersedes_revision_id_key"
  ON "result_revisions"("supersedes_revision_id");
CREATE INDEX "result_revisions_draw_id_state_idx" ON "result_revisions"("draw_id", "state");

CREATE UNIQUE INDEX "settlement_batches_idempotency_scope_idempotency_key_key"
  ON "settlement_batches"("idempotency_scope", "idempotency_key");
CREATE INDEX "settlement_batches_draw_id_state_idx" ON "settlement_batches"("draw_id", "state");

-- One SettlementOrder checkpoint per Bet Order (resumable, once-only payout).
CREATE UNIQUE INDEX "settlement_orders_order_id_key" ON "settlement_orders"("order_id");
CREATE UNIQUE INDEX "settlement_orders_batch_id_order_id_key"
  ON "settlement_orders"("batch_id", "order_id");
CREATE INDEX "settlement_orders_member_id_created_at_idx" ON "settlement_orders"("member_id", "created_at");
CREATE INDEX "settlement_orders_batch_id_outcome_idx" ON "settlement_orders"("batch_id", "outcome");

ALTER TABLE "result_revisions"
  ADD CONSTRAINT "result_revisions_draw_id_fkey"
  FOREIGN KEY ("draw_id") REFERENCES "lottery_draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_revisions"
  ADD CONSTRAINT "result_revisions_supersedes_revision_id_fkey"
  FOREIGN KEY ("supersedes_revision_id") REFERENCES "result_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlement_batches"
  ADD CONSTRAINT "settlement_batches_draw_id_fkey"
  FOREIGN KEY ("draw_id") REFERENCES "lottery_draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_batches"
  ADD CONSTRAINT "settlement_batches_result_revision_id_fkey"
  FOREIGN KEY ("result_revision_id") REFERENCES "result_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlement_orders"
  ADD CONSTRAINT "settlement_orders_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "settlement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_orders"
  ADD CONSTRAINT "settlement_orders_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "bet_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_orders"
  ADD CONSTRAINT "settlement_orders_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A confirmed (or already-superseded) Result revision's winning data is
-- immutable: the accepted payload can never be rewritten after confirmation,
-- and terminal revisions are never deleted. Only the state/confirmed fields may
-- change (e.g. CONFIRMED -> SUPERSEDED), and even then only the audit fields,
-- never the result payload.
CREATE OR REPLACE FUNCTION "protect_result_revision_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.state IN ('CONFIRMED','SUPERSEDED') THEN
    RAISE EXCEPTION 'Terminal Result revisions are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IN ('CONFIRMED','SUPERSEDED') THEN
      IF NEW.result_data IS DISTINCT FROM OLD.result_data
         OR NEW.winning_numbers IS DISTINCT FROM OLD.winning_numbers
         OR NEW.draw_id IS DISTINCT FROM OLD.draw_id
         OR NEW.revision IS DISTINCT FROM OLD.revision
         OR NEW.result_schema_version_ref IS DISTINCT FROM OLD.result_schema_version_ref
         OR NEW.result_source_ref IS DISTINCT FROM OLD.result_source_ref
         OR NEW.supersedes_revision_id IS DISTINCT FROM OLD.supersedes_revision_id THEN
        RAISE EXCEPTION 'Confirmed Result revision payload is immutable';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "result_revisions_immutable"
BEFORE UPDATE OR DELETE ON "result_revisions"
FOR EACH ROW EXECUTE FUNCTION "protect_result_revision_immutability"();

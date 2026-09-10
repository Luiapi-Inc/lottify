-- Bet Order + immutable Bet Receipt persistence (Issue 45). An Order is created
-- from an authorised Quote and moves through the locked lifecycle state machine
-- (`bet-order-lifecycle`); `version` is the optimistic-concurrency guard for
-- every member command. The financial-linkage CHECK constraints make the
-- confirmed/cancelled terminal states unreachable in the database without the
-- durable Wallet & Ledger effect that gated them. Additive and
-- backward-compatible with the existing v1 schema.

CREATE TABLE "bet_orders" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "state" TEXT NOT NULL DEFAULT 'QUOTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "total_stake_minor" BIGINT NOT NULL,
    "cutoff_at" TIMESTAMP(3) NOT NULL,
    "quote_expires_at" TIMESTAMP(3) NOT NULL,
    "reservation_id" UUID,
    "stake_transaction_id" UUID,
    "refund_transaction_id" UUID,
    "rejection_reason" TEXT,
    "cancellation_reason" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bet_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bet_orders_currency_check" CHECK ("currency" IN ('THB')),
    CONSTRAINT "bet_orders_state_check" CHECK (
        "state" IN ('DRAFT','QUOTED','CONFIRMING','CONFIRMED','CANCELLING','CANCELLED','EXPIRED','REJECTED','SETTLED')
    ),
    CONSTRAINT "bet_orders_version_check" CHECK ("version" >= 1),
    CONSTRAINT "bet_orders_total_stake_check" CHECK ("total_stake_minor" > 0),
    CONSTRAINT "bet_orders_cutoff_check" CHECK ("cutoff_at" >= "created_at"),
    -- A CONFIRMED/SETTLED Order must carry the Reservation and the stake
    -- transaction that produced the Wallet & Ledger effect, plus the instant it
    -- was confirmed. The state cannot be reached without them.
    CONSTRAINT "bet_orders_confirmed_effect_check" CHECK (
        "state" NOT IN ('CONFIRMED','SETTLED')
        OR ("reservation_id" IS NOT NULL AND "stake_transaction_id" IS NOT NULL AND "confirmed_at" IS NOT NULL)
    ),
    -- A CANCELLED Order must carry the posted refund and the instant of
    -- cancellation; member cancellation is never complete while its required
    -- refund remains unposted.
    CONSTRAINT "bet_orders_cancelled_refund_check" CHECK (
        "state" <> 'CANCELLED'
        OR ("refund_transaction_id" IS NOT NULL AND "cancelled_at" IS NOT NULL)
    ),
    CONSTRAINT "bet_orders_rejected_instant_check" CHECK (
        "state" <> 'REJECTED' OR ("rejected_at" IS NOT NULL AND "rejection_reason" IS NOT NULL)
    )
);

CREATE TABLE "bet_order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "bet_type_id" UUID NOT NULL,
    "bet_type_code" TEXT NOT NULL,
    "bet_type_version_id" UUID NOT NULL,
    "canonical_number" TEXT NOT NULL,
    "stake_minor" BIGINT NOT NULL,
    "resolved_payout" JSONB NOT NULL,
    "payout_source" TEXT NOT NULL,
    "restrictions" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bet_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bet_order_lines_stake_check" CHECK ("stake_minor" > 0),
    CONSTRAINT "bet_order_lines_payout_source_check" CHECK ("payout_source" IN ('DRAW_OVERRIDE','DRAW_SNAPSHOT'))
);

CREATE TABLE "bet_receipts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "order_version" INTEGER NOT NULL,
    "content_digest" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bet_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bet_receipts_order_version_check" CHECK ("order_version" >= 1),
    CONSTRAINT "bet_receipts_content_digest_check" CHECK ("content_digest" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "bet_orders_member_id_created_at_idx" ON "bet_orders"("member_id", "created_at");
CREATE INDEX "bet_orders_draw_id_state_idx" ON "bet_orders"("draw_id", "state");
CREATE INDEX "bet_orders_state_idx" ON "bet_orders"("state");
-- An authorised Quote backs exactly one Bet Order.
CREATE UNIQUE INDEX "bet_orders_quote_id_key" ON "bet_orders"("quote_id");
CREATE UNIQUE INDEX "bet_orders_idempotency_scope_idempotency_key_key"
  ON "bet_orders"("idempotency_scope", "idempotency_key");

CREATE INDEX "bet_order_lines_bet_type_version_id_idx" ON "bet_order_lines"("bet_type_version_id");
CREATE UNIQUE INDEX "bet_order_lines_order_id_bet_type_id_canonical_number_key"
  ON "bet_order_lines"("order_id", "bet_type_id", "canonical_number");

-- Exactly one Receipt per confirmed Order.
CREATE UNIQUE INDEX "bet_receipts_order_id_key" ON "bet_receipts"("order_id");
CREATE INDEX "bet_receipts_member_id_issued_at_idx" ON "bet_receipts"("member_id", "issued_at");

ALTER TABLE "bet_orders"
  ADD CONSTRAINT "bet_orders_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bet_orders"
  ADD CONSTRAINT "bet_orders_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "betting_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bet_orders"
  ADD CONSTRAINT "bet_orders_draw_id_fkey"
  FOREIGN KEY ("draw_id") REFERENCES "lottery_draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bet_order_lines"
  ADD CONSTRAINT "bet_order_lines_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "bet_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bet_receipts"
  ADD CONSTRAINT "bet_receipts_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "bet_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A Bet Receipt is the immutable record of the accepted terms at confirmation.
-- Posted receipts are never edited or deleted, so a later configuration or Draw
-- change can never rewrite what the Member accepted.
CREATE OR REPLACE FUNCTION "protect_bet_receipt_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Bet Receipts are immutable';
END
$$;

CREATE TRIGGER "bet_receipts_immutable"
BEFORE UPDATE OR DELETE ON "bet_receipts"
FOR EACH ROW EXECUTE FUNCTION "protect_bet_receipt_immutability"();

-- Betting Quote persistence (Issue 44). A Quote is the server-authoritative
-- resolution of a Member's bet lines against a Draw's effective configuration:
-- aggregated normalized lines, resolved payout/limits/restrictions, total and
-- expiry. Creation is idempotent by a scoped Idempotency-Key. Additive and
-- backward-compatible with the existing v1 schema.

CREATE TABLE "betting_quotes" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "total_stake_minor" BIGINT NOT NULL,
    "cutoff_at" TIMESTAMP(3) NOT NULL,
    "server_now" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUOTED',
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "request_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "betting_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "betting_quotes_currency_check" CHECK ("currency" IN ('THB')),
    CONSTRAINT "betting_quotes_status_check" CHECK ("status" IN ('QUOTED','EXPIRED','INVALIDATED')),
    CONSTRAINT "betting_quotes_expiry_check" CHECK ("expires_at" > "server_now"),
    CONSTRAINT "betting_quotes_cutoff_check" CHECK ("cutoff_at" >= "server_now"),
    CONSTRAINT "betting_quotes_total_stake_check" CHECK ("total_stake_minor" >= 0)
);

CREATE UNIQUE INDEX "betting_quotes_idempotency_scope_idempotency_key_key"
  ON "betting_quotes"("idempotency_scope", "idempotency_key");
CREATE INDEX "betting_quotes_member_id_created_at_idx" ON "betting_quotes"("member_id", "created_at");
CREATE INDEX "betting_quotes_draw_id_idx" ON "betting_quotes"("draw_id");

CREATE TABLE "betting_quote_lines" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "bet_type_id" UUID NOT NULL,
    "bet_type_code" TEXT NOT NULL,
    "bet_type_version_id" UUID NOT NULL,
    "canonical_number" TEXT NOT NULL,
    "stake_minor" BIGINT NOT NULL,
    "resolved_payout" JSONB NOT NULL,
    "payout_source" TEXT NOT NULL,
    "restrictions" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "betting_quote_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "betting_quote_lines_stake_check" CHECK ("stake_minor" > 0),
    CONSTRAINT "betting_quote_lines_payout_source_check"
      CHECK ("payout_source" IN ('DRAW_OVERRIDE','DRAW_SNAPSHOT'))
);

CREATE UNIQUE INDEX "betting_quote_lines_quote_id_bet_type_id_canonical_number_key"
  ON "betting_quote_lines"("quote_id", "bet_type_id", "canonical_number");
CREATE INDEX "betting_quote_lines_bet_type_version_id_idx" ON "betting_quote_lines"("bet_type_version_id");

ALTER TABLE "betting_quotes"
  ADD CONSTRAINT "betting_quotes_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "betting_quotes"
  ADD CONSTRAINT "betting_quotes_draw_id_fkey"
  FOREIGN KEY ("draw_id") REFERENCES "lottery_draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "betting_quote_lines"
  ADD CONSTRAINT "betting_quote_lines_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "betting_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

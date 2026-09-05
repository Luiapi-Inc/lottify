-- Additive Wallet & Ledger financial-core persistence.

CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "member_id" UUID,
    "system_code" TEXT,
    "bucket" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_accounts_owner_shape_check" CHECK (
      ("kind" = 'MEMBER' AND "member_id" IS NOT NULL AND "system_code" IS NULL AND "bucket" IN ('CASH', 'BONUS', 'LOCKED'))
      OR
      ("kind" = 'SYSTEM' AND "member_id" IS NULL AND "system_code" IS NOT NULL AND "bucket" IS NULL)
    ),
    CONSTRAINT "ledger_accounts_currency_check" CHECK ("currency" = 'THB')
);

CREATE TABLE "financial_transactions" (
    "id" UUID NOT NULL,
    "business_transaction_id" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "domain_references" JSONB NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "effective_at" TIMESTAMP(3) NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correction_kind" TEXT,
    "corrects_transaction_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financial_transactions_currency_check" CHECK ("currency" = 'THB'),
    CONSTRAINT "financial_transactions_correction_check" CHECK (
      ("correction_kind" IS NULL AND "corrects_transaction_id" IS NULL)
      OR
      ("correction_kind" IN ('REVERSAL', 'COMPENSATION') AND "corrects_transaction_id" IS NOT NULL)
    )
);

CREATE TABLE "ledger_postings" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_postings_side_check" CHECK ("side" IN ('DEBIT', 'CREDIT')),
    CONSTRAINT "ledger_postings_amount_check" CHECK ("amount_minor" > 0)
);

CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "business_reference" TEXT NOT NULL,
    "member_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "amount_minor" BIGINT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "released_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "consuming_transaction_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reservations_purpose_check" CHECK ("purpose" IN ('BET', 'WITHDRAWAL')),
    CONSTRAINT "reservations_currency_check" CHECK ("currency" = 'THB'),
    CONSTRAINT "reservations_amount_check" CHECK ("amount_minor" > 0),
    CONSTRAINT "reservations_terminal_shape_check" CHECK (
      NOT ("released_at" IS NOT NULL AND "consumed_at" IS NOT NULL)
      AND (("consumed_at" IS NULL AND "consuming_transaction_id" IS NULL) OR ("consumed_at" IS NOT NULL AND "consuming_transaction_id" IS NOT NULL))
    )
);

CREATE TABLE "reservation_allocations" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reservation_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reservation_allocations_amount_check" CHECK ("amount_minor" > 0)
);

CREATE UNIQUE INDEX "ledger_accounts_member_id_bucket_currency_key" ON "ledger_accounts"("member_id", "bucket", "currency");
CREATE UNIQUE INDEX "ledger_accounts_system_code_currency_key" ON "ledger_accounts"("system_code", "currency");
CREATE INDEX "ledger_accounts_member_id_currency_idx" ON "ledger_accounts"("member_id", "currency");

CREATE UNIQUE INDEX "financial_transactions_idempotency_scope_idempotency_key_key" ON "financial_transactions"("idempotency_scope", "idempotency_key");
CREATE INDEX "financial_transactions_business_transaction_id_idx" ON "financial_transactions"("business_transaction_id");
CREATE INDEX "financial_transactions_correlation_id_idx" ON "financial_transactions"("correlation_id");
CREATE INDEX "financial_transactions_corrects_transaction_id_idx" ON "financial_transactions"("corrects_transaction_id");

CREATE INDEX "ledger_postings_transaction_id_idx" ON "ledger_postings"("transaction_id");
CREATE INDEX "ledger_postings_account_id_created_at_idx" ON "ledger_postings"("account_id", "created_at");

CREATE UNIQUE INDEX "reservations_purpose_business_reference_key" ON "reservations"("purpose", "business_reference");
CREATE UNIQUE INDEX "reservations_idempotency_scope_idempotency_key_key" ON "reservations"("idempotency_scope", "idempotency_key");
CREATE INDEX "reservations_member_id_released_at_consumed_at_idx" ON "reservations"("member_id", "released_at", "consumed_at");
CREATE INDEX "reservations_consuming_transaction_id_idx" ON "reservations"("consuming_transaction_id");

CREATE UNIQUE INDEX "reservation_allocations_reservation_id_account_id_key" ON "reservation_allocations"("reservation_id", "account_id");
CREATE INDEX "reservation_allocations_account_id_reservation_id_idx" ON "reservation_allocations"("account_id", "reservation_id");

ALTER TABLE "financial_transactions"
ADD CONSTRAINT "financial_transactions_corrects_transaction_id_fkey"
FOREIGN KEY ("corrects_transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_postings"
ADD CONSTRAINT "ledger_postings_transaction_id_fkey"
FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_postings"
ADD CONSTRAINT "ledger_postings_account_id_fkey"
FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reservations"
ADD CONSTRAINT "reservations_consuming_transaction_id_fkey"
FOREIGN KEY ("consuming_transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reservation_allocations"
ADD CONSTRAINT "reservation_allocations_reservation_id_fkey"
FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reservation_allocations"
ADD CONSTRAINT "reservation_allocations_account_id_fkey"
FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

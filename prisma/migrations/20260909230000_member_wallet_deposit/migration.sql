-- Member Wallet + Deposit vertical (vertical 2).
-- A Deposit is the Member-facing initiation lifecycle of an external deposit.
-- It is idempotent by a scoped Idempotency-Key (principal + operation), and
-- records provider identity (provider reference key / transaction id) separately
-- from business identity so an ambiguous provider outcome is never re-initiated
-- or credited blindly. The authoritative Wallet credit is a Ledger DEPOSIT_CREDIT
-- posting owned by Wallet & Ledger; this table only holds Payments orchestration
-- state and its Ledger result reference.

CREATE TABLE "payment_deposits" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_code" TEXT NOT NULL,
    "method_code" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" TEXT NOT NULL,
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "provider_reference_key" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "request_attempt_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "ledger_transaction_id" UUID,
    "incoming_provider_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_deposits_status_check"
        CHECK ("status" IN ('INITIATED', 'PENDING', 'REVIEW_REQUIRED', 'COMPLETED', 'REJECTED')),
    CONSTRAINT "payment_deposits_amount_check" CHECK ("amount_minor" > 0),
    CONSTRAINT "payment_deposits_currency_check" CHECK ("currency" IN ('THB'))
);

CREATE UNIQUE INDEX "payment_deposits_idempotency_scope_key_key"
    ON "payment_deposits"("idempotency_scope", "idempotency_key");
CREATE INDEX "payment_deposits_member_id_created_at_idx"
    ON "payment_deposits"("member_id", "created_at");
CREATE INDEX "payment_deposits_provider_reference_key_idx"
    ON "payment_deposits"("provider_reference_key");

ALTER TABLE "payment_deposits"
ADD CONSTRAINT "payment_deposits_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
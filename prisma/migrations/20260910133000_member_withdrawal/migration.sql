-- Member API Withdrawal vertical (vertical 5).
-- Payments owns Withdrawal orchestration and Payout Destination state; Wallet &
-- Ledger remains the sole balance authority (reservation on withdrawal create,
-- consumption + WITHDRAWAL_FINALIZE posting on finalization). The Withdrawal
-- table stores orchestration state, provider identity separate from business
-- identity, and the Ledger result references; the event table is the durable
-- workflow timeline. Ambiguous provider outcomes are recorded explicitly so a
-- blind payout retry can never be constructed from persisted state.
--
-- Raw destination account references are never persisted: only an opaque digest
-- (duplicate detection) plus the masked display value.

CREATE TABLE "payout_destinations" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_number_masked" TEXT NOT NULL,
    "account_digest" TEXT NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" TEXT NOT NULL,
    "verification_evidence_ref" TEXT,
    "verified_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payout_destinations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payout_destinations_status_check"
        CHECK ("status" IN ('PENDING', 'VERIFIED', 'REJECTED')),
    CONSTRAINT "payout_destinations_type_check" CHECK ("type" IN ('BANK_ACCOUNT')),
    CONSTRAINT "payout_destinations_currency_check" CHECK ("currency" IN ('THB')),
    CONSTRAINT "payout_destinations_verified_at_check"
        CHECK (("status" = 'VERIFIED') = ("verified_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "payout_destinations_member_id_account_digest_key"
    ON "payout_destinations"("member_id", "account_digest");
CREATE INDEX "payout_destinations_member_id_status_created_at_idx"
    ON "payout_destinations"("member_id", "status", "created_at");
CREATE INDEX "payout_destinations_account_digest_idx"
    ON "payout_destinations"("account_digest");

ALTER TABLE "payout_destinations"
ADD CONSTRAINT "payout_destinations_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_withdrawals" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "payout_destination_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "eligibility_outcome" TEXT NOT NULL,
    "eligibility_policy_version" TEXT NOT NULL,
    "eligibility_reason_codes" JSONB NOT NULL DEFAULT '[]',
    "eligibility_evidence_refs" JSONB NOT NULL DEFAULT '[]',
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "reservation_id" UUID,
    "provider_id" TEXT NOT NULL,
    "provider_reference_key" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "payout_evidence_ref" TEXT,
    "ledger_transaction_id" UUID,
    "reconciliation_attempts" INTEGER NOT NULL DEFAULT 0,
    "decided_by_admin_id" UUID,
    "decision_reason" TEXT,
    "failure_reason" TEXT,
    "incoming_provider_error" TEXT,
    "correlation_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_withdrawals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_withdrawals_state_check"
        CHECK ("state" IN ('REQUESTED', 'RESERVING', 'REVIEWING', 'APPROVED',
                           'PAYOUT_PROCESSING', 'PAYOUT_CONFIRMED', 'FINALIZING',
                           'COMPLETED', 'CANCELLING', 'CANCELLED', 'REJECTED',
                           'FAILED', 'RECONCILING')),
    CONSTRAINT "payment_withdrawals_eligibility_outcome_check"
        CHECK ("eligibility_outcome" IN ('ALLOW', 'REVIEW_REQUIRED', 'DENY')),
    CONSTRAINT "payment_withdrawals_amount_check" CHECK ("amount_minor" > 0),
    CONSTRAINT "payment_withdrawals_fee_check" CHECK ("fee_minor" >= 0),
    CONSTRAINT "payment_withdrawals_currency_check" CHECK ("currency" IN ('THB')),
    CONSTRAINT "payment_withdrawals_reservation_check"
        CHECK ("state" IN ('REQUESTED', 'REJECTED') OR "reservation_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "payment_withdrawals_idempotency_scope_idempotency_key_key"
    ON "payment_withdrawals"("idempotency_scope", "idempotency_key");
CREATE INDEX "payment_withdrawals_member_id_created_at_idx"
    ON "payment_withdrawals"("member_id", "created_at");
CREATE INDEX "payment_withdrawals_state_created_at_idx"
    ON "payment_withdrawals"("state", "created_at");
CREATE INDEX "payment_withdrawals_provider_reference_key_idx"
    ON "payment_withdrawals"("provider_reference_key");

ALTER TABLE "payment_withdrawals"
ADD CONSTRAINT "payment_withdrawals_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_withdrawals"
ADD CONSTRAINT "payment_withdrawals_payout_destination_id_fkey"
FOREIGN KEY ("payout_destination_id") REFERENCES "payout_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_withdrawal_events" (
    "id" UUID NOT NULL,
    "withdrawal_id" UUID NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "evidence_ref" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_withdrawal_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_withdrawal_events_actor_type_check"
        CHECK ("actor_type" IN ('MEMBER', 'ADMIN', 'SYSTEM', 'PROVIDER'))
);

CREATE INDEX "payment_withdrawal_events_withdrawal_id_created_at_idx"
    ON "payment_withdrawal_events"("withdrawal_id", "created_at");

ALTER TABLE "payment_withdrawal_events"
ADD CONSTRAINT "payment_withdrawal_events_withdrawal_id_fkey"
FOREIGN KEY ("withdrawal_id") REFERENCES "payment_withdrawals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

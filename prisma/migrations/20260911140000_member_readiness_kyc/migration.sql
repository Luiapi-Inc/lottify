-- Member capability readiness + KYC eligibility persistence (Issue 66).
-- Additive and backward-compatible with the v1 schema.
--
-- The database enforces the Ticket 06 invariants:
--   * capability restrictions are independent per-capability controls with
--     source, reason, effective period and an actor-or-policy reference,
--   * verification records carry explicit per-type freshness semantics and an
--     expired verification is never treated as valid,
--   * KYC state is a single canonical, provider-independent outcome per Member.

-- Capability restrictions ----------------------------------------------

CREATE TABLE "member_capability_restrictions" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "actor_or_policy_ref" TEXT NOT NULL,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_capability_restrictions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_capability_restrictions_type_check" CHECK (
        "type" IN ('BET_BLOCKED','WITHDRAWAL_BLOCKED','DEPOSIT_BLOCKED','LOGIN_BLOCKED','PROMOTION_BLOCKED')
    ),
    CONSTRAINT "member_capability_restrictions_source_check" CHECK (btrim("source") <> ''),
    CONSTRAINT "member_capability_restrictions_reason_check" CHECK (btrim("reason") <> ''),
    CONSTRAINT "member_capability_restrictions_actor_policy_check" CHECK (btrim("actor_or_policy_ref") <> ''),
    CONSTRAINT "member_capability_restrictions_effective_check"
        CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from")
);

CREATE INDEX "member_capability_restrictions_member_id_idx"
    ON "member_capability_restrictions"("member_id");
CREATE INDEX "member_capability_restrictions_member_id_type_effective_fro_idx"
    ON "member_capability_restrictions"("member_id", "type", "effective_from");

ALTER TABLE "member_capability_restrictions" ADD CONSTRAINT "member_capability_restrictions_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Verification records --------------------------------------------------

CREATE TABLE "member_verification_records" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3),
    "reverification_policy_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_verification_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_verification_records_type_check" CHECK (
        "type" IN ('KYC','PHONE','DEVICE','PAYOUT_DESTINATION')
    ),
    CONSTRAINT "member_verification_records_source_check" CHECK (btrim("source") <> ''),
    CONSTRAINT "member_verification_records_expiry_check"
        CHECK ("expires_at" IS NULL OR "expires_at" > "verified_at")
);

CREATE INDEX "member_verification_records_member_id_idx"
    ON "member_verification_records"("member_id");
CREATE INDEX "member_verification_records_member_id_type_verified_at_idx"
    ON "member_verification_records"("member_id", "type", "verified_at");

ALTER TABLE "member_verification_records" ADD CONSTRAINT "member_verification_records_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Normalized KYC state --------------------------------------------------

CREATE TABLE "member_kyc_status" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "member_kyc_status_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_kyc_status_outcome_check" CHECK (
        "outcome" IN ('VERIFIED','REJECTED','REVIEW_REQUIRED','MORE_INFO_REQUIRED')
    ),
    CONSTRAINT "member_kyc_status_policy_version_check" CHECK (btrim("policy_version") <> ''),
    CONSTRAINT "member_kyc_status_source_check" CHECK (btrim("source") <> ''),
    CONSTRAINT "member_kyc_status_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "member_kyc_status_member_id_key" ON "member_kyc_status"("member_id");

ALTER TABLE "member_kyc_status" ADD CONSTRAINT "member_kyc_status_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

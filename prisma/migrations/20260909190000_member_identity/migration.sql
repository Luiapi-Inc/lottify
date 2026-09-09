-- Member identity foundation for the first Member API vertical (Issue 31).
-- Phone is the canonical Member login identity; email is profile data only.
-- OTP challenges are stored hashed server-side with purpose scoping, expiry,
-- attempt and resend-cooldown bounds. Member devices are first-class logical
-- records owned by a Member; they never prove identity on their own.

CREATE TABLE "members" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "members_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED'))
);

CREATE UNIQUE INDEX "members_phone_key" ON "members"("phone");

CREATE TABLE "member_devices" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "member_devices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "member_devices_member_id_idx" ON "member_devices"("member_id");

ALTER TABLE "member_devices"
ADD CONSTRAINT "member_devices_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "member_otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "member_id" UUID,
    "code_hash" TEXT NOT NULL,
    "attempts_used" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "cooldown_until" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_otp_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_otp_challenges_purpose_check"
    CHECK ("purpose" IN ('LOGIN', 'REGISTER', 'REAUTH')),
    CONSTRAINT "member_otp_challenges_attempts_check" CHECK ("attempts_used" >= 0)
);

CREATE INDEX "member_otp_challenges_phone_purpose_created_at_idx"
ON "member_otp_challenges"("phone", "purpose", "created_at");
CREATE INDEX "member_otp_challenges_member_id_idx" ON "member_otp_challenges"("member_id");

ALTER TABLE "member_otp_challenges"
ADD CONSTRAINT "member_otp_challenges_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

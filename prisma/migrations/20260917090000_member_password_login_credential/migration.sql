-- CR #141: the Member login channel changes from phone + OTP to phone +
-- password. This migration is additive and backward compatible: it never
-- removes or rewrites existing Member rows, so a pre-CR Member (or a Member
-- created by the G2->G3 cutover ETL) keeps its account and simply has
-- `password_hash IS NULL` until the Member completes password enrollment.
--
-- `password_hash` stores the shared `scrypt-v1$<salt>$<key>` encoding produced by
-- src/contexts/identity-access/domain/password-hash.ts — the same format and
-- verification path as Admin credentials. Plaintext is never persisted.
--
-- The login lockout columns back the bounded brute-force defence on the new
-- password channel. Existing rows default to "no failures, not locked".
ALTER TABLE "members"
  ADD COLUMN "password_hash"         TEXT,
  ADD COLUMN "password_updated_at"   TIMESTAMP(3),
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until"          TIMESTAMP(3);

-- `PASSWORD_ENROLL` becomes a first-class OTP purpose (one-time credential
-- enrollment for Members that have no password yet). `LOGIN` is deliberately
-- retained in the CHECK: it is no longer issued or accepted by the API, but
-- historical challenge rows written before this change must stay readable and
-- a migration must never fail on existing data or rewrite audit history.
ALTER TABLE "member_otp_challenges"
  DROP CONSTRAINT "member_otp_challenges_purpose_check";

ALTER TABLE "member_otp_challenges"
  ADD CONSTRAINT "member_otp_challenges_purpose_check"
  CHECK ("purpose" IN ('LOGIN', 'REGISTER', 'PASSWORD_ENROLL', 'REAUTH', 'RECOVERY'));

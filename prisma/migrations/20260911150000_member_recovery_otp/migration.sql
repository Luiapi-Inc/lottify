-- Extend the Member OTP purpose constraint for recovery possession evidence.
-- RECOVERY remains possession evidence only; it does not establish authentication.
ALTER TABLE "member_otp_challenges"
  DROP CONSTRAINT "member_otp_challenges_purpose_check";

ALTER TABLE "member_otp_challenges"
  ADD CONSTRAINT "member_otp_challenges_purpose_check"
  CHECK ("purpose" IN ('LOGIN', 'REGISTER', 'REAUTH', 'RECOVERY'));

-- Operator decision 2026-09-17 (supersedes the earlier E.164 convention): the
-- Member phone is stored in the plain local Thai form `0XXXXXXXXX` with no
-- country code and no `66` prefix anywhere in the system. Input is still
-- accepted in international spelling and converted at the API boundary
-- (src/contexts/identity-access/domain/identity-phone.ts); the SMS provider
-- request is the single place that carries the country code.
--
-- 1) Convert existing stored numbers. Only rows in the exact `+66XXXXXXXXX`
--    spelling are touched; anything else was never a canonical number and is
--    left untouched rather than guessed at. The conversion cannot merge two
--    Members into one identity: the guard below fails the migration (rather than
--    letting the unique index explode mid-update) when the local form of a legacy
--    number is already taken by another row.
DO $$
DECLARE collisions integer;
BEGIN
  SELECT count(*) INTO collisions
  FROM "members" legacy
  JOIN "members" existing
    ON existing.phone = '0' || substring(legacy.phone from 4)
   AND existing.id <> legacy.id
  WHERE legacy.phone ~ '^\+66[0-9]{9}$';

  IF collisions > 0 THEN
    RAISE EXCEPTION
      'Member phone normalization would merge % legacy row(s) into an existing local-format phone',
      collisions;
  END IF;
END $$;

UPDATE "members"
   SET phone = '0' || substring(phone from 4)
 WHERE phone ~ '^\+66[0-9]{9}$';

UPDATE "member_otp_challenges"
   SET phone = '0' || substring(phone from 4)
 WHERE phone ~ '^\+66[0-9]{9}$';

-- 2) Enforce the canonical stored form for every new write. The constraints are
--    added NOT VALID on purpose: environments that already hold non-canonical
--    fixture rows (integration fixtures written directly to the database before
--    this decision) must not block the migration, while every INSERT/UPDATE from
--    now on is rejected unless the phone is `0XXXXXXXXX`. Validating the
--    constraints across historical rows is a separate, deliberate step once
--    those fixtures are cleaned up.
ALTER TABLE "members"
  ADD CONSTRAINT "members_phone_local_format_check"
  CHECK (phone ~ '^0[2-9][0-9]{8}$') NOT VALID;

ALTER TABLE "member_otp_challenges"
  ADD CONSTRAINT "member_otp_challenges_phone_local_format_check"
  CHECK (phone ~ '^0[2-9][0-9]{8}$') NOT VALID;

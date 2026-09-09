-- Member auth session family tracking (Ticket 10 refresh-reuse revocation).
-- Mirrors the Admin auth-session family model: each rotating refresh lineage is
-- a family; the current (latest) row holds the live refresh token hash and every
-- rotated-away row keeps its own hash marked replaced. A replayed/rotated token
-- is therefore still findable and its whole family can be revoked.
--
-- Additive only. Existing member sessions are backfilled into their own family
-- (family_id = id) so prior live sessions keep working and get real family
-- semantics going forward.

ALTER TABLE "auth_sessions" ADD COLUMN "family_id" UUID;
ALTER TABLE "auth_sessions" ADD COLUMN "replaced_by_id" UUID;

-- Backfill: every pre-existing row becomes the current member of its own family.
UPDATE "auth_sessions" SET "family_id" = "id" WHERE "family_id" IS NULL;

ALTER TABLE "auth_sessions" ALTER COLUMN "family_id" SET NOT NULL;

CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");
CREATE INDEX "auth_sessions_replaced_by_id_idx" ON "auth_sessions"("replaced_by_id");

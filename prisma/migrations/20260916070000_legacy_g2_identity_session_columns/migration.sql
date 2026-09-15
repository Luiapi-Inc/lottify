-- G2 -> G3 cutover storage, schema lane step S1 (decisions D1, D2, D4).
--
-- Why: the cutover ETL carries facts that have no column in the G3 model. Without them the loss is
-- irreversible at cutover, because the legacy rows are dropped after a full business cycle.
--
-- D1 "members"."legacy_email"            <- G2 "users"."email"            (identity: G2 = email+password, G3 = phone+OTP)
-- D2 "members"."deleted_at"              <- G2 "users"."deleted_at"       (soft-deletion fact)
-- D4 "auth_sessions"."ip_address"        <- G2 "refresh_tokens"."ip_address"
-- D4 "auth_sessions"."user_agent"        <- G2 "refresh_tokens"."user_agent"
--
-- Additive and nullable only: no rename, no drop, no type change, no default, so every existing G3
-- row and code path is unaffected. `legacy_email` is UNIQUE so one legacy address can never attach
-- to two Members; NULLs stay unbounded (Postgres treats NULLs as distinct in a unique index), so
-- G3-native Members keep working unchanged.
--
-- No data backfill here by design: the values arrive through the cutover ETL, which is not in the
-- repo yet. `device_id` is deliberately NOT repurposed for session forensics (D4 ruling upheld).

ALTER TABLE "members"
  ADD COLUMN "legacy_email" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "members_legacy_email_key" ON "members"("legacy_email");

ALTER TABLE "auth_sessions"
  ADD COLUMN "ip_address" TEXT,
  ADD COLUMN "user_agent" TEXT;

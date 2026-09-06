-- Lottery configuration versions are immutable once published. Draws will snapshot
-- these records in a later work package; this migration does not introduce Draw state.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "lottery_products" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lottery_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lottery_bet_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lottery_bet_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lottery_bet_type_versions" (
    "id" UUID NOT NULL,
    "bet_type_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL,
    "canonical_number_format" TEXT NOT NULL,
    "validation_pattern" TEXT NOT NULL,
    "default_payout" JSONB NOT NULL,
    "min_stake_minor" BIGINT NOT NULL,
    "max_stake_minor" BIGINT NOT NULL,
    "limit_policy_ref" TEXT NOT NULL,
    "restriction_policy_ref" TEXT NOT NULL,
    "settlement_rule_version_ref" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "reason" TEXT,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lottery_bet_type_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lottery_bet_type_versions_state_check" CHECK ("state" IN ('DRAFT', 'REVIEW', 'PUBLISHED')),
    CONSTRAINT "lottery_bet_type_versions_stake_bounds_check" CHECK ("min_stake_minor" >= 0 AND "max_stake_minor" >= "min_stake_minor"),
    CONSTRAINT "lottery_bet_type_versions_effective_bounds_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
    CONSTRAINT "lottery_bet_type_versions_refs_check" CHECK (
      btrim("canonical_number_format") <> '' AND btrim("validation_pattern") <> ''
      AND btrim("limit_policy_ref") <> '' AND btrim("restriction_policy_ref") <> ''
      AND btrim("settlement_rule_version_ref") <> ''
    )
);

CREATE TABLE "lottery_product_versions" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "schedule_template_ref" TEXT NOT NULL,
    "result_schema_version_ref" TEXT NOT NULL,
    "settlement_rule_version_ref" TEXT NOT NULL,
    "default_payout_policy_ref" TEXT NOT NULL,
    "default_limit_policy_ref" TEXT NOT NULL,
    "default_restriction_policy_ref" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "reason" TEXT,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lottery_product_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lottery_product_versions_state_check" CHECK ("state" IN ('DRAFT', 'REVIEW', 'PUBLISHED')),
    CONSTRAINT "lottery_product_versions_effective_bounds_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
    CONSTRAINT "lottery_product_versions_refs_check" CHECK (
      btrim("timezone") <> '' AND btrim("schedule_template_ref") <> ''
      AND btrim("result_schema_version_ref") <> '' AND btrim("settlement_rule_version_ref") <> ''
      AND btrim("default_payout_policy_ref") <> '' AND btrim("default_limit_policy_ref") <> ''
      AND btrim("default_restriction_policy_ref") <> ''
    )
);

CREATE TABLE "lottery_product_version_bet_types" (
    "product_version_id" UUID NOT NULL,
    "bet_type_id" UUID NOT NULL,
    "bet_type_version_id" UUID NOT NULL,
    CONSTRAINT "lottery_product_version_bet_types_pkey" PRIMARY KEY ("product_version_id", "bet_type_id")
);

CREATE UNIQUE INDEX "lottery_bet_types_code_key" ON "lottery_bet_types"("code");
CREATE UNIQUE INDEX "lottery_bet_type_versions_bet_type_id_version_key" ON "lottery_bet_type_versions"("bet_type_id", "version");
CREATE UNIQUE INDEX "lottery_product_versions_product_id_version_key" ON "lottery_product_versions"("product_id", "version");
CREATE UNIQUE INDEX "lottery_product_version_bet_types_product_version_id_bet_type_version_id_key" ON "lottery_product_version_bet_types"("product_version_id", "bet_type_version_id");
CREATE INDEX "lottery_bet_type_versions_state_effective_from_effective_until_idx" ON "lottery_bet_type_versions"("state", "effective_from", "effective_until");
CREATE INDEX "lottery_bet_type_versions_bet_type_id_state_effective_from_idx" ON "lottery_bet_type_versions"("bet_type_id", "state", "effective_from");
CREATE INDEX "lottery_product_versions_state_effective_from_effective_until_idx" ON "lottery_product_versions"("state", "effective_from", "effective_until");
CREATE INDEX "lottery_product_versions_product_id_state_effective_from_idx" ON "lottery_product_versions"("product_id", "state", "effective_from");
CREATE INDEX "lottery_product_version_bet_types_bet_type_id_bet_type_version_id_idx" ON "lottery_product_version_bet_types"("bet_type_id", "bet_type_version_id");

ALTER TABLE "lottery_bet_type_versions"
  ADD CONSTRAINT "lottery_bet_type_versions_bet_type_id_fkey"
  FOREIGN KEY ("bet_type_id") REFERENCES "lottery_bet_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lottery_bet_type_versions"
  ADD CONSTRAINT "lottery_bet_type_versions_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lottery_product_versions"
  ADD CONSTRAINT "lottery_product_versions_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "lottery_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lottery_product_versions"
  ADD CONSTRAINT "lottery_product_versions_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lottery_product_version_bet_types"
  ADD CONSTRAINT "lottery_product_version_bet_types_product_version_id_fkey"
  FOREIGN KEY ("product_version_id") REFERENCES "lottery_product_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lottery_product_version_bet_types_bet_type_id_fkey"
  FOREIGN KEY ("bet_type_id") REFERENCES "lottery_bet_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lottery_product_version_bet_types_bet_type_version_id_fkey"
  FOREIGN KEY ("bet_type_version_id") REFERENCES "lottery_bet_type_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lottery_product_versions"
  ADD CONSTRAINT "lottery_product_versions_published_effective_range_excl"
  EXCLUDE USING gist ("product_id" WITH =, tsrange("effective_from", "effective_until", '[)') WITH &&)
  WHERE ("state" = 'PUBLISHED');
ALTER TABLE "lottery_bet_type_versions"
  ADD CONSTRAINT "lottery_bet_type_versions_published_effective_range_excl"
  EXCLUDE USING gist ("bet_type_id" WITH =, tsrange("effective_from", "effective_until", '[)') WITH &&)
  WHERE ("state" = 'PUBLISHED');

CREATE OR REPLACE FUNCTION "enforce_lottery_product_version_bet_type_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "lottery_bet_type_versions" version
    WHERE version."id" = NEW."bet_type_version_id"
      AND version."bet_type_id" = NEW."bet_type_id"
  ) THEN
    RAISE EXCEPTION 'Lottery Product version references a Bet Type version from a different Bet Type';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "lottery_product_version_bet_type_identity"
BEFORE INSERT OR UPDATE OF "bet_type_id", "bet_type_version_id"
ON "lottery_product_version_bet_types"
FOR EACH ROW EXECUTE FUNCTION "enforce_lottery_product_version_bet_type_identity"();

CREATE OR REPLACE FUNCTION "protect_published_lottery_configuration_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."state" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published Lottery configuration versions are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "lottery_product_versions_published_immutable"
BEFORE UPDATE OR DELETE ON "lottery_product_versions"
FOR EACH ROW EXECUTE FUNCTION "protect_published_lottery_configuration_version"();
CREATE TRIGGER "lottery_bet_type_versions_published_immutable"
BEFORE UPDATE OR DELETE ON "lottery_bet_type_versions"
FOR EACH ROW EXECUTE FUNCTION "protect_published_lottery_configuration_version"();

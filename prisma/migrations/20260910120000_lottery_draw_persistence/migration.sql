-- Lottery Draw persistence: the Draw aggregate snapshots the effective published
-- Product/Bet-Type configuration at creation time so historical Draws remain
-- reproducible and are never reinterpreted through a later configuration version.
-- Additive and backward-compatible with the existing v1 schema.

CREATE TABLE "lottery_draws" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "occurrence_identity" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "open_at" TIMESTAMP(3) NOT NULL,
    "cutoff_at" TIMESTAMP(3) NOT NULL,
    "draw_at" TIMESTAMP(3) NOT NULL,
    "provenance" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "schedule_template_ref" TEXT NOT NULL,
    "result_schema_version_ref" TEXT NOT NULL,
    "settlement_rule_version_ref" TEXT NOT NULL,
    "default_payout_policy_ref" TEXT NOT NULL,
    "default_limit_policy_ref" TEXT NOT NULL,
    "default_restriction_policy_ref" TEXT NOT NULL,
    "result_source_ref" TEXT,
    "override_revision_ref" TEXT NOT NULL DEFAULT '',
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lottery_draws_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lottery_draws_state_check" CHECK ("state" IN (
        'DRAFT','SCHEDULED','OPEN','CLOSED','RESULT_PENDING',
        'RESULT_CONFIRMED','SETTLING','SETTLED','CANCELLING','CANCELLED'
    )),
    CONSTRAINT "lottery_draws_time_bounds_check" CHECK (
        "open_at" < "cutoff_at" AND "cutoff_at" <= "draw_at"
    ),
    CONSTRAINT "lottery_draws_provenance_check" CHECK ("provenance" IN ('SCHEDULE_GENERATED','MANUAL_EXCEPTION')),
    CONSTRAINT "lottery_draws_local_date_check" CHECK ("local_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    CONSTRAINT "lottery_draws_refs_check" CHECK (
        btrim("timezone") <> '' AND btrim("schedule_template_ref") <> ''
        AND btrim("result_schema_version_ref") <> '' AND btrim("settlement_rule_version_ref") <> ''
        AND btrim("default_payout_policy_ref") <> '' AND btrim("default_limit_policy_ref") <> ''
        AND btrim("default_restriction_policy_ref") <> ''
    )
);

CREATE UNIQUE INDEX "lottery_draws_product_id_occurrence_identity_key"
  ON "lottery_draws"("product_id", "occurrence_identity");
CREATE INDEX "lottery_draws_product_id_local_date_idx" ON "lottery_draws"("product_id", "local_date");
CREATE INDEX "lottery_draws_state_cutoff_at_idx" ON "lottery_draws"("state", "cutoff_at");
CREATE INDEX "lottery_draws_cutoff_at_idx" ON "lottery_draws"("cutoff_at");
CREATE INDEX "lottery_draws_product_version_id_idx" ON "lottery_draws"("product_version_id");

CREATE TABLE "lottery_draw_bet_types" (
    "id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "bet_type_id" UUID NOT NULL,
    "bet_type_code" TEXT NOT NULL,
    "bet_type_version_id" UUID NOT NULL,
    "canonical_number_format" TEXT NOT NULL,
    "validation_pattern" TEXT NOT NULL,
    "payout" JSONB NOT NULL,
    "min_stake_minor" BIGINT NOT NULL,
    "max_stake_minor" BIGINT NOT NULL,
    "limit_policy_ref" TEXT NOT NULL,
    "restriction_policy_ref" TEXT NOT NULL,
    "settlement_rule_version_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lottery_draw_bet_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lottery_draw_bet_types_stake_bounds_check" CHECK ("min_stake_minor" >= 0 AND "max_stake_minor" >= "min_stake_minor"),
    CONSTRAINT "lottery_draw_bet_types_refs_check" CHECK (
        btrim("canonical_number_format") <> '' AND btrim("validation_pattern") <> ''
        AND btrim("limit_policy_ref") <> '' AND btrim("restriction_policy_ref") <> ''
        AND btrim("settlement_rule_version_ref") <> ''
    )
);

CREATE UNIQUE INDEX "lottery_draw_bet_types_draw_id_bet_type_id_key"
  ON "lottery_draw_bet_types"("draw_id", "bet_type_id");
CREATE INDEX "lottery_draw_bet_types_bet_type_version_id_idx" ON "lottery_draw_bet_types"("bet_type_version_id");

CREATE TABLE "lottery_draw_overrides" (
    "id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "supersedes_override_id" UUID,
    "baseline_revision_ref" TEXT NOT NULL,
    "baseline_state" TEXT NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_admin_id" UUID NOT NULL,
    "changes" JSONB NOT NULL,
    "diff" JSONB NOT NULL,
    "impact" JSONB NOT NULL,
    "payload_digest" TEXT NOT NULL,
    "approval_evidence_ref" TEXT,
    "audit_evidence_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lottery_draw_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lottery_draw_overrides_status_check" CHECK ("status" IN ('PROPOSED','PUBLISHED','SUPERSEDED')),
    CONSTRAINT "lottery_draw_overrides_published_fields_check" CHECK (
        ("status" = 'PROPOSED' AND "published_at" IS NULL)
        OR ("status" <> 'PROPOSED' AND "published_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "lottery_draw_overrides_draw_id_payload_digest_key"
  ON "lottery_draw_overrides"("draw_id", "payload_digest");
CREATE INDEX "lottery_draw_overrides_draw_id_idx" ON "lottery_draw_overrides"("draw_id");
CREATE INDEX "lottery_draw_overrides_effective_at_idx" ON "lottery_draw_overrides"("effective_at");

ALTER TABLE "lottery_draws"
  ADD CONSTRAINT "lottery_draws_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "lottery_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lottery_draws"
  ADD CONSTRAINT "lottery_draws_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lottery_draw_bet_types"
  ADD CONSTRAINT "lottery_draw_bet_types_draw_id_fkey"
  FOREIGN KEY ("draw_id") REFERENCES "lottery_draws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lottery_draw_overrides"
  ADD CONSTRAINT "lottery_draw_overrides_draw_id_fkey"
  FOREIGN KEY ("draw_id") REFERENCES "lottery_draws"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "lottery_draw_overrides_supersedes_override_id_fkey"
  FOREIGN KEY ("supersedes_override_id") REFERENCES "lottery_draw_overrides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

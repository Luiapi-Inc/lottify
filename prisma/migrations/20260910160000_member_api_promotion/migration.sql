-- Member API — Promotion vertical (Issue 6): versioned Promotion Campaigns,
-- Member Entitlement snapshots, turnover contribution ledger and Member
-- notification preferences. Additive and backward-compatible with the v1 schema.
--
-- The schema enforces the locked Ticket 07 invariants at the database level:
--   * a published Campaign version's terms are immutable,
--   * an Entitlement terms snapshot is immutable,
--   * turnover contribution history is append-only (state transitions only),
--   * a monetary Entitlement state is unreachable without its Ledger linkage.

CREATE TABLE "promotion_campaigns" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promotion_campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_campaigns_code_check" CHECK (btrim("code") <> '')
);

CREATE UNIQUE INDEX "promotion_campaigns_code_key" ON "promotion_campaigns"("code");

CREATE TABLE "promotion_campaign_versions" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "terms_digest" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "reason" TEXT,
    "created_by_admin_id" UUID,
    "published_at" TIMESTAMP(3),
    "published_by_admin_id" UUID,
    "approval_evidence_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promotion_campaign_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_campaign_versions_campaign_fkey" FOREIGN KEY ("campaign_id")
        REFERENCES "promotion_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_campaign_versions_state_check"
        CHECK ("state" IN ('DRAFT','VALIDATED','PUBLISHED','RETIRED')),
    CONSTRAINT "promotion_campaign_versions_version_check" CHECK ("version" >= 1),
    CONSTRAINT "promotion_campaign_versions_digest_check" CHECK ("terms_digest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "promotion_campaign_versions_effective_check"
        CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
    CONSTRAINT "promotion_campaign_versions_published_check"
        CHECK ("state" <> 'PUBLISHED' OR "published_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "promotion_campaign_versions_campaign_id_version_key"
    ON "promotion_campaign_versions"("campaign_id", "version");
CREATE INDEX "promotion_campaign_versions_state_effective_from_effective_until_idx"
    ON "promotion_campaign_versions"("state", "effective_from", "effective_until");

-- A published (or retired) Campaign version is immutable for historical use:
-- its terms, digest, version and effective window can never be rewritten.
CREATE OR REPLACE FUNCTION "promotion_campaign_versions_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."state" IN ('PUBLISHED','RETIRED') THEN
        IF NEW."terms" IS DISTINCT FROM OLD."terms"
            OR NEW."terms_digest" IS DISTINCT FROM OLD."terms_digest"
            OR NEW."version" IS DISTINCT FROM OLD."version"
            OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
            OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
            OR NEW."effective_until" IS DISTINCT FROM OLD."effective_until" THEN
            RAISE EXCEPTION 'published promotion campaign version terms are immutable'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "promotion_campaign_versions_published_immutable"
    BEFORE UPDATE ON "promotion_campaign_versions"
    FOR EACH ROW EXECUTE FUNCTION "promotion_campaign_versions_immutable_guard"();

CREATE TABLE "promotion_entitlements" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "campaign_version_id" UUID NOT NULL,
    "campaign_version" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "terms_snapshot" JSONB NOT NULL,
    "stacking_decision" JSONB NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "reward_minor" BIGINT NOT NULL,
    "turnover_target_minor" BIGINT NOT NULL,
    "released_minor" BIGINT NOT NULL DEFAULT 0,
    "expired_minor" BIGINT NOT NULL DEFAULT 0,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "grant_ledger_transaction_id" UUID,
    "release_ledger_transaction_id" UUID,
    "expiry_ledger_transaction_id" UUID,
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promotion_entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_entitlements_campaign_fkey" FOREIGN KEY ("campaign_id")
        REFERENCES "promotion_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_entitlements_campaign_version_fkey" FOREIGN KEY ("campaign_version_id")
        REFERENCES "promotion_campaign_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_entitlements_state_check"
        CHECK ("state" IN ('ACTIVE','RELEASE_PENDING','COMPLETED','EXPIRED','REVOKED')),
    CONSTRAINT "promotion_entitlements_version_check" CHECK ("version" >= 1),
    CONSTRAINT "promotion_entitlements_campaign_version_check" CHECK ("campaign_version" >= 1),
    CONSTRAINT "promotion_entitlements_amounts_check"
        CHECK ("reward_minor" >= 0 AND "turnover_target_minor" >= 0
            AND "released_minor" >= 0 AND "released_minor" <= "reward_minor"
            AND "expired_minor" >= 0),
    CONSTRAINT "promotion_entitlements_expiry_check" CHECK ("expires_at" > "granted_at"),
    -- No Entitlement can hold value or complete without the authoritative
    -- Wallet & Ledger linkage recorded at that instant.
    CONSTRAINT "promotion_entitlements_grant_requires_ledger" CHECK (
        "state" NOT IN ('ACTIVE','RELEASE_PENDING','COMPLETED')
        OR "grant_ledger_transaction_id" IS NOT NULL
    ),
    CONSTRAINT "promotion_entitlements_completion_requires_release" CHECK (
        "state" <> 'COMPLETED'
        OR ("release_ledger_transaction_id" IS NOT NULL AND "completed_at" IS NOT NULL)
    ),
    CONSTRAINT "promotion_entitlements_expired_check" CHECK (
        "state" <> 'EXPIRED'
        OR ("expired_at" IS NOT NULL
            AND ("expired_minor" = 0 OR "expiry_ledger_transaction_id" IS NOT NULL))
    ),
    CONSTRAINT "promotion_entitlements_revoked_check" CHECK (
        "state" <> 'REVOKED' OR "revoked_at" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "promotion_entitlements_idempotency_scope_idempotency_key_key"
    ON "promotion_entitlements"("idempotency_scope", "idempotency_key");
CREATE UNIQUE INDEX "promotion_entitlements_member_id_campaign_version_id_key"
    ON "promotion_entitlements"("member_id", "campaign_version_id");
CREATE INDEX "promotion_entitlements_member_id_state_expires_at_idx"
    ON "promotion_entitlements"("member_id", "state", "expires_at");
CREATE INDEX "promotion_entitlements_campaign_version_id_idx"
    ON "promotion_entitlements"("campaign_version_id");

-- The snapshotted terms are immutable: a later Campaign change must never
-- rewrite an existing Entitlement.
CREATE OR REPLACE FUNCTION "promotion_entitlements_snapshot_guard"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."terms_snapshot" IS DISTINCT FROM OLD."terms_snapshot"
        OR NEW."stacking_decision" IS DISTINCT FROM OLD."stacking_decision"
        OR NEW."campaign_version_id" IS DISTINCT FROM OLD."campaign_version_id"
        OR NEW."campaign_version" IS DISTINCT FROM OLD."campaign_version"
        OR NEW."campaign_id" IS DISTINCT FROM OLD."campaign_id"
        OR NEW."member_id" IS DISTINCT FROM OLD."member_id"
        OR NEW."reward_minor" IS DISTINCT FROM OLD."reward_minor"
        OR NEW."turnover_target_minor" IS DISTINCT FROM OLD."turnover_target_minor"
        OR NEW."granted_at" IS DISTINCT FROM OLD."granted_at"
        OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
        OR NEW."grant_ledger_transaction_id" IS DISTINCT FROM OLD."grant_ledger_transaction_id" THEN
        RAISE EXCEPTION 'promotion entitlement snapshot is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "promotion_entitlements_snapshot_immutable"
    BEFORE UPDATE ON "promotion_entitlements"
    FOR EACH ROW EXECUTE FUNCTION "promotion_entitlements_snapshot_guard"();

CREATE TABLE "promotion_turnover_entries" (
    "id" UUID NOT NULL,
    "entitlement_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "bet_reference" TEXT NOT NULL,
    "entry_kind" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "contribution_minor" BIGINT NOT NULL,
    "stake_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "scope_reference" JSONB NOT NULL,
    "source_allocation" JSONB NOT NULL,
    "corrects_entry_id" UUID,
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "finalized_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promotion_turnover_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_turnover_entries_entitlement_fkey" FOREIGN KEY ("entitlement_id")
        REFERENCES "promotion_entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_turnover_entries_corrects_fkey" FOREIGN KEY ("corrects_entry_id")
        REFERENCES "promotion_turnover_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_turnover_entries_kind_check" CHECK ("entry_kind" IN ('BET','ADJUSTMENT')),
    CONSTRAINT "promotion_turnover_entries_state_check"
        CHECK ("state" IN ('PROVISIONAL','FINALIZED','REMOVED')),
    CONSTRAINT "promotion_turnover_entries_amount_check" CHECK (
        "stake_minor" > 0
        AND "contribution_minor" <> 0
        AND ("entry_kind" <> 'BET' OR ("contribution_minor" > 0 AND "corrects_entry_id" IS NULL))
        AND ("entry_kind" <> 'ADJUSTMENT' OR "corrects_entry_id" IS NOT NULL)
    ),
    CONSTRAINT "promotion_turnover_entries_lifecycle_check" CHECK (
        ("state" = 'PROVISIONAL' AND "finalized_at" IS NULL AND "removed_at" IS NULL)
        OR ("state" = 'FINALIZED' AND "finalized_at" IS NOT NULL AND "removed_at" IS NULL)
        OR ("state" = 'REMOVED' AND "removed_at" IS NOT NULL AND "finalized_at" IS NULL)
    ),
    CONSTRAINT "promotion_turnover_entries_reference_check" CHECK (btrim("bet_reference") <> '')
);

CREATE UNIQUE INDEX "promotion_turnover_entries_entitlement_id_bet_reference_entry_kind_key"
    ON "promotion_turnover_entries"("entitlement_id", "bet_reference", "entry_kind");
CREATE UNIQUE INDEX "promotion_turnover_entries_idempotency_scope_idempotency_key_key"
    ON "promotion_turnover_entries"("idempotency_scope", "idempotency_key");
CREATE INDEX "promotion_turnover_entries_member_id_bet_reference_idx"
    ON "promotion_turnover_entries"("member_id", "bet_reference");
CREATE INDEX "promotion_turnover_entries_entitlement_id_state_idx"
    ON "promotion_turnover_entries"("entitlement_id", "state");

-- Turnover history is append-only: accepted contribution facts are never
-- rewritten, only their lifecycle state may advance.
CREATE OR REPLACE FUNCTION "promotion_turnover_entries_append_only_guard"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."contribution_minor" IS DISTINCT FROM OLD."contribution_minor"
        OR NEW."stake_minor" IS DISTINCT FROM OLD."stake_minor"
        OR NEW."bet_reference" IS DISTINCT FROM OLD."bet_reference"
        OR NEW."entry_kind" IS DISTINCT FROM OLD."entry_kind"
        OR NEW."entitlement_id" IS DISTINCT FROM OLD."entitlement_id"
        OR NEW."member_id" IS DISTINCT FROM OLD."member_id"
        OR NEW."scope_reference" IS DISTINCT FROM OLD."scope_reference"
        OR NEW."source_allocation" IS DISTINCT FROM OLD."source_allocation"
        OR NEW."corrects_entry_id" IS DISTINCT FROM OLD."corrects_entry_id"
        OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at" THEN
        RAISE EXCEPTION 'promotion turnover contribution history is append-only'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "promotion_turnover_entries_append_only"
    BEFORE UPDATE ON "promotion_turnover_entries"
    FOR EACH ROW EXECUTE FUNCTION "promotion_turnover_entries_append_only_guard"();

CREATE TABLE "member_notification_preferences" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "member_notification_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_notification_preferences_topic_check" CHECK (
        "topic" IN ('TRANSACTIONAL','SECURITY','PROMOTIONAL','RESULT')
    ),
    CONSTRAINT "member_notification_preferences_channel_check" CHECK (
        "channel" IN ('PUSH','SMS','EMAIL')
    ),
    CONSTRAINT "member_notification_preferences_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "member_notification_preferences_member_id_topic_channel_key"
    ON "member_notification_preferences"("member_id", "topic", "channel");
CREATE INDEX "member_notification_preferences_member_id_idx"
    ON "member_notification_preferences"("member_id");

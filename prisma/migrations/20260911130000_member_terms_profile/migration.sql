-- Member onboarding — versioned Member Terms document, immutable Terms
-- acceptance evidence, and the mandatory Member profile fields (Issue 64).
-- Additive and backward-compatible with the v1 schema.
--
-- The database enforces the Ticket 06 / Ticket 11 onboarding invariants:
--   * a published Terms version's content is immutable,
--   * a Member Terms acceptance is immutable evidence (never rewritten),
--   * a Terms version cannot reach PUBLISHED without its publication facts,
--   * a profile field is never stored as blank whitespace.

ALTER TABLE "members" ADD COLUMN "full_name" TEXT;
ALTER TABLE "members" ADD COLUMN "date_of_birth" DATE;
ALTER TABLE "members" ADD COLUMN "province" TEXT;
ALTER TABLE "members" ADD COLUMN "profile_updated_at" TIMESTAMP(3);

ALTER TABLE "members" ADD CONSTRAINT "members_profile_fields_check" CHECK (
    ("full_name" IS NULL OR btrim("full_name") <> '')
    AND ("province" IS NULL OR btrim("province") <> '')
);

CREATE TABLE "member_terms_documents" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "content_digest" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "reason" TEXT,
    "created_by_admin_id" UUID,
    "published_at" TIMESTAMP(3),
    "published_by_admin_id" UUID,
    "approval_evidence_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "member_terms_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_terms_documents_code_check" CHECK (btrim("code") <> ''),
    CONSTRAINT "member_terms_documents_state_check"
        CHECK ("state" IN ('DRAFT','PUBLISHED','RETIRED')),
    CONSTRAINT "member_terms_documents_version_check" CHECK ("version" >= 1),
    CONSTRAINT "member_terms_documents_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "member_terms_documents_digest_check"
        CHECK ("content_digest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "member_terms_documents_content_check"
        CHECK (btrim("title") <> '' AND btrim("body") <> ''),
    CONSTRAINT "member_terms_documents_effective_check"
        CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
    CONSTRAINT "member_terms_documents_published_check"
        CHECK ("state" <> 'PUBLISHED' OR "published_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "member_terms_documents_code_version_key"
    ON "member_terms_documents"("code", "version");
CREATE INDEX "member_terms_documents_state_effective_from_effective_until_idx"
    ON "member_terms_documents"("state", "effective_from", "effective_until");

-- A published (or retired) Terms version is immutable for historical use: the
-- text a Member accepted can never be rewritten after the fact.
CREATE OR REPLACE FUNCTION "member_terms_documents_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."state" IN ('PUBLISHED','RETIRED') THEN
        IF NEW."body" IS DISTINCT FROM OLD."body"
            OR NEW."title" IS DISTINCT FROM OLD."title"
            OR NEW."content_digest" IS DISTINCT FROM OLD."content_digest"
            OR NEW."code" IS DISTINCT FROM OLD."code"
            OR NEW."version" IS DISTINCT FROM OLD."version"
            OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
            OR NEW."effective_until" IS DISTINCT FROM OLD."effective_until" THEN
            RAISE EXCEPTION 'published member terms document content is immutable'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "member_terms_documents_published_immutable"
    BEFORE UPDATE ON "member_terms_documents"
    FOR EACH ROW EXECUTE FUNCTION "member_terms_documents_immutable_guard"();

CREATE TABLE "member_terms_acceptances" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_code" TEXT NOT NULL,
    "document_version" INTEGER NOT NULL,
    "content_digest" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_terms_acceptances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_terms_acceptances_member_fkey" FOREIGN KEY ("member_id")
        REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "member_terms_acceptances_document_fkey" FOREIGN KEY ("document_id")
        REFERENCES "member_terms_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "member_terms_acceptances_source_check" CHECK (btrim("source") <> ''),
    CONSTRAINT "member_terms_acceptances_correlation_check" CHECK (btrim("correlation_id") <> ''),
    CONSTRAINT "member_terms_acceptances_version_check" CHECK ("document_version" >= 1),
    CONSTRAINT "member_terms_acceptances_digest_check"
        CHECK ("content_digest" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "member_terms_acceptances_member_id_document_id_key"
    ON "member_terms_acceptances"("member_id", "document_id");
CREATE INDEX "member_terms_acceptances_member_id_accepted_at_idx"
    ON "member_terms_acceptances"("member_id", "accepted_at");

-- Acceptance evidence is append-only: once recorded, the accepted version,
-- digest, instant and source can never be rewritten or removed. There is no
-- production path that updates or deletes this evidence.
CREATE OR REPLACE FUNCTION "member_terms_acceptances_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Member Terms acceptance evidence is immutable'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "member_terms_acceptances_immutable"
    BEFORE UPDATE OR DELETE ON "member_terms_acceptances"
    FOR EACH ROW EXECUTE FUNCTION "member_terms_acceptances_immutable_guard"();

-- Add durable immutable evidence for governed Custom Accounting Period activation.
-- The schedule mutation itself remains serialized by the Accounting Period calendar lock.

BEGIN;

WITH calendar_lock AS MATERIALIZED (
  SELECT pg_advisory_xact_lock(19002026, 1)
)
SELECT 1::int AS "locked"
FROM calendar_lock;

DROP INDEX IF EXISTS "admin_reauth_evidence_session_id_action_class_key";
CREATE INDEX "admin_reauth_evidence_session_id_action_class_expires_at_idx"
ON "admin_reauth_evidence"("session_id", "action_class", "expires_at");

CREATE TABLE "admin_approval_evidence" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "requester_admin_id" UUID NOT NULL,
    "approver_admin_id" UUID NOT NULL,
    "requested_version" INTEGER NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "reauth_evidence_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_approval_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_records" (
    "id" UUID NOT NULL,
    "actor_admin_id" UUID NOT NULL,
    "actor_role" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reauth_evidence_id" UUID NOT NULL,
    "approval_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_approval_evidence_action_resource_id_key"
ON "admin_approval_evidence"("action", "resource_id");
CREATE INDEX "admin_approval_evidence_requester_admin_id_created_at_idx"
ON "admin_approval_evidence"("requester_admin_id", "created_at");
CREATE INDEX "admin_approval_evidence_approver_admin_id_created_at_idx"
ON "admin_approval_evidence"("approver_admin_id", "created_at");
CREATE INDEX "admin_approval_evidence_correlation_id_idx"
ON "admin_approval_evidence"("correlation_id");
CREATE INDEX "audit_records_resource_type_resource_id_created_at_idx"
ON "audit_records"("resource_type", "resource_id", "created_at");
CREATE INDEX "audit_records_actor_admin_id_created_at_idx"
ON "audit_records"("actor_admin_id", "created_at");
CREATE INDEX "audit_records_correlation_id_idx"
ON "audit_records"("correlation_id");
CREATE INDEX "audit_records_approval_id_idx"
ON "audit_records"("approval_id");

ALTER TABLE "admin_approval_evidence"
ADD CONSTRAINT "admin_approval_evidence_requester_admin_id_fkey"
FOREIGN KEY ("requester_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "admin_approval_evidence_approver_admin_id_fkey"
FOREIGN KEY ("approver_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "admin_approval_evidence_reauth_evidence_id_fkey"
FOREIGN KEY ("reauth_evidence_id") REFERENCES "admin_reauth_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_records"
ADD CONSTRAINT "audit_records_actor_admin_id_fkey"
FOREIGN KEY ("actor_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "audit_records_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "admin_auth_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "audit_records_reauth_evidence_id_fkey"
FOREIGN KEY ("reauth_evidence_id") REFERENCES "admin_reauth_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "audit_records_approval_id_fkey"
FOREIGN KEY ("approval_id") REFERENCES "admin_approval_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "protect_immutable_admin_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Immutable Admin evidence cannot be updated or deleted';
END
$$;

CREATE TRIGGER "admin_approval_evidence_immutable"
BEFORE UPDATE OR DELETE ON "admin_approval_evidence"
FOR EACH ROW EXECUTE FUNCTION "protect_immutable_admin_evidence"();

CREATE TRIGGER "audit_records_immutable"
BEFORE UPDATE OR DELETE ON "audit_records"
FOR EACH ROW EXECUTE FUNCTION "protect_immutable_admin_evidence"();

COMMIT;

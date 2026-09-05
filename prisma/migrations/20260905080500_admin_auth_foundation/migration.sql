-- Admin authentication foundation for the first secured Admin control-plane vertical.

CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_encrypted" TEXT,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_users_role_check" CHECK ("role" IN ('SUPER_ADMIN', 'ADMIN', 'AUDITOR')),
    CONSTRAINT "admin_users_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED')),
    CONSTRAINT "admin_users_failed_login_attempts_check" CHECK ("failed_login_attempts" >= 0),
    CONSTRAINT "admin_users_mfa_state_check" CHECK (("mfa_enabled" = false) OR ("mfa_secret_encrypted" IS NOT NULL))
);

CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");
CREATE INDEX "admin_users_status_role_idx" ON "admin_users"("status", "role");

CREATE TABLE "admin_auth_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" UUID,
    "mfa_verified_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "admin_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_auth_sessions_refresh_token_hash_key"
ON "admin_auth_sessions"("refresh_token_hash");
CREATE INDEX "admin_auth_sessions_admin_user_id_created_at_idx"
ON "admin_auth_sessions"("admin_user_id", "created_at");
CREATE INDEX "admin_auth_sessions_family_id_idx"
ON "admin_auth_sessions"("family_id");
CREATE INDEX "admin_auth_sessions_expires_at_idx"
ON "admin_auth_sessions"("expires_at");

ALTER TABLE "admin_auth_sessions"
ADD CONSTRAINT "admin_auth_sessions_admin_user_id_fkey"
FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_reauth_evidence" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "action_class" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_reauth_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_reauth_evidence_window_check" CHECK ("expires_at" > "verified_at")
);

CREATE UNIQUE INDEX "admin_reauth_evidence_session_id_action_class_key"
ON "admin_reauth_evidence"("session_id", "action_class");
CREATE INDEX "admin_reauth_evidence_admin_user_id_expires_at_idx"
ON "admin_reauth_evidence"("admin_user_id", "expires_at");

ALTER TABLE "admin_reauth_evidence"
ADD CONSTRAINT "admin_reauth_evidence_admin_user_id_fkey"
FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_reauth_evidence"
ADD CONSTRAINT "admin_reauth_evidence_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "admin_auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

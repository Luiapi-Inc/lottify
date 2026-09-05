-- A sensitive-action denial can occur before fresh re-auth evidence exists.
-- Audit remains mandatory, so the evidence reference must be nullable for that denial path.

ALTER TABLE "audit_records"
ALTER COLUMN "reauth_evidence_id" DROP NOT NULL;

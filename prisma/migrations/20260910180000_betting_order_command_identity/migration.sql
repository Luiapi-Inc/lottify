-- Bet Order command idempotency identity + verifiable Receipt digest
-- (Issue 45, follow-up to 20260910170000_betting_order_receipt).
--
-- `confirm_idempotency_key` / `cancel_idempotency_key` record the Idempotency-Key
-- each member command was executed under, so replaying a Confirm/Cancel returns
-- the durable result instead of re-executing, and a different key for an
-- already-executed command is a conflict.
--
-- `terms_canonical` stores the exact canonical serialization that
-- `content_digest` digests. JSONB does not preserve key order, so verifying the
-- digest requires the byte-exact serialization that was signed; this column is
-- what makes the Receipt independently verifiable.
--
-- `bet_receipts` was introduced in the same unreleased work package as this
-- migration and the immutability trigger blocks any UPDATE, so the column is
-- added as NOT NULL with an empty placeholder for pre-existing rows (there can
-- be none) and the placeholder default is then dropped.

ALTER TABLE "bet_orders" ADD COLUMN "confirm_idempotency_key" TEXT;
ALTER TABLE "bet_orders" ADD COLUMN "cancel_idempotency_key" TEXT;

ALTER TABLE "bet_receipts" ADD COLUMN "terms_canonical" TEXT NOT NULL DEFAULT '';
ALTER TABLE "bet_receipts" ALTER COLUMN "terms_canonical" DROP DEFAULT;

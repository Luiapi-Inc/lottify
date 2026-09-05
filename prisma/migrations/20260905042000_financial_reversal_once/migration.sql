-- A posted financial effect may have at most one exact REVERSAL.
-- Business-semantic COMPENSATION remains many-to-one and is governed by idempotency.
CREATE UNIQUE INDEX "financial_transactions_one_reversal_per_target_key"
ON "financial_transactions"("corrects_transaction_id")
WHERE "correction_kind" = 'REVERSAL';

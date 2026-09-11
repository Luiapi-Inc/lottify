\set ON_ERROR_STOP on

DO $$
DECLARE
  missing_tables text[];
  failed_migrations bigint;
  unbalanced_transactions bigint;
  invalid_reservations bigint;
  invalid_foreign_keys bigint;
BEGIN
  SELECT array_agg(required_table ORDER BY required_table)
    INTO missing_tables
  FROM unnest(ARRAY[
    '_prisma_migrations',
    'members',
    'lottery_products',
    'lottery_draws',
    'bet_orders',
    'settlement_batches',
    'financial_transactions',
    'ledger_postings',
    'reservations',
    'payment_deposits',
    'payment_withdrawals'
  ]) AS required_table
  WHERE to_regclass('public.' || required_table) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'missing critical tables: %', missing_tables;
  END IF;

  SELECT count(*) INTO failed_migrations
  FROM _prisma_migrations
  WHERE finished_at IS NULL AND rolled_back_at IS NULL;
  IF failed_migrations <> 0 THEN
    RAISE EXCEPTION 'unfinished Prisma migrations: %', failed_migrations;
  END IF;

  SELECT count(*) INTO unbalanced_transactions
  FROM (
    SELECT transaction_id
    FROM ledger_postings
    GROUP BY transaction_id
    HAVING count(*) < 2
       OR bool_or(amount_minor <= 0)
       OR bool_or(side NOT IN ('DEBIT', 'CREDIT'))
       OR sum(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE 0 END)
          <> sum(CASE WHEN side = 'CREDIT' THEN amount_minor ELSE 0 END)
  ) AS invalid;
  IF unbalanced_transactions <> 0 THEN
    RAISE EXCEPTION 'unbalanced financial transactions: %', unbalanced_transactions;
  END IF;

  SELECT count(*) INTO invalid_reservations
  FROM reservations
  WHERE amount_minor <= 0
     OR (released_at IS NOT NULL AND consumed_at IS NOT NULL);
  IF invalid_reservations <> 0 THEN
    RAISE EXCEPTION 'invalid reservations: %', invalid_reservations;
  END IF;

  SELECT count(*) INTO invalid_foreign_keys
  FROM pg_constraint
  WHERE contype = 'f' AND NOT convalidated;
  IF invalid_foreign_keys <> 0 THEN
    RAISE EXCEPTION 'unvalidated foreign keys: %', invalid_foreign_keys;
  END IF;
END $$;

SELECT 'integrity_status=PASS';

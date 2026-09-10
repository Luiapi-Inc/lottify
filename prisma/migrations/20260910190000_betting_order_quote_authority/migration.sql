-- Issue 45 correction: assert the accepted bet window instead of a Quote-level
-- clock rule.
--
-- 20260910170000_betting_order_receipt created `bet_orders_cutoff_check`
-- ("cutoff_at" >= "created_at"). That restates a rule the Quote already owns —
-- `betting_quotes_cutoff_check` ("cutoff_at" >= "server_now") plus the Quote TTL
-- the Bet Order service validates before creating the Order. On the Order it adds
-- no invariant, yet it compares a *Quote* instant against the *database* insert
-- clock, so with ordinary app/database clock skew a legitimate Order created just
-- before the cutoff could be rejected by the database as a persistence error.
--
-- What the Order genuinely has to guarantee is the window the Member accepted:
-- the Quote expiry copied onto the Order is the earlier of the Quote TTL and the
-- Draw cutoff, so it can never outlive that cutoff. That is clock-independent and
-- is what the Order's Confirm revalidation relies on.

ALTER TABLE "bet_orders" DROP CONSTRAINT "bet_orders_cutoff_check";
ALTER TABLE "bet_orders"
  ADD CONSTRAINT "bet_orders_accepted_window_check"
  CHECK ("quote_expires_at" <= "cutoff_at");

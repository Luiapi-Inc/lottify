// Persistence seam for the Draw-cancellation refund obligation (Issue 116).
//
// Betting owns the Order state and therefore owns the refund drive; the Wallet
// & Ledger reversal itself is reached through the betting order wallet port, not
// through this repository. This repository exposes exactly the durable state a
// refund run needs: which Orders of a Draw still hold an unrefunded committed
// stake, and the two optimistic-concurrency transitions that move such an Order
// through CANCELLING to CANCELLED.
//
// `listRefundableStakes` is intentionally typed as the superset (every Order
// state) so the refundability predicate in `./stake-refund` remains the single
// authority; implementations should narrow in the query, callers must apply
// `isRefundableStakeOrder` before moving money.

import type { BetOrderState } from "./bet-order-lifecycle";
import type { StakeOrderRecord } from "./stake-refund";

export interface StakeRefundClaim {
  readonly orderId: string;
  /** The state the claim expects to observe; a mismatch means another writer won. */
  readonly expectedState: BetOrderState;
  readonly expectedVersion: number;
  readonly nextState: BetOrderState;
  readonly nextVersion: number;
  readonly idempotencyKey: string;
}

export interface StakeRefundSettlement {
  readonly orderId: string;
  /** The in-flight (CANCELLING) version the settlement expects to resolve. */
  readonly expectedVersion: number;
  readonly nextVersion: number;
  readonly refundTransactionId: string;
  readonly reason: string | null;
  readonly at: Date;
}

export interface StakeRefundRepository {
  /**
   * Orders of the Draw that may still owe a refund for a cancelled Draw. The
   * query is a superset filter; callers MUST apply `isRefundableStakeOrder`.
   */
  listRefundableStakes(drawId: string): Promise<readonly StakeOrderRecord[]>;

  /** The current durable record, or null when the Order does not exist. */
  readOrder(orderId: string): Promise<StakeOrderRecord | null>;

  /**
   * CONFIRMED -> CANCELLING under optimistic concurrency, recording the
   * Draw-cancellation Idempotency-Key. Returns null when a concurrent writer
   * already moved the Order, so the caller never assumes it owns the refund.
   */
  claimForRefund(claim: StakeRefundClaim): Promise<StakeOrderRecord | null>;

  /**
   * CANCELLING -> CANCELLED once the reversal is durable. Returns null when a
   * concurrent writer resolved the Order first; the Order is then CANCELLED
   * under the caller's own reversal or under the winner's, never both.
   */
  settleRefund(settlement: StakeRefundSettlement): Promise<StakeOrderRecord | null>;
}

export const STAKE_REFUND_REPOSITORY = Symbol("STAKE_REFUND_REPOSITORY");

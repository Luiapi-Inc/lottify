// Draw-cancellation refund obligation (Issue 116, workflow 5).
//
// A "committed stake" is money that Confirm already moved out of the Member's
// spendable buckets into Betting Settlement. When a Draw is cancelled every
// such stake has to be given back exactly once, so the obligation is modelled
// here as a pure predicate over the Order's durable money references: an Order
// still owes a refund while it holds a committed stake transaction that has no
// reversal posted.
//
// This module deliberately does NOT prove refund-once. That proof is the Wallet
// & Ledger idempotency of `BET_STAKE_REFUND` keyed by the Bet Order (see the
// betting order wallet port and `./stake-refund.repository`). The predicate only
// decides which Orders a Draw-cancellation run has to drive, and it is the
// single authority for that decision at every layer: the persisted query narrows
// what it can, and the application service re-applies the predicate before any
// money moves.

import type { BetOrderState } from "./bet-order-lifecycle";

/** Order states that can still owe a refund for a cancelled Draw. */
export const REFUNDABLE_STAKE_STATES = ["CONFIRMED", "CANCELLING"] as const;
export type RefundableStakeState = (typeof REFUNDABLE_STAKE_STATES)[number];

/** The Order facts a Draw-cancellation refund reasons over. */
export interface StakeOrderRecord {
  readonly id: string;
  readonly memberId: string;
  readonly drawId: string;
  readonly state: BetOrderState;
  readonly version: number;
  /** The durable Ledger posting that moved the stake; null before Confirm. */
  readonly stakeTransactionId: string | null;
  /** The durable reversal of that stake; null until the refund is posted. */
  readonly refundTransactionId: string | null;
  readonly totalStakeMinor: bigint;
}

/** An Order that owes a refund: a committed stake with no reversal posted. */
export type RefundableStakeOrder = StakeOrderRecord & {
  readonly state: RefundableStakeState;
  readonly stakeTransactionId: string;
};

export function hasCommittedStake(record: StakeOrderRecord): boolean {
  return record.stakeTransactionId !== null && record.stakeTransactionId !== "";
}

export function isRefundableStakeOrder(
  record: StakeOrderRecord,
): record is RefundableStakeOrder {
  return (
    (REFUNDABLE_STAKE_STATES as readonly string[]).includes(record.state) &&
    hasCommittedStake(record) &&
    record.refundTransactionId === null
  );
}

/** Reason recorded on an Order refunded because its Draw was cancelled. */
export const DRAW_CANCELLATION_REASON = "DRAW_CANCELLED";

/**
 * The Idempotency-Key a Draw cancellation records on every Order it cancels.
 * One key for the whole Draw makes a re-driven run converge on the same command
 * instead of presenting itself as a fresh Member cancellation with a new key.
 */
export function drawRefundIdempotencyKey(drawId: string): string {
  return `DRAW_REFUND:${drawId}`;
}

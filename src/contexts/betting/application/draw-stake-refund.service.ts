// Draw-cancellation refund operation (Issue 116, workflow 5).
//
// "Betting identifies affected confirmed Orders; Wallet & Ledger posts refunds
// idempotently. The Draw reaches fully completed CANCELLED only after all refund
// obligations are durably satisfied. Partial failure remains a recoverable
// operational state rather than being hidden as complete."
//
// This service is that single Betting-side operation: for one Draw it drives
// every Order that still holds a committed stake with no reversal posted through
// CANCELLING to CANCELLED, taking the reversal from the Wallet & Ledger port.
//
// Replay safety has two independent legs, and neither is optional:
//   1. per Order, the Wallet & Ledger `BET_STAKE_REFUND` idempotency keyed by the
//      Order means re-driving an Order returns the durable reversal instead of
//      posting a second one;
//   2. per Order, the state transition is an optimistic-concurrency CAS, so this
//      run only claims an Order it actually moved, and resolves it only from the
//      in-flight version it claimed.
// A partially failed run therefore reports its outstanding obligations instead
// of pretending the Draw is refund-clean; the caller re-drives to converge.
//
// This path is NOT the Member pre-cutoff cancellation (BettingOrderService
// .cancelOrder): a Draw cancellation happens after the cutoff, is not the
// Member's right, and never touches the Member cancellation guards.

import { Inject, Injectable } from "@nestjs/common";
import { applyBetOrderCommand } from "../domain/bet-order-lifecycle";
import {
  DRAW_CANCELLATION_REASON,
  drawRefundIdempotencyKey,
  isRefundableStakeOrder,
  type RefundableStakeOrder,
  type StakeOrderRecord,
} from "../domain/stake-refund";
import {
  STAKE_REFUND_REPOSITORY,
  type StakeRefundRepository,
} from "../domain/stake-refund.repository";
import {
  BET_ORDER_WALLET_PORT,
  type BetOrderWalletPort,
} from "./betting-order-wallet.port";

export type DrawStakeRefundErrorCode = "DRAW_ID_REQUIRED";

export class DrawStakeRefundError extends Error {
  readonly code: DrawStakeRefundErrorCode;
  readonly status: number;

  constructor(code: DrawStakeRefundErrorCode, message: string, status: number) {
    super(message);
    this.name = "DrawStakeRefundError";
    this.code = code;
    this.status = status;
  }
}

export const DRAW_REFUND_OUTCOMES = [
  /** This run left the Order CANCELLED with a durable reversal. */
  "REFUNDED",
  /** The Order was already CANCELLED under a durable reversal; no effect added. */
  "ALREADY_REFUNDED",
  /** A concurrent writer owns the Order right now; the obligation is unresolved. */
  "IN_FLIGHT",
  /** The reversal could not be completed; the obligation is unresolved. */
  "FAILED",
] as const;

export type DrawRefundOutcome = (typeof DRAW_REFUND_OUTCOMES)[number];

export interface DrawStakeRefundEntry {
  readonly orderId: string;
  readonly memberId: string;
  readonly stakeMinor: bigint;
  readonly outcome: DrawRefundOutcome;
  readonly refundTransactionId: string | null;
  readonly reason: string | null;
}

export interface DrawStakeRefundResult {
  readonly drawId: string;
  /** Orders of the Draw this run had to consider (committed stake, unrefunded). */
  readonly considered: number;
  readonly refunded: readonly DrawStakeRefundEntry[];
  readonly alreadyRefunded: readonly DrawStakeRefundEntry[];
  /** Obligations this run did NOT satisfy; the Draw is not refund-clean while non-empty. */
  readonly outstanding: readonly DrawStakeRefundEntry[];
  readonly refundedStakeMinor: bigint;
  readonly obligationsSatisfied: boolean;
}

@Injectable()
export class DrawStakeRefundService {
  constructor(
    @Inject(STAKE_REFUND_REPOSITORY) private readonly orders: StakeRefundRepository,
    @Inject(BET_ORDER_WALLET_PORT) private readonly wallet: BetOrderWalletPort,
  ) {}

  now(): Date {
    return new Date();
  }

  /**
   * Refunds every confirmed Order with a committed stake for the Draw. Safe to
   * re-drive: an already-refunded Order is reported, never refunded twice.
   */
  async refundCommittedStakesForDraw(input: {
    drawId: string;
    reason?: string | null;
    now?: Date;
  }): Promise<DrawStakeRefundResult> {
    const drawId = requireDrawId(input.drawId);
    const at = input.now ?? this.now();
    const reason = input.reason?.trim() || DRAW_CANCELLATION_REASON;
    const refundKey = drawRefundIdempotencyKey(drawId);

    const candidates = (await this.orders.listRefundableStakes(drawId)).filter(
      isRefundableStakeOrder,
    );

    const refunded: DrawStakeRefundEntry[] = [];
    const alreadyRefunded: DrawStakeRefundEntry[] = [];
    const outstanding: DrawStakeRefundEntry[] = [];
    let refundedStakeMinor = 0n;

    for (const order of candidates) {
      const entry = await this.refundOrder(order, refundKey, reason, at);
      if (entry.outcome === "REFUNDED") {
        refunded.push(entry);
        refundedStakeMinor += order.totalStakeMinor;
      } else if (entry.outcome === "ALREADY_REFUNDED") {
        alreadyRefunded.push(entry);
      } else {
        outstanding.push(entry);
      }
    }

    return {
      drawId,
      considered: candidates.length,
      refunded,
      alreadyRefunded,
      outstanding,
      refundedStakeMinor,
      obligationsSatisfied: outstanding.length === 0,
    };
  }

  /**
   * The Orders of the Draw that still owe a refund. This is the query the
   * cancellation gate re-checks after a refund run; it reuses the same
   * predicate, so the gate can never disagree with the operation.
   */
  async listOutstandingRefundObligations(
    drawId: string,
  ): Promise<readonly RefundableStakeOrder[]> {
    const id = requireDrawId(drawId);
    return (await this.orders.listRefundableStakes(id)).filter(isRefundableStakeOrder);
  }

  private async refundOrder(
    order: RefundableStakeOrder,
    refundKey: string,
    reason: string,
    at: Date,
  ): Promise<DrawStakeRefundEntry> {
    try {
      const claimed = await this.claim(order, refundKey);
      if (!claimed) return await this.describeUnclaimed(order, null);

      const effect = await this.wallet.refundStake({
        orderId: order.id,
        memberId: order.memberId,
        stakeTransactionId: order.stakeTransactionId,
        currency: "THB",
        correlationId: order.id,
      });

      const settled = await this.orders.settleRefund({
        orderId: order.id,
        expectedVersion: claimed.version,
        nextVersion: claimed.version + 1,
        refundTransactionId: effect.transactionId,
        reason,
        at,
      });
      if (!settled) return await this.describeUnclaimed(order, effect.transactionId);

      return entry(order, "REFUNDED", effect.transactionId, null);
    } catch (error) {
      return entry(order, "FAILED", null, errorMessage(error));
    }
  }

  /**
   * Claims the Order for this run. An Order already in CANCELLING was claimed by
   * an earlier (possibly crashed) run: the reversal is keyed by the Order, so
   * resuming it here is the same single money movement, not a second one.
   */
  private async claim(
    order: RefundableStakeOrder,
    refundKey: string,
  ): Promise<StakeOrderRecord | null> {
    if (order.state === "CANCELLING") return order;

    const next = applyBetOrderCommand({
      current: { state: order.state, version: order.version },
      expectedVersion: order.version,
      command: "CANCEL",
    });

    return this.orders.claimForRefund({
      orderId: order.id,
      expectedState: order.state,
      expectedVersion: order.version,
      nextState: next.state,
      nextVersion: next.version,
      idempotencyKey: refundKey,
    });
  }

  /**
   * A concurrent writer moved the Order between the read and the claim/settle,
   * or resolved it. The durable record decides: CANCELLED under its own reversal
   * is a satisfied obligation, anything else is still outstanding.
   */
  private async describeUnclaimed(
    order: RefundableStakeOrder,
    refundTransactionId: string | null,
  ): Promise<DrawStakeRefundEntry> {
    const fresh = await this.orders.readOrder(order.id);
    if (fresh && fresh.state === "CANCELLED" && fresh.refundTransactionId !== null) {
      return entry(
        order,
        "ALREADY_REFUNDED",
        fresh.refundTransactionId,
        "the Order was already cancelled under a durable reversal",
      );
    }
    return entry(
      order,
      "IN_FLIGHT",
      refundTransactionId,
      fresh && fresh.state === "CANCELLED"
        ? "the Order is CANCELLED with no reversal recorded"
        : "another writer is cancelling the Order; re-drive to converge",
    );
  }
}

function entry(
  order: RefundableStakeOrder,
  outcome: DrawRefundOutcome,
  refundTransactionId: string | null,
  reason: string | null,
): DrawStakeRefundEntry {
  return {
    orderId: order.id,
    memberId: order.memberId,
    stakeMinor: order.totalStakeMinor,
    outcome,
    refundTransactionId,
    reason,
  };
}

function requireDrawId(value: string | undefined | null): string {
  const drawId = value?.trim() ?? "";
  if (!drawId) {
    throw new DrawStakeRefundError(
      "DRAW_ID_REQUIRED",
      "A Draw cancellation refund requires the Draw it applies to",
      400,
    );
  }
  return drawId;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

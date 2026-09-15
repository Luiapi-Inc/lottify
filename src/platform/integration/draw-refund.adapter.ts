// Platform composition-root adapter for the lottery -> betting refund port.
//
// The lottery context reaches the Draw-cancellation bulk refund through this
// adapter (mirroring SettlementDrawAdapter / BetOrderWalletAdapter). It maps
// the betting-owned DrawStakeRefundResult onto lottery-local types so the
// lottery context never imports betting internals.

import { Inject, Injectable } from "@nestjs/common";
import { DrawStakeRefundService } from "../../contexts/betting/application/draw-stake-refund.service";
import {
  DrawRefundError,
  type DrawRefundEntry,
  type DrawRefundPort,
  type DrawRefundRunResult,
} from "../../contexts/lottery/application/draw-refund.port";

@Injectable()
export class DrawRefundAdapter implements DrawRefundPort {
  constructor(
    @Inject(DrawStakeRefundService)
    private readonly refunds: DrawStakeRefundService,
  ) {}

  async refundCommittedStakesForDraw(input: {
    readonly drawId: string;
    readonly reason?: string | null;
    readonly now?: Date;
  }): Promise<DrawRefundRunResult> {
    const result = await this.refunds.refundCommittedStakesForDraw(input);
    return {
      drawId: result.drawId,
      considered: result.considered,
      refunded: result.refunded.map(toEntry),
      alreadyRefunded: result.alreadyRefunded.map(toEntry),
      outstanding: result.outstanding.map(toEntry),
      refundedStakeMinor: result.refundedStakeMinor,
      obligationsSatisfied: result.obligationsSatisfied,
    };
  }

  async listOutstandingRefundObligations(
    drawId: string,
  ): Promise<readonly { orderId: string; memberId: string }[]> {
    try {
      const outstanding = await this.refunds.listOutstandingRefundObligations(
        drawId,
      );
      return outstanding.map((order) => ({
        orderId: order.id,
        memberId: order.memberId,
      }));
    } catch (error) {
      if (isDrawStakeRefundError(error)) {
        throw new DrawRefundError(
          "DRAW_ID_REQUIRED",
          error.message,
          error.status,
        );
      }
      throw error;
    }
  }
}

function toEntry(
  entry: {
    readonly orderId: string;
    readonly memberId: string;
    readonly stakeMinor: bigint;
    readonly outcome: string;
    readonly refundTransactionId: string | null;
    readonly reason: string | null;
  },
): DrawRefundEntry {
  return {
    orderId: entry.orderId,
    memberId: entry.memberId,
    stakeMinor: entry.stakeMinor,
    outcome: entry.outcome as DrawRefundEntry["outcome"],
    refundTransactionId: entry.refundTransactionId,
    reason: entry.reason,
  };
}

function isDrawStakeRefundError(
  error: unknown,
): error is { message: string; status: number; code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "status" in error &&
    (error as { code: string }).code === "DRAW_ID_REQUIRED"
  );
}

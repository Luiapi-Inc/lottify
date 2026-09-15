// Prisma implementation of the Draw-cancellation refund persistence seam
// (Issue 116). It owns only the durable reads and the two optimistic-concurrency
// transitions; the refundability rule lives in `../domain/stake-refund` and the
// money movement lives behind the betting order wallet port.

import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import { BET_ORDER_STATES, type BetOrderState } from "../domain/bet-order-lifecycle";
import {
  isRefundableStakeOrder,
  REFUNDABLE_STAKE_STATES,
  type StakeOrderRecord,
} from "../domain/stake-refund";
import type {
  StakeRefundClaim,
  StakeRefundRepository,
  StakeRefundSettlement,
} from "../domain/stake-refund.repository";

const STAKE_REFUND_SELECT = {
  id: true,
  memberId: true,
  drawId: true,
  state: true,
  version: true,
  stakeTransactionId: true,
  refundTransactionId: true,
  totalStakeMinor: true,
} as const;

type StakeRefundRow = {
  id: string;
  memberId: string;
  drawId: string;
  state: string;
  version: number;
  stakeTransactionId: string | null;
  refundTransactionId: string | null;
  totalStakeMinor: bigint;
};

@Injectable()
export class PrismaStakeRefundRepository implements StakeRefundRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listRefundableStakes(drawId: string): Promise<readonly StakeOrderRecord[]> {
    const rows = await this.prisma.betOrder.findMany({
      where: {
        drawId,
        state: { in: [...REFUNDABLE_STAKE_STATES] },
        stakeTransactionId: { not: null },
        refundTransactionId: null,
      },
      select: STAKE_REFUND_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    // The query already narrows; the predicate is re-applied here so the
    // authority for "owes a refund" is never a WHERE clause alone.
    return rows.map(toStakeOrderRecord).filter(isRefundableStakeOrder);
  }

  async readOrder(orderId: string): Promise<StakeOrderRecord | null> {
    const row = await this.prisma.betOrder.findUnique({
      where: { id: orderId },
      select: STAKE_REFUND_SELECT,
    });
    return row ? toStakeOrderRecord(row) : null;
  }

  async claimForRefund(claim: StakeRefundClaim): Promise<StakeOrderRecord | null> {
    const updated = await this.prisma.betOrder.updateMany({
      where: {
        id: claim.orderId,
        state: claim.expectedState,
        version: claim.expectedVersion,
      },
      data: {
        state: claim.nextState,
        version: claim.nextVersion,
        cancelIdempotencyKey: claim.idempotencyKey,
      },
    });
    if (updated.count === 0) return null;
    return this.readOrder(claim.orderId);
  }

  async settleRefund(settlement: StakeRefundSettlement): Promise<StakeOrderRecord | null> {
    const updated = await this.prisma.betOrder.updateMany({
      where: {
        id: settlement.orderId,
        state: "CANCELLING",
        version: settlement.expectedVersion,
      },
      data: {
        state: "CANCELLED",
        version: settlement.nextVersion,
        refundTransactionId: settlement.refundTransactionId,
        cancellationReason: settlement.reason,
        cancelledAt: settlement.at,
      },
    });
    if (updated.count === 0) return null;
    return this.readOrder(settlement.orderId);
  }
}

/**
 * The persisted state column is constrained to the locked state set by a
 * database CHECK; this narrows it back to the domain type at the boundary.
 */
function toStakeOrderRecord(row: StakeRefundRow): StakeOrderRecord {
  if (!BET_ORDER_STATES.includes(row.state as BetOrderState)) {
    throw new Error(`Bet Order is in an unknown state ${row.state}`);
  }
  return {
    id: row.id,
    memberId: row.memberId,
    drawId: row.drawId,
    state: row.state as BetOrderState,
    version: row.version,
    stakeTransactionId: row.stakeTransactionId,
    refundTransactionId: row.refundTransactionId,
    totalStakeMinor: row.totalStakeMinor,
  };
}

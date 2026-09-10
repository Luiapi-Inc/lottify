// Platform composition-root adapter for the settlement -> betting orders port.
//
// Reads the settleable Bet Orders (with their accepted lines) for a Draw and
// marks them terminal as SETTLED once their settlement effect is durable. On a
// first settlement these are the CONFIRMED orders; on a Result-correction
// re-settlement it also re-lists orders already settled by an earlier batch so
// they are re-evaluated against the corrected Result. Settling is once-only per
// Order (a replay is a no-op), so a crashed/re-driven batch never double-marks.

import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../platform/persistence/prisma.service";
import {
  type ConfirmSettledOrderInput,
  type SettlementOrdersPort,
} from "../../contexts/result-settlement/application/settlement.ports";

@Injectable()
export class SettlementOrdersAdapter implements SettlementOrdersPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listSettleableOrders(
    drawId: string,
    excludeBatchId?: string,
  ): Promise<readonly SettleableOrder[]> {
    const confirmed = await this.prisma.betOrder.findMany({
      where: { drawId, state: "CONFIRMED" },
      select: ORDER_SELECT,
    });

    const combined: Array<typeof confirmed[number]> = [...confirmed];
    const seen = new Set(combined.map((order) => order.id));

    if (excludeBatchId) {
      // Orders already settled by an earlier batch (but not this one) are
      // re-settled so a correction re-evaluates every affected Order.
      const drawOrderIds = (
        await this.prisma.betOrder.findMany({
          where: { drawId },
          select: { id: true },
        })
      ).map((order) => order.id);
      if (drawOrderIds.length > 0) {
        const priorRows = await this.prisma.settlementOrder.findMany({
          where: {
            orderId: { in: drawOrderIds },
            batch: { id: { not: excludeBatchId } },
          },
          select: { orderId: true },
        });
        const priorOrderIds = [
          ...new Set(priorRows.map((row) => row.orderId)),
        ].filter((orderId) => !seen.has(orderId));
        if (priorOrderIds.length > 0) {
          const previouslySettled = await this.prisma.betOrder.findMany({
            where: { id: { in: priorOrderIds }, state: "SETTLED" },
            select: ORDER_SELECT,
          });
          for (const order of previouslySettled) {
            combined.push(order);
            seen.add(order.id);
          }
        }
      }
    }

    return combined.map((order) => ({
      orderId: order.id,
      memberId: order.memberId,
      totalStakeMinor: order.totalStakeMinor,
      lines: order.lines.map((line) => ({
        betTypeCode: line.betTypeCode,
        canonicalNumber: line.canonicalNumber,
        stakeMinor: line.stakeMinor,
        resolvedPayout: line.resolvedPayout,
      })),
    }));
  }

  async markOrderSettled(input: ConfirmSettledOrderInput): Promise<void> {
    // Once-only: only a CONFIRMED Order transitions to SETTLED. An Order
    // already SETTLED (replay or correction re-settlement) is a no-op.
    await this.prisma.betOrder.updateMany({
      where: { id: input.orderId, state: "CONFIRMED" },
      data: { state: "SETTLED", version: { increment: 1 } },
    });
  }
}

export interface SettleableOrder {
  readonly orderId: string;
  readonly memberId: string;
  readonly totalStakeMinor: bigint;
  readonly lines: ReadonlyArray<{
    readonly betTypeCode: string;
    readonly canonicalNumber: string;
    readonly stakeMinor: bigint;
    readonly resolvedPayout: unknown;
  }>;
}

const ORDER_SELECT = {
  id: true,
  memberId: true,
  totalStakeMinor: true,
  lines: true,
} as const;

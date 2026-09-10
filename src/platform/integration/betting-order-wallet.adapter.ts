// Platform composition-root adapter for the betting→wallet-ledger port.
//
// This adapter lives in the platform layer (not a bounded context) so it may
// legitimately combine the Wallet & Ledger application service with the betting
// port types. It performs the Confirm money movement exactly as the confirmed
// workflow requires: reserve the stake from the Member's spendable buckets,
// then consume that reservation into a durable posting from the actual source
// buckets to Betting Settlement. Both steps are idempotent per Bet Order, so a
// re-driven Confirm resumes from durable state instead of debiting twice.
//
// Cancellation restores the economic effect through an explicit reversal of the
// committed stake transaction, which credits back the exact source-bucket
// composition recorded on the original Reservation rather than recomputing
// allocation from the current Wallet.

import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaService } from "../persistence/prisma.service";
import {
  BetOrderWalletError,
  type BetOrderWalletPort,
  type BetStakeEffect,
} from "../../contexts/betting/application/betting-order-wallet.port";

/** System/counterparty account that holds committed stakes for settlement. */
const BETTING_SETTLEMENT_SYSTEM_CODE = "betting-settlement";

@Injectable()
export class BetOrderWalletAdapter implements BetOrderWalletPort {
  constructor(
    private readonly ledger: FinancialLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  async commitStake(input: {
    orderId: string;
    memberId: string;
    drawId: string;
    amountMinor: bigint;
    currency: "THB";
    correlationId: string;
  }): Promise<BetStakeEffect> {
    const currency = "THB" as const;
    const settlementAccountId = await this.ledger.ensureSystemAccount(
      BETTING_SETTLEMENT_SYSTEM_CODE,
      currency,
    );

    // A Reservation already bound to this Order is authoritative: a re-driven
    // Confirm must reuse it (and its recorded allocation) rather than deciding
    // a new allocation from the Member's current balance composition.
    const existing = await this.prisma.reservation.findUnique({
      where: {
        purpose_businessReference: { purpose: "BET", businessReference: input.orderId },
      },
      select: { id: true },
    });

    let reservationId: string;
    if (existing) {
      reservationId = existing.id;
    } else {
      const allocations = await this.allocateStake(input.memberId, input.amountMinor, currency);
      try {
        reservationId = await this.ledger.reserve({
          purpose: "BET",
          businessReference: input.orderId,
          memberId: input.memberId,
          currency,
          amountMinor: input.amountMinor,
          correlationId: input.correlationId,
          idempotency: {
            scope: `BET_STAKE_RESERVE:${input.orderId}`,
            key: input.orderId,
            fingerprint: stakeFingerprint(input),
          },
          allocations,
        });
      } catch (error) {
        throw mapWalletDenial(error);
      }
    }

    const transactionId = await this.ledger.consumeReservationAndPost({
      reservationId,
      businessTransactionId: input.orderId,
      operationType: "BET_STAKE_COMMIT",
      correlationId: input.correlationId,
      idempotency: {
        scope: `BET_STAKE_COMMIT:${input.orderId}`,
        key: input.orderId,
        fingerprint: stakeFingerprint(input),
      },
      domainReferences: { orderId: input.orderId, drawId: input.drawId },
      currency,
      effectiveAt: new Date(),
      destinations: [{ accountId: settlementAccountId, amountMinor: input.amountMinor }],
    });

    return { reservationId, transactionId };
  }

  async refundStake(input: {
    orderId: string;
    memberId: string;
    stakeTransactionId: string;
    currency: "THB";
    correlationId: string;
  }): Promise<BetStakeEffect> {
    const reservation = await this.prisma.reservation.findUnique({
      where: {
        purpose_businessReference: { purpose: "BET", businessReference: input.orderId },
      },
      select: { id: true },
    });

    const transactionId = await this.ledger.reverseTransaction({
      originalTransactionId: input.stakeTransactionId,
      businessTransactionId: `${input.orderId}:refund`,
      operationType: "BET_STAKE_REFUND",
      correlationId: input.correlationId,
      idempotency: {
        scope: `BET_STAKE_REFUND:${input.orderId}`,
        key: input.orderId,
        fingerprint: refundFingerprint(input),
      },
      domainReferences: { orderId: input.orderId },
      effectiveAt: new Date(),
    });

    return { reservationId: reservation?.id ?? "", transactionId };
  }

  /**
   * Funds the stake from the Member's spendable buckets in the accepted order
   * (CASH first, then BONUS). Returns the exact composition to snapshot on the
   * Reservation so refund and settlement reuse it. A stake the Member cannot
   * cover is a clean denial, never a partial reservation.
   */
  private async allocateStake(
    memberId: string,
    amountMinor: bigint,
    currency: "THB",
  ): Promise<Array<{ accountId: string; amountMinor: bigint }>> {
    const allocations: Array<{ accountId: string; amountMinor: bigint }> = [];
    let remainingMinor = amountMinor;

    for (const bucket of ["CASH", "BONUS"] as const) {
      if (remainingMinor <= 0n) break;
      const accountId = await this.ledger.ensureMemberAccount(memberId, bucket, currency);
      const availableMinor = await this.ledger.getAvailableMinorUnits(accountId);
      if (availableMinor <= 0n) continue;
      const takeMinor = availableMinor < remainingMinor ? availableMinor : remainingMinor;
      allocations.push({ accountId, amountMinor: takeMinor });
      remainingMinor -= takeMinor;
    }

    if (remainingMinor > 0n) {
      throw new BetOrderWalletError(
        "INSUFFICIENT_FUNDS",
        "Member spendable balance does not cover the stake",
        { amountMinor: amountMinor.toString(), shortfallMinor: remainingMinor.toString() },
      );
    }
    return allocations;
  }
}

/**
 * Wallet & Ledger raises plain errors for reservation denials. Only the two
 * documented, non-transient denials are translated into a domain denial; any
 * other failure stays an unexpected error so it is never hidden as a rejected
 * Bet Order.
 */
function mapWalletDenial(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (/exceed available spendable balance/i.test(error.message)) {
    return new BetOrderWalletError("INSUFFICIENT_FUNDS", error.message, {});
  }
  if (/debt blocks/i.test(error.message)) {
    return new BetOrderWalletError(
      "WALLET_RESTRICTED",
      "Member balance is restricted by an unresolved debt position",
      {},
    );
  }
  return error;
}

function stakeFingerprint(input: {
  orderId: string;
  memberId: string;
  drawId: string;
  amountMinor: bigint;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        orderId: input.orderId,
        memberId: input.memberId,
        drawId: input.drawId,
        amountMinor: input.amountMinor.toString(),
      }),
    )
    .digest("hex");
}

function refundFingerprint(input: {
  orderId: string;
  memberId: string;
  stakeTransactionId: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        orderId: input.orderId,
        memberId: input.memberId,
        stakeTransactionId: input.stakeTransactionId,
      }),
    )
    .digest("hex");
}

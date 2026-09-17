// Platform composition-root adapter for the settlement -> wallet-ledger port.
//
// Lives in the platform layer so it may combine the Wallet & Ledger application
// service with the settlement port types. A winning payout reuses the accepted
// Bet Confirm source-allocation snapshot to route historical winnings into the
// correct Member bucket(s), and debits the Betting Settlement system account;
// a correction reverses the prior payout. Both are idempotent per Order / payout
// transaction, so replay of a crashed batch or correction can never pay a
// winner twice or reverse it twice.

import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";
import {
  SettlementWalletError,
  type SettlementWalletPort,
} from "../../contexts/result-settlement/application/settlement.ports";
import { PrismaService } from "../persistence/prisma.service";

/** Counterparty account that holds committed stakes / pays winning returns. */
const BETTING_SETTLEMENT_SYSTEM_CODE = "betting-settlement";

@Injectable()
export class SettlementWalletAdapter implements SettlementWalletPort {
  constructor(
    private readonly ledger: FinancialLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  async postSettlementPayout(input: {
    orderId: string;
    memberId: string;
    drawId: string;
    amountMinor: bigint;
    currency: "THB";
    correlationId: string;
  }): Promise<{ transactionId: string }> {
    const currency = "THB" as const;
    if (input.amountMinor <= 0n) {
      throw new SettlementWalletError(
        "INSUFFICIENT_FUNDS",
        "Settlement payout must be positive integer minor units",
        { orderId: input.orderId },
      );
    }
    const accepted = await this.loadAcceptedSourceAllocation(input.orderId, input.memberId);
    const destinations = allocateSettlementPayout(input.amountMinor, accepted);
    const settlementAccountId = await this.ledger.ensureSystemAccount(
      BETTING_SETTLEMENT_SYSTEM_CODE,
      currency,
    );
    const postings: Array<{
      accountId: string;
      side: "DEBIT" | "CREDIT";
      amountMinor: bigint;
    }> = [
      { accountId: settlementAccountId, side: "DEBIT", amountMinor: input.amountMinor },
    ];
    if (destinations.cashMinor > 0n) {
      const cashAccountId = await this.ledger.ensureMemberAccount(
        input.memberId,
        "CASH",
        currency,
      );
      postings.push({ accountId: cashAccountId, side: "CREDIT", amountMinor: destinations.cashMinor });
    }
    if (destinations.bonusMinor > 0n) {
      const bonusAccountId = await this.ledger.ensureMemberAccount(
        input.memberId,
        "BONUS",
        currency,
      );
      postings.push({ accountId: bonusAccountId, side: "CREDIT", amountMinor: destinations.bonusMinor });
    }

    const transactionId = await this.ledger.post({
      businessTransactionId: `${input.orderId}:settle`,
      operationType: "SETTLEMENT_PAYOUT",
      correlationId: input.correlationId,
      idempotency: {
        scope: `SETTLEMENT_PAYOUT:${input.orderId}`,
        key: input.orderId,
        fingerprint: payoutFingerprint(input, accepted.stakeTransactionId, destinations),
      },
      domainReferences: {
        orderId: input.orderId,
        drawId: input.drawId,
        stakeTransactionId: accepted.stakeTransactionId,
        sourceAllocationPolicy: accepted.schemaVersion,
      },
      currency,
      effectiveAt: new Date(),
      postings,
    });
    return { transactionId };
  }

  private async loadAcceptedSourceAllocation(
    orderId: string,
    memberId: string,
  ): Promise<AcceptedSourceAllocation> {
    const order = await this.prisma.betOrder.findUnique({
      where: { id: orderId },
      select: { memberId: true, stakeTransactionId: true },
    });
    if (!order || order.memberId !== memberId || !order.stakeTransactionId) {
      throw sourceAllocationError(orderId, "Bet Order is missing its accepted stake transaction");
    }
    const stake = await this.prisma.financialTransaction.findUnique({
      where: { id: order.stakeTransactionId },
      select: { domainReferences: true },
    });
    if (!stake) {
      throw sourceAllocationError(orderId, "Accepted stake transaction is missing");
    }
    return parseAcceptedSourceAllocation(orderId, order.stakeTransactionId, stake.domainReferences);
  }

  async reverseSettlementPayout(input: {
    orderId: string;
    payoutTransactionId: string;
    memberId: string;
    drawId: string;
    currency: "THB";
    correlationId: string;
  }): Promise<{ transactionId: string }> {
    const transactionId = await this.ledger.reverseTransaction({
      originalTransactionId: input.payoutTransactionId,
      businessTransactionId: `${input.orderId}:settle:reversal`,
      operationType: "SETTLEMENT_PAYOUT_REVERSAL",
      correlationId: input.correlationId,
      idempotency: {
        scope: `SETTLEMENT_PAYOUT_REVERSAL:${input.payoutTransactionId}`,
        key: input.payoutTransactionId,
        fingerprint: reversalFingerprint(input),
      },
      domainReferences: { orderId: input.orderId, drawId: input.drawId },
      effectiveAt: new Date(),
    });
    return { transactionId };
  }
}

function payoutFingerprint(input: {
  orderId: string;
  memberId: string;
  drawId: string;
  amountMinor: bigint;
}, stakeTransactionId: string, destinations: SettlementPayoutDestinations): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        orderId: input.orderId,
        memberId: input.memberId,
        drawId: input.drawId,
        amountMinor: input.amountMinor.toString(),
        stakeTransactionId,
        cashMinor: destinations.cashMinor.toString(),
        bonusMinor: destinations.bonusMinor.toString(),
      }),
    )
    .digest("hex");
}

function reversalFingerprint(input: {
  orderId: string;
  payoutTransactionId: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        orderId: input.orderId,
        payoutTransactionId: input.payoutTransactionId,
      }),
    )
    .digest("hex");
}

interface AcceptedSourceAllocation {
  readonly schemaVersion: "bet-stake-source-allocation-v1";
  readonly stakeTransactionId: string;
  readonly totalStakeMinor: bigint;
  readonly allocations: readonly AcceptedSourceAllocationEntry[];
}

interface AcceptedSourceAllocationEntry {
  readonly amountMinor: bigint;
  readonly destination: "CASH" | "BONUS";
}

interface SettlementPayoutDestinations {
  readonly cashMinor: bigint;
  readonly bonusMinor: bigint;
}

function parseAcceptedSourceAllocation(
  orderId: string,
  stakeTransactionId: string,
  domainReferences: unknown,
): AcceptedSourceAllocation {
  const references = jsonObject(domainReferences);
  const snapshot = jsonObject(references?.sourceAllocationSnapshot);
  if (
    snapshot?.schemaVersion !== "bet-stake-source-allocation-v1" ||
    snapshot.orderId !== orderId
  ) {
    throw sourceAllocationError(orderId, "Accepted source-allocation snapshot is missing or has unsupported schema");
  }

  const totalStakeMinor = positiveMinor(snapshot.totalStakeMinor);
  if (totalStakeMinor === null || !Array.isArray(snapshot.allocations) || snapshot.allocations.length === 0) {
    throw sourceAllocationError(orderId, "Accepted source-allocation snapshot is incomplete");
  }

  const allocations: AcceptedSourceAllocationEntry[] = snapshot.allocations.map((raw, index) => {
    const allocation = jsonObject(raw);
    const amountMinor = positiveMinor(allocation?.amountMinor);
    if (!allocation || amountMinor === null) {
      throw sourceAllocationError(orderId, `Accepted source allocation ${index + 1} is invalid`);
    }
    if (allocation.bucket === "CASH") {
      return { amountMinor, destination: "CASH" as const };
    }
    if (allocation.bucket !== "BONUS") {
      throw sourceAllocationError(orderId, `Accepted source allocation ${index + 1} has unsupported bucket`);
    }
    if (allocation.winningsDestination === "CASH") {
      return { amountMinor, destination: "CASH" as const };
    }
    if (allocation.winningsDestination === "BONUS") {
      return { amountMinor, destination: "BONUS" as const };
    }
    if (allocation.winningsDestination === "PROPORTIONAL") {
      throw new SettlementWalletError(
        "PAYOUT_POLICY_UNSUPPORTED",
        "PROPORTIONAL promotion winnings semantics are not approved precisely enough to post settlement",
        {
          orderId,
          promotionEntitlementId: allocation.promotionEntitlementId,
          proportionalWinningsBps: allocation.proportionalWinningsBps,
        },
      );
    }
    throw sourceAllocationError(orderId, `Accepted source allocation ${index + 1} has invalid winnings destination`);
  });

  const allocatedMinor = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0n);
  if (allocatedMinor !== totalStakeMinor) {
    throw sourceAllocationError(orderId, "Accepted source allocations do not equal the snapshotted stake");
  }

  return {
    schemaVersion: "bet-stake-source-allocation-v1",
    stakeTransactionId,
    totalStakeMinor,
    allocations,
  };
}

function allocateSettlementPayout(
  payoutMinor: bigint,
  accepted: AcceptedSourceAllocation,
): SettlementPayoutDestinations {
  const shares = accepted.allocations.map((allocation, index) => {
    const weighted = payoutMinor * allocation.amountMinor;
    return {
      index,
      destination: allocation.destination,
      amountMinor: weighted / accepted.totalStakeMinor,
      remainder: weighted % accepted.totalStakeMinor,
    };
  });
  let remainingMinor = payoutMinor - shares.reduce((sum, share) => sum + share.amountMinor, 0n);
  const remainderOrder = [...shares].sort(
    (left, right) =>
      left.remainder === right.remainder
        ? left.index - right.index
        : left.remainder > right.remainder
          ? -1
          : 1,
  );
  for (let index = 0; remainingMinor > 0n; index += 1, remainingMinor -= 1n) {
    remainderOrder[index]!.amountMinor += 1n;
  }

  return shares.reduce<SettlementPayoutDestinations>(
    (result, share) =>
      share.destination === "CASH"
        ? { cashMinor: result.cashMinor + share.amountMinor, bonusMinor: result.bonusMinor }
        : { cashMinor: result.cashMinor, bonusMinor: result.bonusMinor + share.amountMinor },
    { cashMinor: 0n, bonusMinor: 0n },
  );
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveMinor(value: unknown): bigint | null {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? BigInt(value) : null;
}

function sourceAllocationError(orderId: string, message: string): SettlementWalletError {
  return new SettlementWalletError("SOURCE_ALLOCATION_INVALID", message, { orderId });
}

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
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaService } from "../persistence/prisma.service";
import {
  BetOrderWalletError,
  type BetOrderWalletPort,
  type BetStakeEffect,
} from "../../contexts/betting/application/betting-order-wallet.port";
import { toTerms } from "../../contexts/promotion/application/promotion-campaign.service";
import type { PromotionCampaignTerms } from "../../contexts/promotion/domain/campaign-terms";

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
    acceptedAt: Date;
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
      reservationId = await this.reserveStakeWithPromotionProvenanceLock(input);
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
   * Serializes Promotion-aware Bet funding against the currently eligible
   * Entitlements for this Member. Wallet account locks alone protect the shared
   * BONUS total, but they cannot prevent two concurrent Bets from attributing
   * the same Entitlement value twice when another Entitlement also contributes
   * to that shared bucket.
   *
   * The Entitlement rows remain locked until the Wallet Reservation commits.
   * A waiter therefore recalculates Entitlement-specific remaining value after
   * the prior Reservation is visible, while the Wallet repository still owns
   * the authoritative account-level availability check.
   */
  private async reserveStakeWithPromotionProvenanceLock(input: {
    orderId: string;
    memberId: string;
    drawId: string;
    amountMinor: bigint;
    currency: "THB";
    correlationId: string;
    acceptedAt: Date;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const lockedEntitlements = await tx.$queryRaw<LockedFundingEntitlementRow[]>`
        SELECT
          id,
          campaign_version_id AS "campaignVersionId",
          campaign_version AS "campaignVersion",
          terms_snapshot AS "termsSnapshot",
          reward_minor AS "rewardMinor",
          released_minor AS "releasedMinor",
          expired_minor AS "expiredMinor",
          expires_at AS "expiresAt"
        FROM promotion_entitlements
        WHERE member_id = ${input.memberId}::uuid
          AND state = 'ACTIVE'
          AND expires_at > ${input.acceptedAt}
        ORDER BY id
        FOR UPDATE
      `;

      // A concurrent replay of the same Order may have created its Reservation
      // while this call waited for the Entitlement lock. Reuse it before making
      // a fresh funding decision.
      const replay = await tx.reservation.findUnique({
        where: {
          purpose_businessReference: { purpose: "BET", businessReference: input.orderId },
        },
        select: { id: true },
      });
      if (replay) return replay.id;

      const stakeAllocation = await this.allocateStake(
        {
          orderId: input.orderId,
          memberId: input.memberId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          acceptedAt: input.acceptedAt,
        },
        tx,
        lockedEntitlements,
      );

      try {
        return await this.ledger.reserve({
          purpose: "BET",
          businessReference: input.orderId,
          memberId: input.memberId,
          currency: input.currency,
          amountMinor: input.amountMinor,
          correlationId: input.correlationId,
          idempotency: {
            scope: `BET_STAKE_RESERVE:${input.orderId}`,
            key: input.orderId,
            fingerprint: stakeFingerprint(input),
          },
          allocations: stakeAllocation.allocations,
          sourceAllocationSnapshot: stakeAllocation.snapshot as unknown as Prisma.InputJsonValue,
        });
      } catch (error) {
        throw mapWalletDenial(error);
      }
    });
  }

  /**
   * Funds the stake from the Member's spendable buckets in the accepted v1
   * promotion order: eligible BONUS first, then CASH. The returned snapshot is
   * persisted on the Reservation at reserve time so a crash/replay path never
   * re-computes Entitlement scope or ordering from mutable current state.
   */
  private async allocateStake(input: {
    orderId: string;
    memberId: string;
    amountMinor: bigint;
    currency: "THB";
    acceptedAt: Date;
  }, tx: Prisma.TransactionClient, lockedEntitlements: readonly LockedFundingEntitlementRow[]): Promise<StakeAllocationDecision> {
    const order = await tx.betOrder.findUnique({
      where: { id: input.orderId },
      select: {
        productId: true,
        lines: { select: { betTypeCode: true }, orderBy: { id: "asc" } },
      },
    });
    if (!order) {
      throw new BetOrderWalletError("INSUFFICIENT_FUNDS", "Bet Order funding scope is unavailable", {
        orderId: input.orderId,
      });
    }

    const allocations: Array<{ accountId: string; amountMinor: bigint }> = [];
    const snapshotAllocations: StakeAllocationSnapshotAllocation[] = [];
    let remainingMinor = input.amountMinor;

    const bonusAccountId = await this.ledger.ensureMemberAccount(input.memberId, "BONUS", input.currency);
    let remainingBonusAvailable = await this.ledger.getAvailableMinorUnits(bonusAccountId);
    const eligibleEntitlements = await this.eligibleFundingEntitlements({
      memberId: input.memberId,
      productId: order.productId,
      betTypeCodes: [...new Set(order.lines.map((line) => line.betTypeCode))],
      at: input.acceptedAt,
    }, tx, lockedEntitlements);

    let bonusAllocatedMinor = 0n;
    for (const entitlement of eligibleEntitlements) {
      if (remainingMinor <= 0n || remainingBonusAvailable <= 0n) break;
      const entitlementAvailableMinor = entitlement.availableMinor < remainingBonusAvailable
        ? entitlement.availableMinor
        : remainingBonusAvailable;
      if (entitlementAvailableMinor <= 0n) continue;
      const takeMinor = entitlementAvailableMinor < remainingMinor ? entitlementAvailableMinor : remainingMinor;
      snapshotAllocations.push({
        bucket: "BONUS",
        amountMinor: takeMinor.toString(),
        promotionEntitlementId: entitlement.id,
        campaignVersionId: entitlement.campaignVersionId,
        campaignVersion: entitlement.campaignVersion,
        winningsDestination: entitlement.terms.winningsDestination,
        proportionalWinningsBps: entitlement.terms.proportionalWinningsBps,
      });
      bonusAllocatedMinor += takeMinor;
      remainingBonusAvailable -= takeMinor;
      remainingMinor -= takeMinor;
    }
    if (bonusAllocatedMinor > 0n) {
      allocations.push({ accountId: bonusAccountId, amountMinor: bonusAllocatedMinor });
    }

    if (remainingMinor > 0n) {
      const cashAccountId = await this.ledger.ensureMemberAccount(input.memberId, "CASH", input.currency);
      const availableCashMinor = await this.ledger.getAvailableMinorUnits(cashAccountId);
      const takeMinor = availableCashMinor < remainingMinor ? availableCashMinor : remainingMinor;
      if (takeMinor > 0n) {
        allocations.push({ accountId: cashAccountId, amountMinor: takeMinor });
        snapshotAllocations.push({ bucket: "CASH", amountMinor: takeMinor.toString() });
        remainingMinor -= takeMinor;
      }
    }

    if (remainingMinor > 0n) {
      throw new BetOrderWalletError(
        "INSUFFICIENT_FUNDS",
        "Member spendable balance does not cover the stake",
        { amountMinor: input.amountMinor.toString(), shortfallMinor: remainingMinor.toString() },
      );
    }

    return {
      allocations,
      snapshot: {
        schemaVersion: "bet-stake-source-allocation-v1",
        orderId: input.orderId,
        policy: "ELIGIBLE_PROMOTION_BONUS_BEFORE_CASH",
        productId: order.productId,
        betTypeCodes: [...new Set(order.lines.map((line) => line.betTypeCode))].sort(),
        totalStakeMinor: input.amountMinor.toString(),
        acceptedAt: input.acceptedAt.toISOString(),
        allocations: snapshotAllocations,
      },
    };
  }

  private async eligibleFundingEntitlements(input: {
    memberId: string;
    productId: string;
    betTypeCodes: readonly string[];
    at: Date;
  }, tx: Prisma.TransactionClient, lockedRows: readonly LockedFundingEntitlementRow[]): Promise<EligibleFundingEntitlement[]> {
    const usedByEntitlement = await this.usedPromotionAllocationMinorByEntitlement(
      tx,
      input.memberId,
    );

    return lockedRows
      .map((row) => {
        const terms = toTerms(row.termsSnapshot);
        const historicalRemainingMinor = row.rewardMinor - row.releasedMinor - row.expiredMinor;
        const alreadyAllocatedMinor = usedByEntitlement.get(row.id) ?? 0n;
        return {
          id: row.id,
          campaignVersionId: row.campaignVersionId,
          campaignVersion: row.campaignVersion,
          terms,
          expiresAt: row.expiresAt,
          availableMinor: historicalRemainingMinor - alreadyAllocatedMinor,
        };
      })
      .filter((row) => row.availableMinor > 0n && entitlementCoversOrderScope(row.terms, input))
      .sort((left, right) => {
        const expiry = left.expiresAt.getTime() - right.expiresAt.getTime();
        if (expiry !== 0) return expiry;
        const priority = right.terms.stacking.priority - left.terms.stacking.priority;
        if (priority !== 0) return priority;
        return left.id.localeCompare(right.id);
      });
  }

  /**
   * Returns the Entitlement value that is still economically committed to Bet
   * Reservations/stakes. Active Reservations count immediately. Consumed stake
   * Reservations keep counting until their stake transaction is reversed by a
   * cancellation/refund; a reversal restores the original Entitlement capacity.
   */
  private async usedPromotionAllocationMinorByEntitlement(
    tx: Prisma.TransactionClient,
    memberId: string,
  ): Promise<Map<string, bigint>> {
    const reservations = await tx.reservation.findMany({
      where: {
        memberId,
        purpose: "BET",
        releasedAt: null,
      },
      select: {
        consumedAt: true,
        sourceAllocationSnapshot: true,
        consumingTransaction: {
          select: {
            correctionTransactions: {
              where: { correctionKind: "REVERSAL" },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });

    const totals = new Map<string, bigint>();
    for (const reservation of reservations) {
      if (
        reservation.consumedAt !== null &&
        reservation.consumingTransaction?.correctionTransactions.length
      ) {
        continue;
      }

      for (const allocation of promotionAllocationsFromSnapshot(
        reservation.sourceAllocationSnapshot,
      )) {
        totals.set(
          allocation.promotionEntitlementId,
          (totals.get(allocation.promotionEntitlementId) ?? 0n) + allocation.amountMinor,
        );
      }
    }
    return totals;
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

interface StakeAllocationDecision {
  readonly allocations: Array<{ accountId: string; amountMinor: bigint }>;
  readonly snapshot: StakeAllocationSnapshot;
}

interface StakeAllocationSnapshot {
  readonly schemaVersion: "bet-stake-source-allocation-v1";
  readonly orderId: string;
  readonly policy: "ELIGIBLE_PROMOTION_BONUS_BEFORE_CASH";
  readonly productId: string;
  readonly betTypeCodes: readonly string[];
  readonly totalStakeMinor: string;
  readonly acceptedAt: string;
  readonly allocations: readonly StakeAllocationSnapshotAllocation[];
}

type StakeAllocationSnapshotAllocation =
  | {
      readonly bucket: "BONUS";
      readonly amountMinor: string;
      readonly promotionEntitlementId: string;
      readonly campaignVersionId: string;
      readonly campaignVersion: number;
      readonly winningsDestination: PromotionCampaignTerms["winningsDestination"];
      readonly proportionalWinningsBps: number | null;
    }
  | { readonly bucket: "CASH"; readonly amountMinor: string };

interface EligibleFundingEntitlement {
  readonly id: string;
  readonly campaignVersionId: string;
  readonly campaignVersion: number;
  readonly terms: PromotionCampaignTerms;
  readonly expiresAt: Date;
  readonly availableMinor: bigint;
}

interface LockedFundingEntitlementRow {
  readonly id: string;
  readonly campaignVersionId: string;
  readonly campaignVersion: number;
  readonly termsSnapshot: Prisma.JsonValue;
  readonly rewardMinor: bigint;
  readonly releasedMinor: bigint;
  readonly expiredMinor: bigint;
  readonly expiresAt: Date;
}

interface HistoricalPromotionAllocation {
  readonly promotionEntitlementId: string;
  readonly amountMinor: bigint;
}

function promotionAllocationsFromSnapshot(snapshot: Prisma.JsonValue | null): HistoricalPromotionAllocation[] {
  if (!isJsonObject(snapshot)) return [];
  if (snapshot.schemaVersion !== "bet-stake-source-allocation-v1") return [];
  if (!Array.isArray(snapshot.allocations)) return [];

  const result: HistoricalPromotionAllocation[] = [];
  for (const rawAllocation of snapshot.allocations) {
    if (!isJsonObject(rawAllocation) || rawAllocation.bucket !== "BONUS") continue;
    if (typeof rawAllocation.promotionEntitlementId !== "string") continue;
    if (
      typeof rawAllocation.amountMinor !== "string" ||
      !/^[1-9]\d*$/.test(rawAllocation.amountMinor)
    ) {
      throw new Error("Bet Reservation contains invalid Promotion allocation provenance");
    }
    result.push({
      promotionEntitlementId: rawAllocation.promotionEntitlementId,
      amountMinor: BigInt(rawAllocation.amountMinor),
    });
  }
  return result;
}

function isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function entitlementCoversOrderScope(
  terms: PromotionCampaignTerms,
  order: { readonly productId: string; readonly betTypeCodes: readonly string[] },
): boolean {
  const productEligible =
    terms.scope.eligibleProductIds.length === 0 ||
    terms.scope.eligibleProductIds.includes(order.productId);
  if (!productEligible) return false;

  return order.betTypeCodes.every(
    (betTypeCode) =>
      terms.scope.eligibleBetTypeCodes.length === 0 ||
      terms.scope.eligibleBetTypeCodes.includes(betTypeCode),
  );
}

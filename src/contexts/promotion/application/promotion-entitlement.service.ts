import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  promotionTurnoverTargetMinor,
  type PromotionCampaignState,
  type PromotionCampaignTerms,
} from "../domain/campaign-terms";
import {
  assertEntitlementTransition,
  decidePromotionEligibility,
  entitlementAllowedActions,
  entitlementExpiryFor,
  isEntitlementTerminal,
  remainingEntitlementBonusMinor,
  resolvePromotionStacking,
  type PromotionEntitlementState,
  type PromotionStackingCandidateFact,
  type PromotionStackingDecision,
} from "../domain/entitlement-snapshot";
import {
  assertTurnoverEntryTransition,
  calculateTurnoverAdjustment,
  calculateTurnoverContribution,
  calculateTurnoverProgress,
  type PromotionTurnoverEntryKind,
  type PromotionTurnoverEntryState,
  type TurnoverProgress,
} from "../domain/turnover-ledger";
import { PromotionRuleError } from "../domain/rule-error";
import { PromotionCommandService } from "./promotion-command.service";
import { PROMOTION_LEDGER_PORT, type PromotionLedgerPort } from "./promotion-ledger.port";
import {
  PROMOTION_MEMBER_FACTS_PORT,
  type PromotionMemberFactsPort,
} from "./promotion-member-facts.port";
import { toTerms } from "./promotion-campaign.service";

const ENTITLEMENT_SELECT = {
  id: true,
  memberId: true,
  campaignId: true,
  campaignVersionId: true,
  campaignVersion: true,
  state: true,
  version: true,
  termsSnapshot: true,
  stackingDecision: true,
  currency: true,
  rewardMinor: true,
  turnoverTargetMinor: true,
  releasedMinor: true,
  expiredMinor: true,
  grantedAt: true,
  expiresAt: true,
  completedAt: true,
  expiredAt: true,
  revokedAt: true,
  grantLedgerTransactionId: true,
  releaseLedgerTransactionId: true,
  expiryLedgerTransactionId: true,
  correlationId: true,
  createdAt: true,
  updatedAt: true,
  campaign: { select: { code: true } },
  turnoverEntries: {
    select: {
      id: true,
      betReference: true,
      entryKind: true,
      state: true,
      contributionMinor: true,
      stakeMinor: true,
      scopeReference: true,
      correctsEntryId: true,
      occurredAt: true,
      finalizedAt: true,
      removedAt: true,
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.PromotionEntitlementSelect;

type EntitlementRow = Prisma.PromotionEntitlementGetPayload<{ select: typeof ENTITLEMENT_SELECT }>;

export interface PromotionTurnoverEntryView {
  readonly id: string;
  readonly betReference: string;
  readonly entryKind: PromotionTurnoverEntryKind;
  readonly state: PromotionTurnoverEntryState;
  readonly contributionMinor: bigint;
  readonly stakeMinor: bigint;
  readonly occurredAt: Date;
  readonly finalizedAt: Date | null;
  readonly removedAt: Date | null;
  readonly correctsEntryId: string | null;
}

export interface PromotionEntitlementView {
  readonly id: string;
  readonly memberId: string;
  readonly campaignId: string;
  readonly campaignCode: string;
  readonly campaignVersionId: string;
  readonly campaignVersion: number;
  readonly state: PromotionEntitlementState;
  readonly version: number;
  readonly terms: PromotionCampaignTerms;
  readonly stackingDecision: PromotionStackingDecision;
  readonly currency: string;
  readonly rewardMinor: bigint;
  readonly turnoverTargetMinor: bigint;
  readonly releasedMinor: bigint;
  readonly expiredMinor: bigint;
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly completedAt: Date | null;
  readonly expiredAt: Date | null;
  readonly revokedAt: Date | null;
  readonly grantLedgerTransactionId: string | null;
  readonly releaseLedgerTransactionId: string | null;
  readonly expiryLedgerTransactionId: string | null;
  readonly turnover: TurnoverProgress;
  readonly turnoverEntries: readonly PromotionTurnoverEntryView[];
  readonly allowedActions: readonly string[];
}

export interface ClaimPromotionInput {
  readonly campaignVersionId: string;
  readonly correlationId: string;
}

export interface RecordBetTurnoverInput {
  readonly memberId: string;
  readonly betReference: string;
  readonly productId: string;
  readonly betTypeCode: string;
  readonly stakeMinor: bigint;
  readonly payoutRef: string;
  readonly acceptedAt: Date;
  readonly correlationId: string;
}

export interface TurnoverMutationInput {
  readonly memberId: string;
  readonly betReference: string;
  readonly correlationId: string;
}

export interface TurnoverMutationResult {
  readonly recorded: boolean;
  readonly reason: string | null;
  readonly entitlementId: string | null;
  readonly contributionMinor: string;
  readonly entitlement: PromotionEntitlementView | null;
}

/**
 * Member Promotion Entitlements: grant, turnover progress and monetary release.
 *
 * Grant, release and expiry are all financial-state dependent: an Entitlement
 * only becomes ACTIVE with a durable Wallet & Ledger grant posting, and only
 * becomes COMPLETED once the authoritative BONUS → CASH conversion posting
 * succeeded. Turnover contribution is recorded from the accepted bet allocation
 * and never re-derived from the latest Campaign configuration.
 */
@Injectable()
export class PromotionEntitlementService extends PromotionCommandService {
  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(PROMOTION_LEDGER_PORT) private readonly ledger: PromotionLedgerPort,
    @Inject(PROMOTION_MEMBER_FACTS_PORT)
    private readonly memberFacts: PromotionMemberFactsPort,
  ) {
    super(prisma);
  }

  /**
   * Claims an eligible published Promotion for the authenticated Member. The
   * Entitlement id is derived deterministically from Member + Campaign version,
   * and the Ledger grant is idempotent on that id, so a retry after a crash
   * between the durable posting and the Entitlement insert restores exactly one
   * grant and one Entitlement.
   */
  async claimEntitlement(
    memberId: string,
    input: ClaimPromotionInput,
    now: Date,
  ): Promise<PromotionEntitlementView> {
    const version = await this.prisma.promotionCampaignVersion.findUnique({
      where: { id: input.campaignVersionId },
      select: {
        id: true,
        campaignId: true,
        version: true,
        state: true,
        terms: true,
        termsDigest: true,
        effectiveFrom: true,
        effectiveUntil: true,
        campaign: { select: { code: true } },
      },
    });
    if (!version) {
      throw new PromotionRuleError("NOT_FOUND", "Promotion Campaign version not found", {
        campaignVersionId: input.campaignVersionId,
      });
    }
    const terms = toTerms(version.terms);
    const entitlementId = deterministicEntitlementId(memberId, version.id);

    return this.transaction(async (tx) => {
      await this.lockMember(tx, memberId);
      const existing = await tx.promotionEntitlement.findUnique({
        where: { id: entitlementId },
        select: ENTITLEMENT_SELECT,
      });
      if (existing) return toEntitlementView(existing);

      const facts = await this.memberFacts.getMemberFacts(memberId);
      const held = await tx.promotionEntitlement.findMany({
        where: { memberId, state: { in: ["ACTIVE", "RELEASE_PENDING"] } },
        select: ENTITLEMENT_SELECT,
      });
      const decision = decidePromotionEligibility({
        version: {
          id: version.id,
          state: version.state as PromotionCampaignState,
          effectiveFrom: version.effectiveFrom,
          effectiveUntil: version.effectiveUntil,
        },
        terms,
        facts,
        heldCampaignVersionIds: held.map((row) => row.campaignVersionId),
        at: now,
      });
      if (!decision.eligible) {
        throw new PromotionRuleError(
          "ENTITLEMENT_NOT_ELIGIBLE",
          "The Member is not eligible for this Promotion",
          { reasons: decision.reasons },
        );
      }

      const stackingDecision = resolveClaimStacking({
        held,
        candidate: {
          campaignVersionId: version.id,
          campaignCode: version.campaign.code,
          campaignVersion: version.version,
          mode: terms.stacking.mode,
          priority: terms.stacking.priority,
          compatibilityGroup: terms.stacking.compatibilityGroup,
          expiresAt: entitlementExpiryFor(terms, now),
        },
      });
      const granted = stackingDecision.granted.some(
        (candidate) => candidate.campaignVersionId === version.id,
      );
      if (!granted) {
        throw new PromotionRuleError(
          "ENTITLEMENT_NOT_ELIGIBLE",
          "The Promotion is suppressed by the Member's existing Entitlements",
          { stackingDecision },
        );
      }

      const grantLedgerTransactionId = await this.ledger.grantBonus({
        entitlementId,
        memberId,
        amountMinor: BigInt(terms.rewardAmountMinor),
        fundingSource: terms.fundingSource,
        correlationId: input.correlationId,
        effectiveAt: now,
      });

      const created = await tx.promotionEntitlement.create({
        data: {
          id: entitlementId,
          memberId,
          campaignId: version.campaignId,
          campaignVersionId: version.id,
          campaignVersion: version.version,
          state: "ACTIVE",
          version: 1,
          termsSnapshot: terms as unknown as Prisma.InputJsonValue,
          stackingDecision: stackingDecision as unknown as Prisma.InputJsonValue,
          currency: terms.currency,
          rewardMinor: BigInt(terms.rewardAmountMinor),
          turnoverTargetMinor: promotionTurnoverTargetMinor(terms),
          releasedMinor: 0n,
          expiredMinor: 0n,
          grantedAt: now,
          expiresAt: entitlementExpiryFor(terms, now),
          grantLedgerTransactionId,
          idempotencyScope: `PROMOTION_CLAIM:${memberId}`,
          idempotencyKey: version.id,
          fingerprint: createHash("sha256")
            .update(`${memberId}:${version.id}:${version.termsDigest}`)
            .digest("hex"),
          correlationId: input.correlationId,
        },
        select: ENTITLEMENT_SELECT,
      });
      return toEntitlementView(created);
    });
  }

  /**
   * Idempotent Member claim command. The Idempotency-Key is the command
   * identity: a same-key/same-payload retry replays the durable prior result and
   * a changed payload for the same key is an IDEMPOTENCY_CONFLICT.
   */
  async claimEntitlementIdempotent(
    memberId: string,
    input: { campaignVersionId: string; idempotencyKey: string },
    now: Date,
    correlationId: string,
  ): Promise<PromotionEntitlementView> {
    const key = input.idempotencyKey?.trim();
    if (!key || key.length > 200) {
      throw new PromotionRuleError(
        "VALIDATION_ERROR",
        "Idempotency-Key is required and must be at most 200 characters",
      );
    }
    const result = await this.executeCommand(
      {
        scope: `PROMOTION_CLAIM:${memberId}`,
        key,
        fingerprint: this.requestFingerprint({ campaignVersionId: input.campaignVersionId }),
        responseCode: 201,
      },
      () => this.claimEntitlement(memberId, { campaignVersionId: input.campaignVersionId, correlationId }, now),
    );
    // The Idempotency-Key contract stores the durable JSON result; the same
    // representation is returned on a first execution and on a replay.
    return reviveEntitlementView(result);
  }

  /**
   * Records provisional turnover for a confirmed eligible Bet. Exactly one
   * Entitlement funds a Bet; source selection is deterministic (nearest expiry,
   * then explicit priority, then stable id) and the accepted scope/allocation is
   * snapshotted on the contribution entry.
   */
  async recordConfirmedBetTurnover(
    input: RecordBetTurnoverInput,
  ): Promise<TurnoverMutationResult> {
    return this.transaction(async (tx) => {
      await this.lockMember(tx, input.memberId);
      const candidates = await tx.promotionEntitlement.findMany({
        where: { memberId: input.memberId, state: "ACTIVE" },
        select: ENTITLEMENT_SELECT,
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      });

      const eligible = candidates
        .map((row) => {
          const terms = toTerms(row.termsSnapshot);
          const decision = calculateTurnoverContribution(terms, {
            betReference: input.betReference,
            productId: input.productId,
            betTypeCode: input.betTypeCode,
            stakeMinor: input.stakeMinor,
            payoutRef: input.payoutRef,
            acceptedAt: input.acceptedAt,
          });
          return { row, terms, decision };
        })
        .filter(
          (candidate) =>
            candidate.decision.eligible && candidate.row.expiresAt.getTime() > input.acceptedAt.getTime(),
        )
        .sort((left, right) => {
          const expiry = left.row.expiresAt.getTime() - right.row.expiresAt.getTime();
          if (expiry !== 0) return expiry;
          const priority =
            right.terms.stacking.priority - left.terms.stacking.priority;
          if (priority !== 0) return priority;
          return left.row.id < right.row.id ? -1 : 1;
        });

      const winner = eligible[0];
      if (!winner) {
        return {
          recorded: false,
          reason: "NO_ELIGIBLE_ENTITLEMENT",
          entitlementId: null,
          contributionMinor: "0",
          entitlement: null,
        };
      }

      const existing = await tx.promotionTurnoverEntry.findUnique({
        where: {
          entitlementId_betReference_entryKind: {
            entitlementId: winner.row.id,
            betReference: input.betReference,
            entryKind: "BET",
          },
        },
      });
      if (existing) {
        const expected = turnoverEntryFingerprint(input);
        if (existing.fingerprint !== expected) {
          throw new PromotionRuleError(
            "IDEMPOTENCY_CONFLICT",
            "The Bet reference was already recorded with a different turnover payload",
            { betReference: input.betReference },
          );
        }
        return {
          recorded: true,
          reason: null,
          entitlementId: winner.row.id,
          contributionMinor: existing.contributionMinor.toString(),
          entitlement: await this.requireEntitlement(tx, winner.row.id),
        };
      }

      await tx.promotionTurnoverEntry.create({
        data: {
          id: randomUUID(),
          entitlementId: winner.row.id,
          memberId: input.memberId,
          betReference: input.betReference,
          entryKind: "BET",
          state: "PROVISIONAL",
          contributionMinor: winner.decision.contributionMinor,
          stakeMinor: input.stakeMinor,
          currency: "THB",
          scopeReference: {
            productId: input.productId,
            betTypeCode: input.betTypeCode,
            payoutRef: input.payoutRef,
          } as unknown as Prisma.InputJsonValue,
          sourceAllocation: {
            stakeMinor: input.stakeMinor.toString(),
            basis: "ACCEPTED_SOURCE_ALLOCATION",
          } as unknown as Prisma.InputJsonValue,
          idempotencyScope: `PROMOTION_TURNOVER_PROVISIONAL:${input.memberId}`,
          idempotencyKey: input.betReference,
          fingerprint: turnoverEntryFingerprint(input),
          correlationId: input.correlationId,
          occurredAt: input.acceptedAt,
        },
      });

      return {
        recorded: true,
        reason: null,
        entitlementId: winner.row.id,
        contributionMinor: winner.decision.contributionMinor.toString(),
        entitlement: await this.requireEntitlement(tx, winner.row.id),
      };
    });
  }

  /** Cancellation/refund removes the provisional contribution; it was never earned. */
  async releaseProvisionalTurnover(
    input: TurnoverMutationInput,
  ): Promise<TurnoverMutationResult> {
    return this.transitionBetEntry(input, "REMOVED");
  }

  /** A terminal non-refunded outcome finalizes the contribution and may release the Promotion. */
  async finalizeTurnover(input: TurnoverMutationInput): Promise<TurnoverMutationResult> {
    return this.transitionBetEntry(input, "FINALIZED");
  }

  /**
   * Compensating correction for a later correction/re-settlement. The original
   * contribution is never rewritten: the signed difference is recorded as a new
   * FINALIZED adjustment entry, then the release is re-evaluated.
   */
  async correctTurnover(input: {
    memberId: string;
    betReference: string;
    correctedContributionMinor: bigint;
    correctionReference: string;
    correlationId: string;
  }): Promise<TurnoverMutationResult> {
    return this.transaction(async (tx) => {
      await this.lockMember(tx, input.memberId);
      const original = await tx.promotionTurnoverEntry.findFirst({
        where: { memberId: input.memberId, betReference: input.betReference, entryKind: "BET" },
      });
      if (!original) {
        throw new PromotionRuleError("NOT_FOUND", "Turnover contribution not found", {
          betReference: input.betReference,
        });
      }
      if (original.state !== "FINALIZED") {
        throw new PromotionRuleError(
          "TURNOVER_STATE_CONFLICT",
          "Only a finalized contribution can be corrected",
          { state: original.state },
        );
      }

      const existing = await tx.promotionTurnoverEntry.findFirst({
        where: {
          entitlementId: original.entitlementId,
          entryKind: "ADJUSTMENT",
          idempotencyKey: input.correctionReference,
        },
      });
      if (existing) {
        return {
          recorded: true,
          reason: null,
          entitlementId: original.entitlementId,
          contributionMinor: existing.contributionMinor.toString(),
          entitlement: await this.requireEntitlement(tx, original.entitlementId),
        };
      }

      const delta = calculateTurnoverAdjustment(
        original.contributionMinor,
        input.correctedContributionMinor,
      );
      const now = new Date();
      await tx.promotionTurnoverEntry.create({
        data: {
          id: randomUUID(),
          entitlementId: original.entitlementId,
          memberId: input.memberId,
          betReference: `${input.betReference}#correction`,
          entryKind: "ADJUSTMENT",
          state: "FINALIZED",
          contributionMinor: delta,
          stakeMinor: original.stakeMinor,
          currency: original.currency,
          scopeReference: original.scopeReference as Prisma.InputJsonValue,
          sourceAllocation: {
            basis: "CORRECTION",
            correctedContributionMinor: input.correctedContributionMinor.toString(),
          } as unknown as Prisma.InputJsonValue,
          correctsEntryId: original.id,
          idempotencyScope: `PROMOTION_TURNOVER_CORRECTION:${input.memberId}`,
          idempotencyKey: input.correctionReference,
          fingerprint: createHash("sha256")
            .update(`${original.id}:${delta.toString()}`)
            .digest("hex"),
          correlationId: input.correlationId,
          occurredAt: now,
          finalizedAt: now,
        },
      });

      const settled = await this.settleReleasePartial(tx, original.entitlementId, input.correlationId, now);
      return {
        recorded: true,
        reason: null,
        entitlementId: original.entitlementId,
        contributionMinor: delta.toString(),
        entitlement: toEntitlementView(settled),
      };
    });
  }

  async listEntitlements(
    memberId: string,
    input: { limit?: number; cursor?: string; state?: string },
  ): Promise<{ items: PromotionEntitlementView[]; nextCursor: string | null }> {
    const limit = input.limit === undefined ? 20 : input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new PromotionRuleError("VALIDATION_ERROR", "limit must be an integer between 1 and 100");
    }
    const rows = await this.prisma.promotionEntitlement.findMany({
      where: {
        memberId,
        ...(input.state ? { state: input.state } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: ENTITLEMENT_SELECT,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toEntitlementView),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  async getEntitlement(memberId: string, entitlementId: string): Promise<PromotionEntitlementView> {
    const row = await this.prisma.promotionEntitlement.findUnique({
      where: { id: entitlementId },
      select: ENTITLEMENT_SELECT,
    });
    if (!row || row.memberId !== memberId) {
      throw new PromotionRuleError("NOT_FOUND", "Promotion Entitlement not found", {
        entitlementId,
      });
    }
    return toEntitlementView(row);
  }

  /**
   * Completes the turnover release: ACTIVE → RELEASE_PENDING → COMPLETED, where
   * COMPLETED is unreachable until the BONUS → CASH conversion posting is
   * durable. Re-running after a crash replays the same conversion (idempotent on
   * the Entitlement) instead of converting twice.
   */
  async completeReleaseIfReached(
    memberId: string,
    entitlementId: string,
    correlationId: string,
  ): Promise<PromotionEntitlementView> {
    return this.transaction(async (tx) => {
      await this.lockMember(tx, memberId);
      const settled = await this.settleReleasePartial(tx, entitlementId, correlationId, new Date());
      if (settled.memberId !== memberId) {
        throw new PromotionRuleError("NOT_FOUND", "Promotion Entitlement not found", {
          entitlementId,
        });
      }
      return toEntitlementView(settled);
    });
  }

  /**
   * Expiry removes only the remaining BONUS value traceable to the Entitlement
   * through a new Ledger posting. CASH is never touched, turnover history is
   * preserved, and an Entitlement that already converted its value is COMPLETED
   * rather than expired.
   */
  async expireEntitlementIfDue(
    memberId: string,
    entitlementId: string,
    now: Date,
    correlationId: string,
  ): Promise<PromotionEntitlementView> {
    return this.transaction(async (tx) => {
      await this.lockMember(tx, memberId);
      const current = await this.lockEntitlement(tx, entitlementId);
      if (current.memberId !== memberId) {
        throw new PromotionRuleError("NOT_FOUND", "Promotion Entitlement not found", {
          entitlementId,
        });
      }
      if (isEntitlementTerminal(current.state as PromotionEntitlementState)) {
        return toEntitlementView(current);
      }
      if (current.expiresAt.getTime() > now.getTime()) return toEntitlementView(current);
      if (current.state === "RELEASE_PENDING" && current.releaseLedgerTransactionId) {
        assertEntitlementTransition(current.state as PromotionEntitlementState, "COMPLETED");
        const completed = await tx.promotionEntitlement.update({
          where: { id: entitlementId },
          data: { state: "COMPLETED", version: { increment: 1 }, completedAt: now },
          select: ENTITLEMENT_SELECT,
        });
        return toEntitlementView(completed);
      }

      assertEntitlementTransition(current.state as PromotionEntitlementState, "EXPIRED");
      const remaining = remainingEntitlementBonusMinor({
        rewardMinor: current.rewardMinor,
        releasedMinor: current.releasedMinor,
        expiredMinor: current.expiredMinor,
      });
      const terms = toTerms(current.termsSnapshot);
      let expiryLedgerTransactionId: string | null = null;
      if (remaining > 0n) {
        expiryLedgerTransactionId = await this.ledger.removeExpiredBonus({
          entitlementId,
          memberId,
          amountMinor: remaining,
          fundingSource: terms.fundingSource,
          correlationId,
          effectiveAt: now,
        });
      }
      const expired = await tx.promotionEntitlement.update({
        where: { id: entitlementId },
        data: {
          state: "EXPIRED",
          version: { increment: 1 },
          expiredAt: now,
          expiredMinor: current.expiredMinor + remaining,
          expiryLedgerTransactionId,
        },
        select: ENTITLEMENT_SELECT,
      });
      return toEntitlementView(expired);
    });
  }

  private async settleReleasePartial(
    tx: Prisma.TransactionClient,
    entitlementId: string,
    correlationId: string,
    now: Date,
  ): Promise<EntitlementRow> {
    const current = await this.lockEntitlement(tx, entitlementId);
    if (isEntitlementTerminal(current.state as PromotionEntitlementState)) return current;

    const progress = calculateTurnoverProgress(
      current.turnoverEntries.map((entry) => ({
        entryKind: entry.entryKind as PromotionTurnoverEntryKind,
        state: entry.state as PromotionTurnoverEntryState,
        contributionMinor: entry.contributionMinor,
      })),
      current.turnoverTargetMinor,
    );
    if (current.state === "ACTIVE") {
      if (!progress.releaseReached) return current;
      assertEntitlementTransition("ACTIVE", "RELEASE_PENDING");
    }

    const pending = await tx.promotionEntitlement.update({
      where: { id: entitlementId },
      data: {
        state: "RELEASE_PENDING",
        version:
          current.state === "ACTIVE" ? { increment: 1 } : current.version,
      },
      select: ENTITLEMENT_SELECT,
    });
    if (pending.releaseLedgerTransactionId) {
      assertEntitlementTransition("RELEASE_PENDING", "COMPLETED");
      return tx.promotionEntitlement.update({
        where: { id: entitlementId },
        data: { state: "COMPLETED", version: { increment: 1 }, completedAt: now },
        select: ENTITLEMENT_SELECT,
      });
    }

    const remaining = remainingEntitlementBonusMinor({
      rewardMinor: pending.rewardMinor,
      releasedMinor: pending.releasedMinor,
      expiredMinor: pending.expiredMinor,
    });
    if (remaining <= 0n) {
      throw new PromotionRuleError(
        "TURNOVER_RELEASE_UNAVAILABLE",
        "There is no remaining Promotion BONUS value to convert to CASH",
        { entitlementId },
      );
    }

    const terms = toTerms(pending.termsSnapshot);
    const conversionLedgerTransactionId = await this.ledger.convertBonusToCash({
      entitlementId,
      memberId: pending.memberId,
      amountMinor: remaining,
      fundingSource: terms.fundingSource,
      correlationId,
      effectiveAt: now,
    });
    assertEntitlementTransition("RELEASE_PENDING", "COMPLETED");
    return tx.promotionEntitlement.update({
      where: { id: entitlementId },
      data: {
        state: "COMPLETED",
        version: { increment: 1 },
        completedAt: now,
        releaseLedgerTransactionId: conversionLedgerTransactionId,
        releasedMinor: pending.releasedMinor + remaining,
      },
      select: ENTITLEMENT_SELECT,
    });
  }

  private async transitionBetEntry(
    input: TurnoverMutationInput,
    target: "FINALIZED" | "REMOVED",
  ): Promise<TurnoverMutationResult> {
    return this.transaction(async (tx) => {
      await this.lockMember(tx, input.memberId);
      const entry = await tx.promotionTurnoverEntry.findFirst({
        where: { memberId: input.memberId, betReference: input.betReference, entryKind: "BET" },
      });
      if (!entry) {
        throw new PromotionRuleError("NOT_FOUND", "Turnover contribution not found", {
          betReference: input.betReference,
        });
      }
      const now = new Date();
      if (entry.state === target) {
        return {
          recorded: true,
          reason: null,
          entitlementId: entry.entitlementId,
          contributionMinor: entry.contributionMinor.toString(),
          entitlement: await this.requireEntitlement(tx, entry.entitlementId),
        };
      }
      assertTurnoverEntryTransition(
        entry.state as PromotionTurnoverEntryState,
        target,
      );
      await tx.promotionTurnoverEntry.update({
        where: { id: entry.id },
        data:
          target === "FINALIZED"
            ? { state: "FINALIZED", finalizedAt: now }
            : { state: "REMOVED", removedAt: now },
      });

      if (target === "FINALIZED") {
        const settled = await this.settleReleasePartial(tx, entry.entitlementId, input.correlationId, now);
        return {
          recorded: true,
          reason: null,
          entitlementId: entry.entitlementId,
          contributionMinor: entry.contributionMinor.toString(),
          entitlement: toEntitlementView(settled),
        };
      }
      return {
        recorded: true,
        reason: null,
        entitlementId: entry.entitlementId,
        contributionMinor: entry.contributionMinor.toString(),
        entitlement: await this.requireEntitlement(tx, entry.entitlementId),
      };
    });
  }

  private async requireEntitlement(
    tx: Prisma.TransactionClient,
    entitlementId: string,
  ): Promise<PromotionEntitlementView> {
    const row = await tx.promotionEntitlement.findUniqueOrThrow({
      where: { id: entitlementId },
      select: ENTITLEMENT_SELECT,
    });
    return toEntitlementView(row);
  }

  private async lockEntitlement(
    tx: Prisma.TransactionClient,
    entitlementId: string,
  ): Promise<EntitlementRow> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM promotion_entitlements WHERE id = ${entitlementId}::uuid FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new PromotionRuleError("NOT_FOUND", "Promotion Entitlement not found", {
        entitlementId,
      });
    }
    return tx.promotionEntitlement.findUniqueOrThrow({
      where: { id: entitlementId },
      select: ENTITLEMENT_SELECT,
    });
  }

  private async lockMember(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`promotion-member:${memberId}`}, 0))::text`;
  }
}

/**
 * Entitlement id derived from Member + Campaign version. Deterministic ids make
 * the grant exactly-once across retries and crashes instead of relying on a
 * client-supplied key being reused.
 */
export function deterministicEntitlementId(memberId: string, campaignVersionId: string): string {
  const hex = createHash("sha256").update(`${memberId}:${campaignVersionId}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function turnoverEntryFingerprint(input: {
  betReference: string;
  productId: string;
  betTypeCode: string;
  stakeMinor: bigint;
  payoutRef: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.betReference,
        input.productId,
        input.betTypeCode,
        input.stakeMinor.toString(),
        input.payoutRef,
      ].join(":"),
    )
    .digest("hex");
}

export function toEntitlementView(row: EntitlementRow): PromotionEntitlementView {
  const state = row.state as PromotionEntitlementState;
  const entries = row.turnoverEntries.map(toTurnoverEntryView);
  const turnover = calculateTurnoverProgress(
    entries.map((entry) => ({
      entryKind: entry.entryKind,
      state: entry.state,
      contributionMinor: entry.contributionMinor,
    })),
    row.turnoverTargetMinor,
  );
  return {
    id: row.id,
    memberId: row.memberId,
    campaignId: row.campaignId,
    campaignCode: row.campaign.code,
    campaignVersionId: row.campaignVersionId,
    campaignVersion: row.campaignVersion,
    state,
    version: row.version,
    terms: toTerms(row.termsSnapshot),
    stackingDecision: row.stackingDecision as unknown as PromotionStackingDecision,
    currency: row.currency,
    rewardMinor: row.rewardMinor,
    turnoverTargetMinor: row.turnoverTargetMinor,
    releasedMinor: row.releasedMinor,
    expiredMinor: row.expiredMinor,
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    expiredAt: row.expiredAt,
    revokedAt: row.revokedAt,
    grantLedgerTransactionId: row.grantLedgerTransactionId,
    releaseLedgerTransactionId: row.releaseLedgerTransactionId,
    expiryLedgerTransactionId: row.expiryLedgerTransactionId,
    turnover,
    turnoverEntries: entries,
    allowedActions: entitlementAllowedActions(state),
  };
}

/**
 * Revives the durable JSON representation of an Entitlement command result back
 * into the typed view. Money is integer minor units and instants are canonical
 * RFC 3339 strings in the stored form, so a replay returns exactly the values
 * the original command decided.
 */
export function reviveEntitlementView(value: unknown): PromotionEntitlementView {
  const raw = value as Record<string, unknown>;
  const turnover = raw.turnover as Record<string, unknown>;
  const entries = (raw.turnoverEntries ?? []) as Array<Record<string, unknown>>;
  const instant = (input: unknown): Date => new Date(String(input));
  const optionalInstant = (input: unknown): Date | null =>
    input === null || input === undefined ? null : instant(input);
  const optionalId = (input: unknown): string | null =>
    input === null || input === undefined ? null : String(input);

  return {
    id: String(raw.id),
    memberId: String(raw.memberId),
    campaignId: String(raw.campaignId),
    campaignCode: String(raw.campaignCode),
    campaignVersionId: String(raw.campaignVersionId),
    campaignVersion: Number(raw.campaignVersion),
    state: raw.state as PromotionEntitlementState,
    version: Number(raw.version),
    terms: raw.terms as PromotionCampaignTerms,
    stackingDecision: raw.stackingDecision as PromotionStackingDecision,
    currency: String(raw.currency),
    rewardMinor: BigInt(String(raw.rewardMinor)),
    turnoverTargetMinor: BigInt(String(raw.turnoverTargetMinor)),
    releasedMinor: BigInt(String(raw.releasedMinor)),
    expiredMinor: BigInt(String(raw.expiredMinor ?? "0")),
    grantedAt: instant(raw.grantedAt),
    expiresAt: instant(raw.expiresAt),
    completedAt: optionalInstant(raw.completedAt),
    expiredAt: optionalInstant(raw.expiredAt),
    revokedAt: optionalInstant(raw.revokedAt),
    grantLedgerTransactionId: optionalId(raw.grantLedgerTransactionId),
    releaseLedgerTransactionId: optionalId(raw.releaseLedgerTransactionId),
    expiryLedgerTransactionId: optionalId(raw.expiryLedgerTransactionId),
    turnover: {
      provisionalMinor: BigInt(String(turnover.provisionalMinor)),
      finalizedMinor: BigInt(String(turnover.finalizedMinor)),
      progressMinor: BigInt(String(turnover.progressMinor)),
      targetMinor: BigInt(String(turnover.targetMinor)),
      remainingMinor: BigInt(String(turnover.remainingMinor)),
      releaseReached: Boolean(turnover.releaseReached),
    },
    turnoverEntries: entries.map((entry) => ({
      id: String(entry.id),
      betReference: String(entry.betReference),
      entryKind: entry.entryKind as PromotionTurnoverEntryKind,
      state: entry.state as PromotionTurnoverEntryState,
      contributionMinor: BigInt(String(entry.contributionMinor)),
      stakeMinor: BigInt(String(entry.stakeMinor)),
      occurredAt: instant(entry.occurredAt),
      finalizedAt: optionalInstant(entry.finalizedAt),
      removedAt: optionalInstant(entry.removedAt),
      correctsEntryId: optionalId(entry.correctsEntryId),
    })),
    allowedActions: ((raw.allowedActions ?? []) as string[]).map(String),
  };
}

function toTurnoverEntryView(row: EntitlementRow["turnoverEntries"][number]): PromotionTurnoverEntryView {
  return {
    id: row.id,
    betReference: row.betReference,
    entryKind: row.entryKind as PromotionTurnoverEntryKind,
    state: row.state as PromotionTurnoverEntryState,
    contributionMinor: row.contributionMinor,
    stakeMinor: row.stakeMinor,
    occurredAt: row.occurredAt,
    finalizedAt: row.finalizedAt,
    removedAt: row.removedAt,
    correctsEntryId: row.correctsEntryId,
  };
}

function resolveClaimStacking(input: {
  held: readonly EntitlementRow[];
  candidate: PromotionStackingCandidateFact;
}): PromotionStackingDecision {
  const heldCandidates: PromotionStackingCandidateFact[] = input.held.map((row) => {
    const terms = toTerms(row.termsSnapshot);
    return {
      campaignVersionId: row.campaignVersionId,
      campaignCode: row.campaign.code,
      campaignVersion: row.campaignVersion,
      mode: terms.stacking.mode,
      priority: terms.stacking.priority,
      compatibilityGroup: terms.stacking.compatibilityGroup,
      expiresAt: row.expiresAt,
    };
  });
  return resolvePromotionStacking([...heldCandidates, input.candidate]);
}

// Platform composition-root adapter for the betting→lottery draw port.
//
// This adapter lives in the platform layer (not a bounded context) so it may
// legitimately combine the lottery draw domain (Draw snapshot + published
// Override resolution) with the betting quote types. It resolves a Draw's
// *effective* configuration for Quote resolution without the betting context
// ever importing lottery directly.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service";
import {
  BETTING_QUOTE_DRAW_PORT,
  type BettingQuoteDrawPort,
  type EffectiveDrawForQuote,
} from "../../contexts/betting/application/betting-quote-draw.port";
import type {
  EffectiveBetTypeConfig,
  QuoteNumberRestriction,
  QuotePayoutSource,
} from "../../contexts/betting/domain/quote";
import type { DrawState } from "../../contexts/lottery/domain/draw-lifecycle";
import {
  resolveDrawOverrideConfiguration,
  type DrawBetTypeOverrideBaseline,
  type DrawOverrideBaseline,
  type PublishedDrawOverride,
} from "../../contexts/lottery/domain/draw-override";

type RestrictionRecord = { kind?: unknown; maxAmountMinor?: unknown; payout?: unknown };

@Injectable()
export class BettingQuoteDrawAdapter implements BettingQuoteDrawPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadEffectiveDraw(
    drawId: string,
    asOf: Date,
  ): Promise<EffectiveDrawForQuote | null> {
    const draw = await this.prisma.lotteryDraw.findUnique({
      where: { id: drawId },
      include: { betTypes: true },
    });
    if (!draw) return null;

    const baseline: DrawOverrideBaseline<unknown, RestrictionRecord> = {
      drawId: draw.id,
      revisionRef: draw.overrideRevisionRef || "base",
      state: draw.state as DrawState,
      drawAt: new Date(draw.drawAt.getTime()),
      cutoffAt: new Date(draw.cutoffAt.getTime()),
      resultSourceRef: draw.resultSourceRef ?? "UNASSIGNED",
      betTypes: draw.betTypes.map(baselineBetType),
    };

    const overrideRows = await this.prisma.lotteryDrawOverride.findMany({
      where: { drawId: draw.id, status: "PUBLISHED" },
      orderBy: { publishedAt: "asc" },
    });
    const published: PublishedDrawOverride<unknown, RestrictionRecord>[] =
      overrideRows.map((row) => ({
        id: row.id,
        drawId: row.drawId,
        supersedesOverrideId: row.supersedesOverrideId,
        baselineRevisionRef: row.baselineRevisionRef,
        baselineState: row.baselineState as DrawState,
        effectiveAt: row.effectiveAt,
        reason: row.reason,
        actorId: row.actorAdminId,
        changes: row.changes as unknown as PublishedDrawOverride<unknown, RestrictionRecord>["changes"],
        diff: row.diff as unknown as PublishedDrawOverride<unknown, RestrictionRecord>["diff"],
        impact: row.impact as unknown as PublishedDrawOverride<unknown, RestrictionRecord>["impact"],
        payloadDigest: row.payloadDigest,
        approvalEvidenceRef: row.approvalEvidenceRef ?? "",
        auditEvidenceRef: row.auditEvidenceRef ?? "",
        publishedAt: row.publishedAt ?? row.createdAt,
      }));

    const resolved = resolveDrawOverrideConfiguration<unknown, RestrictionRecord>(
      baseline,
      published,
      asOf,
    );

    const betTypes: EffectiveBetTypeConfig[] = resolved.betTypes.map((betType) => {
      const snapshot = draw.betTypes.find(
        (candidate) => candidate.betTypeId === betType.betTypeId,
      );
      if (!snapshot) {
        // The Override chain referenced a Bet Type not in this Draw's snapshot:
        // this is a corrupted config; treat the Draw as unusable for bets.
        throw new Error(
          `Draw ${draw.id} configuration references unknown Bet Type ${betType.betTypeId}`,
        );
      }
      const payoutSource: QuotePayoutSource =
        JSON.stringify(snapshot.payout) === JSON.stringify(betType.payout)
          ? "DRAW_SNAPSHOT"
          : "DRAW_OVERRIDE";
      return {
        betTypeId: betType.betTypeId,
        betTypeCode: snapshot.betTypeCode,
        betTypeVersionId: snapshot.betTypeVersionId,
        validationPattern: snapshot.validationPattern,
        payout: betType.payout,
        payoutSource,
        minStakeMinor: betType.minStakeMinor,
        maxStakeMinor: betType.maxStakeMinor,
        numberRestrictions: (betType.numberRestrictions ?? []).flatMap(toQuoteRestriction),
        bettingEnabled: betType.bettingEnabled,
      };
    });

    return {
      draw: {
        id: draw.id,
        productId: draw.productId,
        productVersionId: draw.productVersionId,
        state: draw.state,
      },
      cutoffAt: new Date(resolved.cutoffAt.getTime()),
      betTypes,
    };
  }
}

function baselineBetType(betType: {
  betTypeId: string;
  payout: Prisma.JsonValue;
  minStakeMinor: bigint;
  maxStakeMinor: bigint;
}): DrawBetTypeOverrideBaseline<unknown, RestrictionRecord> {
  return {
    betTypeId: betType.betTypeId,
    payout: betType.payout,
    minStakeMinor: betType.minStakeMinor,
    maxStakeMinor: betType.maxStakeMinor,
    numberRestrictions: [],
    bettingEnabled: true,
  };
}

function toQuoteRestriction(restriction: RestrictionRecord): QuoteNumberRestriction[] {
  if (restriction === null || typeof restriction !== "object") return [];
  switch (restriction.kind) {
    case "BLOCKED":
      return [{ kind: "BLOCKED" }];
    case "MAX_AMOUNT":
      return [
        {
          kind: "MAX_AMOUNT",
          maxAmountMinor: toBigInt(restriction.maxAmountMinor),
        },
      ];
    case "REDUCED_PAYOUT":
      return [{ kind: "REDUCED_PAYOUT", payout: restriction.payout }];
    default:
      return [];
  }
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  return 0n;
}

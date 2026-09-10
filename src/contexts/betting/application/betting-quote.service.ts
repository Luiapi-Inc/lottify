// Betting Quote application service (Issue 44). Resolves, persists and serves
// Member-facing Quotes. Critical creation is idempotent by a scoped
// Idempotency-Key and every trusted value (payout, limits, total, expiry,
// cutoff) is computed server-side from the effective Draw configuration — never
// accepted from the client. Cross-context Draw configuration is obtained through
// the betting→lottery draw port so this context never imports lottery directly.

import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import { getEnvironment } from "../../../platform/config/env";
import {
  resolveQuoteExpiry,
  isQuoteExpired,
} from "../domain/quote-expiry";
import {
  resolveQuoteLines,
  type NormalizedQuoteLine,
  type RawQuoteLine,
} from "../domain/quote";
import {
  BETTING_QUOTE_DRAW_PORT,
  type BettingQuoteDrawPort,
} from "./betting-quote-draw.port";

export type BettingQuoteErrorCode =
  | "DRAW_NOT_FOUND"
  | "DRAW_NOT_OPEN"
  | "QUOTE_CUTOFF_REACHED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_CURRENCY"
  | "NOT_FOUND";

export class BettingQuoteError extends Error {
  readonly code: BettingQuoteErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: BettingQuoteErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BettingQuoteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type QuoteStatus = "QUOTED" | "EXPIRED";

export interface BettingQuote {
  readonly id: string;
  readonly memberId: string;
  readonly drawId: string;
  readonly productId: string;
  readonly productVersionId: string;
  readonly currency: "THB";
  readonly totalStakeMinor: bigint;
  readonly status: QuoteStatus;
  readonly cutoffAt: Date;
  readonly serverNow: Date;
  readonly expiresAt: Date;
  readonly lines: readonly NormalizedQuoteLine[];
  readonly createdAt: Date;
}

@Injectable()
export class BettingQuoteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BETTING_QUOTE_DRAW_PORT) private readonly drawSource: BettingQuoteDrawPort,
  ) {}

  now(): Date {
    return new Date();
  }

  private quoteTtlMs(): number {
    return getEnvironment().QUOTE_TTL_SECONDS * 1000;
  }

  /**
   * Resolves and persists a Quote idempotently. Same key + same payload returns
   * the prior Quote; same key with a different payload is IDEMPOTENCY_CONFLICT.
   */
  async createQuote(input: {
    memberId: string;
    drawId: string;
    lines: RawQuoteLine[];
    currency: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<BettingQuote> {
    const serverNow = input.now ?? this.now();
    const drawId = input.drawId.trim();

    const key = input.idempotencyKey?.trim() ?? "";
    if (!key) {
      throw new BettingQuoteError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key header is required for Quote creation",
        400,
        {},
      );
    }
    if (key.length > 200) {
      throw new BettingQuoteError(
        "IDEMPOTENCY_KEY_INVALID",
        "Idempotency-Key must be at most 200 characters",
        400,
        { field: "idempotencyKey" },
      );
    }
    if (input.currency !== "THB") {
      throw new BettingQuoteError(
        "INVALID_CURRENCY",
        "Only THB is supported for betting Quotes",
        400,
        { field: "currency" },
      );
    }

    const scope = `BET_QUOTE:${input.memberId}`;
    const fingerprint = quoteFingerprint({
      memberId: input.memberId,
      drawId,
      currency: input.currency,
      lines: input.lines,
    });

    // Same-key retry returns the prior durable result.
    const existing = await this.prisma.bettingQuote.findFirst({
      where: { idempotencyScope: scope, idempotencyKey: key },
      include: { lines: true },
    });
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new BettingQuoteError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different Quote payload",
          409,
          {},
        );
      }
      return this.toQuote(existing, serverNow);
    }

    // Load the Draw + effective (override-resolved) configuration through the port.
    const effective = await this.drawSource.loadEffectiveDraw(drawId, serverNow);
    if (!effective) {
      throw new BettingQuoteError(
        "DRAW_NOT_FOUND",
        `Lottery Draw ${drawId} not found`,
        404,
        { drawId },
      );
    }
    if (effective.draw.state !== "OPEN") {
      throw new BettingQuoteError(
        "DRAW_NOT_OPEN",
        `Draw ${drawId} is not accepting bets in state ${effective.draw.state}`,
        409,
        { state: effective.draw.state },
      );
    }

    // Enforce the authoritative cutoff on the effective (override-resolved) instant.
    if (serverNow.getTime() >= effective.cutoffAt.getTime()) {
      throw new BettingQuoteError(
        "QUOTE_CUTOFF_REACHED",
        `Draw ${drawId} cutoff has been reached`,
        409,
        { cutoffAt: effective.cutoffAt.toISOString(), serverNow: serverNow.toISOString() },
      );
    }

    const resolved = resolveQuoteLines({
      betTypes: effective.betTypes,
      rawLines: input.lines,
    });

    const expiry = resolveQuoteExpiry({
      configuredTtlExpiresAt: new Date(serverNow.getTime() + this.quoteTtlMs()),
      drawCutoffAt: effective.cutoffAt,
    });

    const id = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.bettingQuote.create({
          data: {
            id,
            memberId: input.memberId,
            drawId,
            productId: effective.draw.productId,
            productVersionId: effective.draw.productVersionId,
            currency: input.currency,
            totalStakeMinor: resolved.totalStakeMinor,
            cutoffAt: effective.cutoffAt,
            serverNow,
            expiresAt: expiry.expiresAt,
            status: "QUOTED",
            idempotencyScope: scope,
            idempotencyKey: key,
            fingerprint,
            requestPayload: JSON.stringify(input.lines, bigintReplacer) as never,
            lines: {
              create: resolved.lines.map((line) => ({
                id: randomUUID(),
                betTypeId: line.betTypeId,
                betTypeCode: line.betTypeCode,
                betTypeVersionId: line.betTypeVersionId,
                canonicalNumber: line.canonicalNumber,
                stakeMinor: line.stakeMinor,
                resolvedPayout: line.resolvedPayout as Prisma.InputJsonValue,
                payoutSource: line.payoutSource,
                restrictions: line.restrictions as unknown as Prisma.InputJsonValue,
              })),
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // A concurrent request with the same key won the insert: replay it.
        const raced = await this.prisma.bettingQuote.findFirst({
          where: { idempotencyScope: scope, idempotencyKey: key },
          include: { lines: true },
        });
        if (!raced) {
          throw new BettingQuoteError("NOT_FOUND", "Quote could not be created", 500, {});
        }
        if (raced.fingerprint !== fingerprint) {
          throw new BettingQuoteError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was already used with a different Quote payload",
            409,
            {},
          );
        }
        return this.toQuote(raced, serverNow);
      }
      throw error;
    }

    return this.getQuote(input.memberId, id, serverNow);
  }

  async getQuote(memberId: string, quoteId: string, now?: Date): Promise<BettingQuote> {
    const serverNow = now ?? this.now();
    const quote = await this.prisma.bettingQuote.findUnique({
      where: { id: quoteId.trim() },
      include: { lines: true },
    });
    if (!quote || quote.memberId !== memberId) {
      throw new BettingQuoteError("NOT_FOUND", "Betting Quote not found", 404, {});
    }
    return this.toQuote(quote, serverNow);
  }

  private toQuote(
    row: {
      id: string;
      memberId: string;
      drawId: string;
      productId: string;
      productVersionId: string;
      currency: string;
      totalStakeMinor: bigint;
      cutoffAt: Date;
      serverNow: Date;
      expiresAt: Date;
      createdAt: Date;
      lines: Array<{
        betTypeId: string;
        betTypeCode: string;
        betTypeVersionId: string;
        canonicalNumber: string;
        stakeMinor: bigint;
        resolvedPayout: Prisma.JsonValue;
        payoutSource: string;
        restrictions: Prisma.JsonValue;
      }>;
    },
    serverNow: Date,
  ): BettingQuote {
    const status: QuoteStatus = isQuoteExpired(
      { expiresAt: row.expiresAt },
      serverNow,
    )
      ? "EXPIRED"
      : "QUOTED";

    return {
      id: row.id,
      memberId: row.memberId,
      drawId: row.drawId,
      productId: row.productId,
      productVersionId: row.productVersionId,
      currency: "THB",
      totalStakeMinor: row.totalStakeMinor,
      status,
      cutoffAt: new Date(row.cutoffAt.getTime()),
      serverNow: new Date(serverNow.getTime()),
      expiresAt: new Date(row.expiresAt.getTime()),
      lines: row.lines.map((line) => ({
        betTypeId: line.betTypeId,
        betTypeCode: line.betTypeCode,
        betTypeVersionId: line.betTypeVersionId,
        canonicalNumber: line.canonicalNumber,
        stakeMinor: line.stakeMinor,
        resolvedPayout: line.resolvedPayout,
        payoutSource: line.payoutSource as "DRAW_OVERRIDE" | "DRAW_SNAPSHOT",
        restrictions: (line.restrictions as string[]) ?? [],
      })),
      createdAt: row.createdAt,
    };
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function quoteFingerprint(input: {
  memberId: string;
  drawId: string;
  currency: string;
  lines: readonly RawQuoteLine[];
}): string {
  const canonicalLines = [...input.lines]
    .map((line) => ({
      betTypeCode: line.betTypeCode.trim(),
      canonicalNumber: line.canonicalNumber.trim(),
      stakeMinor: line.stakeMinor.toString(),
    }))
    .sort((a, b) =>
      `${a.betTypeCode}\u0000${a.canonicalNumber}`.localeCompare(
        `${b.betTypeCode}\u0000${b.canonicalNumber}`,
      ),
    );
  return createHash("sha256")
    .update(
      JSON.stringify({
        memberId: input.memberId,
        drawId: input.drawId,
        currency: input.currency,
        lines: canonicalLines,
      }),
    )
    .digest("hex");
}

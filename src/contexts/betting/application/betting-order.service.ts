// Betting Bet Order application service (Issue 45). Owns Order creation from an
// authorised Quote, the explicit CONFIRM/CANCEL commands, the Receipt, and the
// orchestration that couples Confirm to the authoritative Wallet & Ledger
// reserve/commit.
//
// The locked lifecycle rules live in `../domain/bet-order-lifecycle` (commands
// move QUOTED -> CONFIRMING / CONFIRMED -> CANCELLING; only a durable financial
// outcome resolves the in-flight state) and the Receipt rules live in
// `../domain/bet-receipt`. This service persists those decisions and proves the
// money movement — it never restates the transition table.
//
// Command semantics:
//   - every member command carries an Idempotency-Key that is recorded on the
//     Order, so replaying a Confirm/Cancel returns the durable result instead of
//     re-executing and a different key for an already-executed command is a
//     conflict;
//   - `version` is the optimistic-concurrency guard: a stale write is
//     VERSION_CONFLICT and never silently overwrites;
//   - the Order reaches CONFIRMED only after the Wallet & Ledger effect is
//     durable, and CANCELLED only after the refund posting is durable.
//
// Cross-context access goes through ports only: the Draw (cutoff revalidation
// at Confirm) and Wallet & Ledger (stake reserve/commit and refund).

import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  allowedBetOrderActions,
  applyBetOrderCommand,
  applyBetOrderResolution,
  BET_ORDER_STATES,
  isTerminalBetOrderState,
  type BetOrderCommand,
  type BetOrderState,
} from "../domain/bet-order-lifecycle";
import { buildBetReceipt, type ReceiptTerms } from "../domain/bet-receipt";
import {
  BETTING_QUOTE_DRAW_PORT,
  type BettingQuoteDrawPort,
} from "./betting-quote-draw.port";
import {
  BETTING_ELIGIBILITY_PORT,
  type BettingEligibilityPort,
} from "./betting-eligibility.port";
import {
  BET_ORDER_WALLET_PORT,
  BetOrderWalletError,
  type BetOrderWalletPort,
} from "./betting-order-wallet.port";

export type BettingOrderErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_NOT_AUTHORISED"
  | "QUOTE_EXPIRED"
  | "ORDER_EXISTS_FOR_QUOTE"
  | "ORDER_NOT_FOUND"
  | "RECEIPT_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_STATE"
  | "ILLEGAL_ACTION"
  | "CANCELLATION_CUTOFF_REACHED"
  | "INSUFFICIENT_FUNDS"
  | "WALLET_RESTRICTED";

export class BettingOrderError extends Error {
  readonly code: BettingOrderErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: BettingOrderErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BettingOrderError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface BetOrderLineView {
  readonly betTypeId: string;
  readonly betTypeCode: string;
  readonly betTypeVersionId: string;
  readonly canonicalNumber: string;
  readonly stakeMinor: bigint;
  readonly resolvedPayout: unknown;
  readonly payoutSource: string;
  readonly restrictions: readonly string[];
}

export interface BetOrderView {
  readonly id: string;
  readonly memberId: string;
  readonly quoteId: string;
  readonly drawId: string;
  readonly productId: string;
  readonly productVersionId: string;
  readonly currency: "THB";
  readonly state: BetOrderState;
  readonly version: number;
  readonly allowedActions: readonly BetOrderCommand[];
  readonly totalStakeMinor: bigint;
  readonly cutoffAt: Date;
  readonly quoteExpiresAt: Date;
  readonly reservationId: string | null;
  readonly stakeTransactionId: string | null;
  readonly refundTransactionId: string | null;
  readonly rejectionReason: string | null;
  readonly cancellationReason: string | null;
  readonly confirmedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly rejectedAt: Date | null;
  readonly receiptId: string | null;
  readonly lines: readonly BetOrderLineView[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BetReceiptView {
  readonly id: string;
  readonly orderId: string;
  readonly memberId: string;
  readonly orderVersion: number;
  readonly contentDigest: string;
  readonly terms: ReceiptTerms;
  readonly issuedAt: Date;
}

/**
 * Keyset cursor for the Member's own Bet Order history: the unique
 * (createdAt, id) position of the last item on the previous page.
 */
export interface BetOrderCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface BetOrderListPage {
  readonly items: readonly BetOrderView[];
  readonly nextCursor: BetOrderCursor | null;
}

type BetOrderRow = Prisma.BetOrderGetPayload<{ include: { lines: true; receipt: true } }>;

const ORDER_RELATIONS = { lines: true, receipt: true } as const;

@Injectable()
export class BettingOrderService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BETTING_QUOTE_DRAW_PORT) private readonly drawSource: BettingQuoteDrawPort,
    @Inject(BET_ORDER_WALLET_PORT) private readonly wallet: BetOrderWalletPort,
    @Inject(BETTING_ELIGIBILITY_PORT) private readonly eligibility: BettingEligibilityPort,
  ) {}

  now(): Date {
    return new Date();
  }

  /**
   * Creates the Bet Order that accepts an authorised Quote. No money moves at
   * creation: the Order is created QUOTED and only Confirm has a financial
   * effect. Idempotent by a scoped Idempotency-Key; one Order per Quote.
   */
  async createOrder(input: {
    memberId: string;
    quoteId: string;
    idempotencyKey: string | undefined | null;
    now?: Date;
  }): Promise<BetOrderView> {
    const key = requireIdempotencyKey(input.idempotencyKey, "Bet Order creation");
    const quoteId = input.quoteId.trim();
    const scope = `BET_ORDER_CREATE:${input.memberId}`;
    const fingerprint = orderFingerprint({ memberId: input.memberId, quoteId });

    const replay = await this.prisma.betOrder.findFirst({
      where: { idempotencyScope: scope, idempotencyKey: key },
      include: ORDER_RELATIONS,
    });
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        throw new BettingOrderError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used to create a different Bet Order",
          409,
        );
      }
      return this.toView(replay);
    }

    const quote = await this.prisma.bettingQuote.findUnique({
      where: { id: quoteId },
      include: { lines: true },
    });
    if (!quote || quote.memberId !== input.memberId) {
      throw new BettingOrderError("QUOTE_NOT_FOUND", "Betting Quote not found", 404, {});
    }
    if (quote.status !== "QUOTED") {
      throw new BettingOrderError(
        "QUOTE_NOT_AUTHORISED",
        `Quote ${quoteId} is not authorised for a Bet Order (status ${quote.status})`,
        409,
        { status: quote.status },
      );
    }

    const serverNow = input.now ?? this.now();
    if (serverNow.getTime() >= quote.expiresAt.getTime()) {
      throw new BettingOrderError(
        "QUOTE_EXPIRED",
        `Quote ${quoteId} has expired`,
        409,
        { expiresAt: quote.expiresAt.toISOString(), serverNow: serverNow.toISOString() },
      );
    }

    const id = randomUUID();
    try {
      await this.prisma.betOrder.create({
        data: {
          id,
          memberId: input.memberId,
          quoteId,
          drawId: quote.drawId,
          productId: quote.productId,
          productVersionId: quote.productVersionId,
          currency: quote.currency,
          state: "QUOTED",
          version: 1,
          totalStakeMinor: quote.totalStakeMinor,
          cutoffAt: quote.cutoffAt,
          quoteExpiresAt: quote.expiresAt,
          idempotencyScope: scope,
          idempotencyKey: key,
          fingerprint,
          lines: {
            create: quote.lines.map((line) => ({
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
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.prisma.betOrder.findFirst({
          where: { idempotencyScope: scope, idempotencyKey: key },
          include: ORDER_RELATIONS,
        });
        if (raced) {
          if (raced.fingerprint !== fingerprint) {
            throw new BettingOrderError(
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key was already used to create a different Bet Order",
              409,
            );
          }
          return this.toView(raced);
        }
        const forQuote = await this.prisma.betOrder.findUnique({
          where: { quoteId },
          select: { id: true },
        });
        if (forQuote) {
          throw new BettingOrderError(
            "ORDER_EXISTS_FOR_QUOTE",
            "An authorised Quote backs exactly one Bet Order",
            409,
            { orderId: forQuote.id },
          );
        }
      }
      throw error;
    }

    return this.reloadView(input.memberId, id);
  }

  async getOrder(memberId: string, orderId: string): Promise<BetOrderView> {
    const order = await this.loadOrder(memberId, orderId);
    return this.toView(order);
  }

  async getReceipt(memberId: string, orderId: string): Promise<BetReceiptView> {
    const order = await this.loadOrder(memberId, orderId);
    const receipt = order.receipt;
    if (!receipt) {
      throw new BettingOrderError(
        "RECEIPT_NOT_FOUND",
        `Bet Order ${order.id} has no Receipt`,
        404,
        { state: order.state },
      );
    }
    return toReceiptView(receipt);
  }

  /**
   * The Member's own Bet Order history ("my slips"). Keyset pagination over
   * (createdAt DESC, id DESC) — a stable, deterministic sort with a unique
   * tie-breaker per Ticket 10, matching the `[memberId, createdAt]` index. Only
   * Orders owned by the requesting Member are ever returned.
   */
  async listOrders(
    memberId: string,
    input: { limit?: number; cursor?: BetOrderCursor | null; state?: BetOrderState } = {},
  ): Promise<BetOrderListPage> {
    const limit = boundedOrderLimit(input.limit);
    const rows = await this.prisma.betOrder.findMany({
      where: {
        memberId,
        ...(input.state ? { state: input.state } : {}),
        ...(input.cursor
          ? {
              OR: [
                { createdAt: { lt: input.cursor.createdAt } },
                {
                  createdAt: input.cursor.createdAt,
                  id: { lt: input.cursor.id },
                },
              ],
            }
          : {}),
      },
      include: ORDER_RELATIONS,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => this.toView(row)),
      nextCursor:
        rows.length > limit && last
          ? { createdAt: last.createdAt, id: last.id }
          : null,
    };
  }

  /**
   * CONFIRM. Moves the Order to the in-flight CONFIRMING state, revalidates the
   * Quote and the authoritative Draw cutoff, then requires the durable Wallet &
   * Ledger stake reserve/commit before the Order can become CONFIRMED and the
   * Receipt is issued. A denial resolves to REJECTED with no money moved.
   */
  async confirmOrder(input: {
    memberId: string;
    orderId: string;
    expectedVersion: number;
    idempotencyKey: string | undefined | null;
    now?: Date;
  }): Promise<BetOrderView> {
    const key = requireIdempotencyKey(input.idempotencyKey, "Bet Order confirmation");
    const serverNow = input.now ?? this.now();
    const order = await this.loadOrder(input.memberId, input.orderId);

    const current = await this.advance(order, "CONFIRM", input.expectedVersion, key);

    if (current.state === "CONFIRMED" || current.state === "SETTLED") {
      // Replay of an already-confirmed confirm: report the durable result.
      await this.ensureReceipt(current);
      return this.reloadView(input.memberId, current.id);
    }
    if (current.state !== "CONFIRMING") {
      throw new BettingOrderError(
        "INVALID_STATE",
        `Bet Order ${current.id} is in ${current.state} and cannot be confirmed`,
        409,
        { state: current.state },
      );
    }

    const denial = await this.confirmDenial(current, serverNow);
    if (denial) return this.resolveRejected(current, denial, serverNow);

    let effect;
    try {
      effect = await this.wallet.commitStake({
        orderId: current.id,
        memberId: current.memberId,
        drawId: current.drawId,
        amountMinor: current.totalStakeMinor,
        currency: "THB",
        correlationId: current.id,
      });
    } catch (error) {
      if (error instanceof BetOrderWalletError) {
        return this.resolveRejected(current, error.code, serverNow);
      }
      throw error;
    }

    return this.resolveConfirmed(current, effect, serverNow);
  }

  /**
   * CANCEL. A Member may cancel a confirmed Order before the Draw cutoff; the
   * Order becomes CANCELLED only after the refund posting is durable, so the
   * cancelled state never hides an unposted refund.
   */
  async cancelOrder(input: {
    memberId: string;
    orderId: string;
    expectedVersion: number;
    idempotencyKey: string | undefined | null;
    reason?: string | null;
    now?: Date;
  }): Promise<BetOrderView> {
    const key = requireIdempotencyKey(input.idempotencyKey, "Bet Order cancellation");
    const serverNow = input.now ?? this.now();
    const order = await this.loadOrder(input.memberId, input.orderId);

    // Member cancellation is a pre-cutoff right; validate it before moving the
    // Order so a refused cancellation leaves the Order untouched.
    if (!isTerminalBetOrderState(betOrderState(order.state)) && order.state !== "CANCELLING") {
      if (serverNow.getTime() >= order.cutoffAt.getTime()) {
        throw new BettingOrderError(
          "CANCELLATION_CUTOFF_REACHED",
          "Bet Order can no longer be cancelled: the Draw cutoff has been reached",
          409,
          { cutoffAt: order.cutoffAt.toISOString(), serverNow: serverNow.toISOString() },
        );
      }
    }

    const current = await this.advance(order, "CANCEL", input.expectedVersion, key);

    if (current.state === "CANCELLED") {
      return this.reloadView(input.memberId, current.id);
    }
    if (current.state !== "CANCELLING") {
      throw new BettingOrderError(
        "INVALID_STATE",
        `Bet Order ${current.id} is in ${current.state} and cannot be cancelled`,
        409,
        { state: current.state },
      );
    }
    if (!current.stakeTransactionId) {
      throw new BettingOrderError(
        "INVALID_STATE",
        "A cancelling Bet Order must reference its committed stake transaction",
        409,
        { state: current.state },
      );
    }

    const refund = await this.wallet.refundStake({
      orderId: current.id,
      memberId: current.memberId,
      stakeTransactionId: current.stakeTransactionId,
      currency: "THB",
      correlationId: current.id,
    });

    return this.resolveCancelled(
      current,
      refund.transactionId,
      input.reason?.trim() || null,
      serverNow,
    );
  }

  /**
   * Revalidates everything that can have changed since the Quote was authorised
   * and that Confirm is the authority for: the Quote's own TTL and the Draw's
   * current state plus its effective, override-resolved cutoff.
   */
  private async confirmDenial(
    order: BetOrderRow,
    serverNow: Date,
  ): Promise<string | null> {
    if (serverNow.getTime() >= order.quoteExpiresAt.getTime()) {
      return "QUOTE_EXPIRED";
    }

    const eligibility = await this.eligibility.evaluate(order.memberId, serverNow);
    if (eligibility.outcome !== "ALLOW") return "MEMBER_NOT_ELIGIBLE";

    const effective = await this.drawSource.loadEffectiveDraw(order.drawId, serverNow);
    if (!effective) return "DRAW_NOT_FOUND";
    if (effective.draw.state !== "OPEN") return "DRAW_NOT_OPEN";
    if (serverNow.getTime() >= effective.cutoffAt.getTime()) return "CUTOFF_REACHED";
    return null;
  }

  private async resolveRejected(
    order: BetOrderRow,
    reason: string,
    serverNow: Date,
  ): Promise<BetOrderView> {
    const next = applyBetOrderResolution({
      current: { state: betOrderState(order.state), version: order.version },
      expectedVersion: order.version,
      resolution: "REJECTED",
    });
    const updated = await this.prisma.betOrder.updateMany({
      where: { id: order.id, state: "CONFIRMING", version: order.version },
      data: {
        state: next.state,
        version: next.version,
        rejectionReason: reason,
        rejectedAt: serverNow,
      },
    });
    if (updated.count === 0) return this.reconcileLostResolution(order);
    return this.reloadView(order.memberId, order.id);
  }

  private async resolveConfirmed(
    order: BetOrderRow,
    effect: { reservationId: string; transactionId: string },
    serverNow: Date,
  ): Promise<BetOrderView> {
    const next = applyBetOrderResolution({
      current: { state: betOrderState(order.state), version: order.version },
      expectedVersion: order.version,
      resolution: "CONFIRMED",
    });
    const updated = await this.prisma.betOrder.updateMany({
      where: { id: order.id, state: "CONFIRMING", version: order.version },
      data: {
        state: next.state,
        version: next.version,
        reservationId: effect.reservationId,
        stakeTransactionId: effect.transactionId,
        confirmedAt: serverNow,
      },
    });
    if (updated.count === 0) return this.reconcileLostResolution(order);

    const confirmed = await this.loadOrder(order.memberId, order.id);
    await this.ensureReceipt(confirmed);
    return this.reloadView(order.memberId, order.id);
  }

  private async resolveCancelled(
    order: BetOrderRow,
    refundTransactionId: string,
    reason: string | null,
    serverNow: Date,
  ): Promise<BetOrderView> {
    const next = applyBetOrderResolution({
      current: { state: betOrderState(order.state), version: order.version },
      expectedVersion: order.version,
      resolution: "CANCELLED",
    });
    const updated = await this.prisma.betOrder.updateMany({
      where: { id: order.id, state: "CANCELLING", version: order.version },
      data: {
        state: next.state,
        version: next.version,
        refundTransactionId,
        cancelledAt: serverNow,
        cancellationReason: reason,
      },
    });
    if (updated.count === 0) return this.reconcileLostResolution(order);
    return this.reloadView(order.memberId, order.id);
  }

  /**
   * A concurrent attempt already resolved the in-flight Order. The durable
   * outcome wins; whatever it is, it is the truthful answer to return. A still
   * in-flight Order with no durable outcome means the caller's version is stale.
   */
  private async reconcileLostResolution(order: BetOrderRow): Promise<BetOrderView> {
    const fresh = await this.loadOrder(order.memberId, order.id);
    if (fresh.state !== order.state || isTerminalBetOrderState(betOrderState(fresh.state))) {
      if (fresh.state === "CONFIRMED" || fresh.state === "SETTLED") {
        await this.ensureReceipt(fresh);
        return this.reloadView(order.memberId, order.id);
      }
      return this.toView(fresh);
    }
    throw new BettingOrderError(
      "VERSION_CONFLICT",
      "Bet Order has changed since it was read; refresh and re-evaluate",
      409,
      { currentVersion: fresh.version, state: fresh.state },
    );
  }

  /**
   * Applies a member command under optimistic concurrency, recording the
   * Idempotency-Key it was executed under. Replaying the same key is a no-op
   * that returns the durable Order; a different key against an already-executed
   * command is a conflict.
   */
  private async advance(
    order: BetOrderRow,
    command: BetOrderCommand,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<BetOrderRow> {
    const persistedKey =
      command === "CONFIRM" ? order.confirmIdempotencyKey : order.cancelIdempotencyKey;
    if (persistedKey === idempotencyKey) {
      return order;
    }
    if (persistedKey !== null) {
      throw new BettingOrderError(
        "IDEMPOTENCY_CONFLICT",
        `Bet Order ${command} was already executed under a different Idempotency-Key`,
        409,
        {},
      );
    }

    const next = applyBetOrderCommand({
      current: { state: betOrderState(order.state), version: order.version },
      expectedVersion,
      command,
    });

    const updated = await this.prisma.betOrder.updateMany({
      where: { id: order.id, state: order.state, version: order.version },
      data: {
        state: next.state,
        version: next.version,
        ...(command === "CONFIRM"
          ? { confirmIdempotencyKey: idempotencyKey }
          : { cancelIdempotencyKey: idempotencyKey }),
      },
    });
    if (updated.count === 0) {
      const fresh = await this.loadOrder(order.memberId, order.id);
      const freshKey =
        command === "CONFIRM" ? fresh.confirmIdempotencyKey : fresh.cancelIdempotencyKey;
      if (fresh.state === next.state && freshKey === idempotencyKey) {
        return fresh;
      }
      if (freshKey !== null && freshKey !== idempotencyKey) {
        throw new BettingOrderError(
          "IDEMPOTENCY_CONFLICT",
          `Bet Order ${command} was already executed under a different Idempotency-Key`,
          409,
          {},
        );
      }
      throw new BettingOrderError(
        "VERSION_CONFLICT",
        "Bet Order has changed since it was read; refresh and re-evaluate",
        409,
        { currentVersion: fresh.version, state: fresh.state },
      );
    }

    return this.loadOrder(order.memberId, order.id);
  }

  /**
   * Issues the immutable Receipt for a confirmed Order. Exactly one Receipt
   * exists per Order; the accepted terms are snapshotted and content-digested,
   * and the database rejects any later mutation.
   */
  private async ensureReceipt(order: BetOrderRow): Promise<void> {
    if (order.receipt) return;
    if (order.state !== "CONFIRMED") return;

    const terms: ReceiptTerms = {
      productId: order.productId,
      productVersionId: order.productVersionId,
      drawReference: order.drawId,
      drawCutoffAt: order.cutoffAt.toISOString(),
      currency: "THB",
      totalStakeMinor: order.totalStakeMinor.toString(),
      acceptedAt: (order.confirmedAt ?? this.now()).toISOString(),
      lines: order.lines.map((line) => ({
        betTypeCode: line.betTypeCode,
        betTypeVersionId: line.betTypeVersionId,
        canonicalNumber: line.canonicalNumber,
        stakeMinor: line.stakeMinor.toString(),
        resolvedPayout: line.resolvedPayout,
      })),
      acceptedRestrictions: [
        ...new Set(
          order.lines.flatMap((line) => (line.restrictions as string[] | null) ?? []),
        ),
      ].sort(),
    };

    const receipt = buildBetReceipt({
      orderId: order.id,
      orderState: order.state,
      orderVersion: order.version,
      memberId: order.memberId,
      terms,
    });

    try {
      await this.prisma.betReceipt.create({
        data: {
          id: receipt.id,
          orderId: receipt.orderId,
          memberId: receipt.memberId,
          orderVersion: receipt.orderVersion,
          contentDigest: receipt.contentDigest,
          terms: receipt.terms as unknown as Prisma.InputJsonValue,
          termsCanonical: canonicalTerms(terms),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // A concurrent confirm already issued the Receipt; it is immutable and
        // identical by construction.
        return;
      }
      throw error;
    }
  }

  private async loadOrder(memberId: string, orderId: string): Promise<BetOrderRow> {
    const order = await this.prisma.betOrder.findUnique({
      where: { id: orderId.trim() },
      include: ORDER_RELATIONS,
    });
    if (!order || order.memberId !== memberId) {
      throw new BettingOrderError("ORDER_NOT_FOUND", "Bet Order not found", 404, {});
    }
    return order;
  }

  private async reloadView(memberId: string, orderId: string): Promise<BetOrderView> {
    return this.toView(await this.loadOrder(memberId, orderId));
  }

  private toView(order: BetOrderRow): BetOrderView {
    return {
      id: order.id,
      memberId: order.memberId,
      quoteId: order.quoteId,
      drawId: order.drawId,
      productId: order.productId,
      productVersionId: order.productVersionId,
      currency: "THB",
      state: betOrderState(order.state),
      version: order.version,
      allowedActions: allowedBetOrderActions(betOrderState(order.state)),
      totalStakeMinor: order.totalStakeMinor,
      cutoffAt: new Date(order.cutoffAt.getTime()),
      quoteExpiresAt: new Date(order.quoteExpiresAt.getTime()),
      reservationId: order.reservationId,
      stakeTransactionId: order.stakeTransactionId,
      refundTransactionId: order.refundTransactionId,
      rejectionReason: order.rejectionReason,
      cancellationReason: order.cancellationReason,
      confirmedAt: order.confirmedAt ? new Date(order.confirmedAt.getTime()) : null,
      cancelledAt: order.cancelledAt ? new Date(order.cancelledAt.getTime()) : null,
      rejectedAt: order.rejectedAt ? new Date(order.rejectedAt.getTime()) : null,
      receiptId: order.receipt?.id ?? null,
      lines: order.lines.map((line) => ({
        betTypeId: line.betTypeId,
        betTypeCode: line.betTypeCode,
        betTypeVersionId: line.betTypeVersionId,
        canonicalNumber: line.canonicalNumber,
        stakeMinor: line.stakeMinor,
        resolvedPayout: line.resolvedPayout,
        payoutSource: line.payoutSource,
        restrictions: (line.restrictions as string[] | null) ?? [],
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

function toReceiptView(receipt: {
  id: string;
  orderId: string;
  memberId: string;
  orderVersion: number;
  contentDigest: string;
  terms: Prisma.JsonValue;
  issuedAt: Date;
}): BetReceiptView {
  return {
    id: receipt.id,
    orderId: receipt.orderId,
    memberId: receipt.memberId,
    orderVersion: receipt.orderVersion,
    contentDigest: receipt.contentDigest,
    terms: receipt.terms as unknown as ReceiptTerms,
    issuedAt: receipt.issuedAt,
  };
}

/**
 * The persisted state column is constrained to the locked state set by a
 * database CHECK; this narrows it back to the domain type at the boundary.
 */
function betOrderState(value: string): BetOrderState {
  if (!BET_ORDER_STATES.includes(value as BetOrderState)) {
    throw new BettingOrderError(
      "INVALID_STATE",
      `Bet Order is in an unknown state ${value}`,
      409,
      { state: value },
    );
  }
  return value as BetOrderState;
}

function requireIdempotencyKey(
  value: string | undefined | null,
  operation: string,
): string {
  const key = value?.trim() ?? "";
  if (!key) {
    throw new BettingOrderError(
      "IDEMPOTENCY_KEY_REQUIRED",
      `Idempotency-Key header is required for ${operation}`,
      400,
      {},
    );
  }
  if (key.length > 200) {
    throw new BettingOrderError(
      "IDEMPOTENCY_KEY_INVALID",
      "Idempotency-Key must be at most 200 characters",
      400,
      { field: "idempotencyKey" },
    );
  }
  return key;
}

export function orderFingerprint(input: { memberId: string; quoteId: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ memberId: input.memberId, quoteId: input.quoteId }))
    .digest("hex");
}

/**
 * Bounds the Member history page size the same way every other list endpoint
 * does: an omitted limit is a default, an out-of-range one is a client error
 * rather than a silent clamp.
 */
function boundedOrderLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BettingOrderError(
      "INVALID_STATE",
      "limit must be an integer from 1 to 100",
      400,
      { field: "limit" },
    );
  }
  return limit;
}

/**
 * The exact serialization the Receipt digest covers. `buildBetReceipt` digests
 * `JSON.stringify(terms)` of a structuredClone, which preserves this key order
 * for plain JSON values, so persisting this string makes the digest verifiable
 * after the terms have round-tripped through JSONB (which reorders keys).
 */
export function canonicalTerms(terms: ReceiptTerms): string {
  return JSON.stringify(terms);
}

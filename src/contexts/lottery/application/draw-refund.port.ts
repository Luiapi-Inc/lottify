// Cross-context port (boundary) between the lottery and betting contexts for
// Draw-cancellation refunds (Issue 117, ADR 0001 workflow 5).
//
// The lottery bounded context owns the Draw lifecycle and its cancellation
// gate, but the bulk refund of committed stakes is owned by betting. Lottery
// must not import betting directly; this port is the cross-context seam that
// lets the lottery-side DrawCancellationOrchestrator trigger the betting refund
// and re-check the refund-obligation gate. A platform composition-root adapter
// implements it (mirroring SettlementDrawPort / BetOrderWalletPort), so lottery
// only ever sees lottery-local types.
//
// Idempotency is part of the contract: a refund run drives each Bet Order under
// the per-Draw idempotency key, so a replay of a crashed orchestrator never
// refunds the same Order twice.

export type DrawRefundErrorCode =
  | "DRAW_ID_REQUIRED"
  | "REFUND_OBLIGATIONS_OUTSTANDING";

export class DrawRefundError extends Error {
  readonly code: DrawRefundErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: DrawRefundErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DrawRefundError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type DrawRefundOutcome =
  | "REFUNDED"
  | "ALREADY_REFUNDED"
  | "IN_FLIGHT"
  | "FAILED";

export interface DrawRefundEntry {
  readonly orderId: string;
  readonly memberId: string;
  readonly stakeMinor: bigint;
  readonly outcome: DrawRefundOutcome;
  readonly refundTransactionId: string | null;
  readonly reason: string | null;
}

export interface DrawRefundRunResult {
  readonly drawId: string;
  /** Orders of the Draw this run had to consider (committed stake, unrefunded). */
  readonly considered: number;
  readonly refunded: readonly DrawRefundEntry[];
  readonly alreadyRefunded: readonly DrawRefundEntry[];
  /** Obligations this run did NOT satisfy; the Draw is not refund-clean while non-empty. */
  readonly outstanding: readonly DrawRefundEntry[];
  readonly refundedStakeMinor: bigint;
  readonly obligationsSatisfied: boolean;
}

export interface DrawRefundObligationView {
  readonly orderId: string;
  readonly memberId: string;
}

export const DRAW_REFUND_PORT = Symbol("DRAW_REFUND_PORT");

export interface DrawRefundPort {
  /**
   * Refunds every confirmed Order with a committed stake for the Draw. Safe to
   * re-drive: an already-refunded Order is reported, never refunded twice.
   */
  refundCommittedStakesForDraw(input: {
    readonly drawId: string;
    readonly reason?: string | null;
    readonly now?: Date;
  }): Promise<DrawRefundRunResult>;

  /**
   * The Orders of the Draw that still owe a refund. The cancellation gate
   * re-checks this after a refund run; it reuses the same predicate, so the
   * gate can never disagree with the operation.
   */
  listOutstandingRefundObligations(
    drawId: string,
  ): Promise<readonly DrawRefundObligationView[]>;
}

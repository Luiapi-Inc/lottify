// Cross-context ports (boundaries) for the Result & Settlement context.
//
// Settlement evaluates Bet Lines (owned by Betting), posts financial effects
// (owned by Wallet & Ledger) and drives Draw lifecycle transitions (owned by
// Lottery). The result-settlement bounded context must not import those
// contexts directly; each collaboration goes through a port that a platform
// composition-root adapter implements (mirroring BetOrderWalletPort).

// ---------------------------------------------------------------------------
// Settlement -> Wallet & Ledger
// ---------------------------------------------------------------------------

export type SettlementWalletErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "WALLET_RESTRICTED"
  | "SOURCE_ALLOCATION_INVALID"
  | "PAYOUT_POLICY_UNSUPPORTED";

export class SettlementWalletError extends Error {
  readonly code: SettlementWalletErrorCode;
  readonly details: Record<string, unknown>;
  constructor(
    code: SettlementWalletErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SettlementWalletError";
    this.code = code;
    this.details = details;
  }
}

export const SETTLEMENT_WALLET_PORT = Symbol("SETTLEMENT_WALLET_PORT");

export interface SettlementWalletPort {
  /**
   * Posts the winning payout for an Order from the Betting Settlement system
   * account into the Member bucket(s) dictated by the accepted Bet Confirm
   * source-allocation snapshot. Idempotent per Order, so a replay of a crashed
   * batch can never pay a winner twice.
   */
  postSettlementPayout(input: {
    readonly orderId: string;
    readonly memberId: string;
    readonly drawId: string;
    readonly amountMinor: bigint;
    readonly currency: "THB";
    readonly correlationId: string;
  }): Promise<{ transactionId: string }>;

  /**
   * Reverses a previously-posted payout (the compensating posting of a Result
   * correction). Idempotent per original payout transaction, so re-driving a
   * correction can never double-reverse.
   */
  reverseSettlementPayout(input: {
    readonly orderId: string;
    readonly payoutTransactionId: string;
    readonly memberId: string;
    readonly drawId: string;
    readonly currency: "THB";
    readonly correlationId: string;
  }): Promise<{ transactionId: string }>;
}

// ---------------------------------------------------------------------------
// Settlement -> Lottery Draw lifecycle
// ---------------------------------------------------------------------------

export type SettlementDrawErrorCode =
  | "DRAW_NOT_FOUND"
  | "ILLEGAL_DRAW_TRANSITION"
  | "DRAW_STATE_CONFLICT";

export class SettlementDrawError extends Error {
  readonly code: SettlementDrawErrorCode;
  readonly details: Record<string, unknown>;
  constructor(
    code: SettlementDrawErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SettlementDrawError";
    this.code = code;
    this.details = details;
  }
}

export type SettlementDrawCommand =
  | "MARK_RESULT_PENDING"
  | "CONFIRM_RESULT"
  | "START_SETTLEMENT"
  | "COMPLETE_SETTLEMENT";

export const SETTLEMENT_DRAW_PORT = Symbol("SETTLEMENT_DRAW_PORT");

export interface SettlementDrawPort {
  /** Read the Draw's current lifecycle state and version without mutating. */
  loadDraw(drawId: string): Promise<{
    state: string;
    version: number;
    resultSchemaVersionRef: string;
    resultSourceRef: string | null;
    betTypes: ReadonlyArray<{ betTypeCode: string; validationPattern: string }>;
  } | null>;

  transition(input: {
    readonly drawId: string;
    readonly command: SettlementDrawCommand;
    readonly expectedVersion: number;
  }): Promise<{ state: string; version: number }>;
}

// ---------------------------------------------------------------------------
// Settlement -> Betting (confirmed Orders) + order settlement outcome
// ---------------------------------------------------------------------------

export interface ConfirmSettledOrderInput {
  readonly orderId: string;
  readonly outcome: "WIN" | "LOSE";
  readonly payoutMinor: bigint;
  /** Durable payout posting for a winning Order; null for a losing Order. */
  readonly payoutTransactionId: string | null;
}

export const SETTLEMENT_ORDERS_PORT = Symbol("SETTLEMENT_ORDERS_PORT");

export interface SettlementOrdersPort {
  /**
   * Reads the settleable Bet Orders (with their accepted lines) for a Draw,
   * excluding any order already checkpointed by `excludeBatchId`. On a first
   * settlement these are the CONFIRMED orders; on a Result-correction
   * re-settlement it also returns orders already settled by an earlier batch so
   * they are re-evaluated against the corrected Result. Cancelled/rejected/
   * expired orders are never settled.
   */
  listSettleableOrders(
    drawId: string,
    excludeBatchId?: string,
  ): Promise<
    ReadonlyArray<{
      readonly orderId: string;
      readonly memberId: string;
      readonly totalStakeMinor: bigint;
      readonly lines: ReadonlyArray<{
        readonly betTypeCode: string;
        readonly canonicalNumber: string;
        readonly stakeMinor: bigint;
        readonly resolvedPayout: unknown;
      }>;
    }>
  >;

  /**
   * Marks an Order terminal as SETTLED after its settlement effect is durable.
   * Exactly-once per Order: a replay returns the prior outcome identity.
   */
  markOrderSettled(input: ConfirmSettledOrderInput): Promise<void>;
}

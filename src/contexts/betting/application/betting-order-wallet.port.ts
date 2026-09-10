// Cross-context port (boundary) between the betting and wallet-ledger contexts.
//
// The betting bounded context must not import wallet-ledger directly. Confirm
// owns the orchestration, but the authoritative money movement — reserving the
// stake, then consuming that reservation into a durable posting from the actual
// Member source bucket(s) to Betting Settlement — is Wallet & Ledger owned and
// is reached through this port. A platform adapter implements it, so betting
// only ever sees betting-local types.
//
// Idempotency is part of the contract: both operations are keyed by the Bet
// Order, so re-driving a Command after a crash can never double-debit or
// double-refund.

export type BetOrderWalletErrorCode = "INSUFFICIENT_FUNDS" | "WALLET_RESTRICTED";

export class BetOrderWalletError extends Error {
  readonly code: BetOrderWalletErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: BetOrderWalletErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BetOrderWalletError";
    this.code = code;
    this.details = details;
  }
}

/** The durable financial effect that gates a confirmed Bet Order. */
export interface BetStakeEffect {
  readonly reservationId: string;
  readonly transactionId: string;
}

export interface BetOrderWalletPort {
  /**
   * Reserves the stake from the Member's spendable buckets and consumes that
   * reservation into the authoritative Ledger posting. Returns the durable
   * Reservation and Financial Transaction identities. Idempotent per Order.
   */
  commitStake(input: {
    readonly orderId: string;
    readonly memberId: string;
    readonly drawId: string;
    readonly amountMinor: bigint;
    readonly currency: "THB";
    readonly correlationId: string;
  }): Promise<BetStakeEffect>;

  /**
   * Restores the economic effect of a committed stake to the exact source
   * bucket composition recorded on the original Reservation. Idempotent per
   * Order.
   */
  refundStake(input: {
    readonly orderId: string;
    readonly memberId: string;
    readonly stakeTransactionId: string;
    readonly currency: "THB";
    readonly correlationId: string;
  }): Promise<BetStakeEffect>;
}

export const BET_ORDER_WALLET_PORT = Symbol("BET_ORDER_WALLET_PORT");

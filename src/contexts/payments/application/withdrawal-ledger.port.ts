/**
 * Cross-context seam from Payments into the Wallet & Ledger financial authority.
 * Payments never mutates balances directly (Ticket 01): it asks Wallet & Ledger
 * to create the Withdrawal Reservation, to release it when the Withdrawal ends
 * without a payout, and to consume it with the authoritative
 * `WITHDRAWAL_FINALIZE` posting once payout evidence exists.
 *
 * Every operation must be idempotent on the Withdrawal identity so a retry or
 * crash recovery can never duplicate a Reservation, a release, or a posting.
 */
export interface WithdrawalLedgerPort {
  /** Creates the authoritative `WITHDRAWAL` Reservation and returns its id. */
  reserveWithdrawal(input: {
    withdrawalId: string;
    memberId: string;
    amountMinor: bigint;
    currency: "THB";
    correlationId: string;
  }): Promise<string>;
  /** Releases the Withdrawal Reservation; releasing twice is a no-op. */
  releaseWithdrawal(input: {
    withdrawalId: string;
    reservationId: string;
    correlationId: string;
  }): Promise<void>;
  /**
   * Consumes the Withdrawal Reservation and posts the `WITHDRAWAL_FINALIZE`
   * Ledger effect exactly once, returning the Financial Transaction id.
   */
  finalizeWithdrawal(input: {
    withdrawalId: string;
    memberId: string;
    reservationId: string;
    amountMinor: bigint;
    currency: "THB";
    providerId: string;
    correlationId: string;
  }): Promise<string>;
}

export const WITHDRAWAL_LEDGER_PORT = Symbol("WITHDRAWAL_LEDGER_PORT");

/**
 * Raised when Wallet & Ledger refuses the Reservation because the Member's
 * available spendable balance cannot cover it. The Member may never exceed the
 * authoritative available balance (Ledger is the only balance authority).
 */
export class WithdrawalFundsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WithdrawalFundsUnavailableError";
  }
}

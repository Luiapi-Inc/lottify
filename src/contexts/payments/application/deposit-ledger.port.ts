import type { PaymentCurrency } from "../domain/payment-provider-result";

export interface DepositLedgerPort {
  /**
   * Posts the authoritative DEPOSIT_CREDIT Ledger effect (Provider/Clearing
   * to Member CASH) exactly once. Implementations MUST make the posting
   * idempotent on depositId so a reconciliation retry never double-credits.
   */
  creditDeposit(input: {
    depositId: string;
    memberId: string;
    providerId: string;
    amountMinor: bigint;
    currency: PaymentCurrency;
    correlationId: string;
  }): Promise<string>;
}

export const DEPOSIT_LEDGER_PORT = Symbol("DEPOSIT_LEDGER_PORT");
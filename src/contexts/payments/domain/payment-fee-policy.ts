export const PAYMENT_FEE_OPERATIONS = ["DEPOSIT", "WITHDRAWAL"] as const;

export type PaymentFeeOperation = (typeof PAYMENT_FEE_OPERATIONS)[number];

export interface PaymentFeeQuoteInput {
  operation: PaymentFeeOperation;
  providerCode: string;
  methodCode: string;
  amountMinor: bigint;
  resolvedFeeMinor?: bigint;
}

export interface PaymentFeeQuote {
  operation: PaymentFeeOperation;
  providerCode: string;
  methodCode: string;
  amountMinor: bigint;
  feeMinor: bigint;
  requiresLedgerFeePosting: boolean;
}

/**
 * Creates the member-visible fee quote after Payments configuration has resolved
 * any provider/method/amount-specific fee. Until such configuration resolves a
 * non-zero fee, v1 defaults to zero and therefore has no fee-posting obligation.
 *
 * This contract deliberately does not decide who bears a non-zero fee or whether
 * Deposit/Withdrawal amounts are gross/net of that fee; those semantics remain a
 * separate Payments policy decision.
 */
export function createPaymentFeeQuote(input: PaymentFeeQuoteInput): PaymentFeeQuote {
  if (!input.providerCode.trim()) {
    throw new Error("Payment fee quote requires a provider code");
  }
  if (!input.methodCode.trim()) {
    throw new Error("Payment fee quote requires a payment method code");
  }
  if (input.amountMinor <= 0n) {
    throw new Error("Payment fee quote amount must be positive integer minor units");
  }

  const feeMinor = input.resolvedFeeMinor ?? 0n;
  if (feeMinor < 0n) {
    throw new Error("Payment fee cannot be negative");
  }

  return {
    operation: input.operation,
    providerCode: input.providerCode,
    methodCode: input.methodCode,
    amountMinor: input.amountMinor,
    feeMinor,
    requiresLedgerFeePosting: feeMinor > 0n,
  };
}

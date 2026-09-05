import { describe, expect, it } from "vitest";
import { createPaymentFeeQuote } from "../../src/contexts/payments/domain/payment-fee-policy";

describe("payment fee policy", () => {
  it("defaults Deposit fee to zero when no configured fee resolves", () => {
    expect(
      createPaymentFeeQuote({
        operation: "DEPOSIT",
        providerCode: "provider-a",
        methodCode: "bank-transfer",
        amountMinor: 10_000n,
      }),
    ).toEqual({
      operation: "DEPOSIT",
      providerCode: "provider-a",
      methodCode: "bank-transfer",
      amountMinor: 10_000n,
      feeMinor: 0n,
      requiresLedgerFeePosting: false,
    });
  });

  it("defaults Withdrawal fee to zero when no configured fee resolves", () => {
    const quote = createPaymentFeeQuote({
      operation: "WITHDRAWAL",
      providerCode: "provider-b",
      methodCode: "bank-account",
      amountMinor: 25_000n,
    });

    expect(quote.feeMinor).toBe(0n);
    expect(quote.requiresLedgerFeePosting).toBe(false);
  });

  it("preserves a non-zero fee resolved by future Payments configuration", () => {
    const quote = createPaymentFeeQuote({
      operation: "WITHDRAWAL",
      providerCode: "provider-b",
      methodCode: "bank-account",
      amountMinor: 25_000n,
      resolvedFeeMinor: 500n,
    });

    expect(quote.feeMinor).toBe(500n);
    expect(quote.requiresLedgerFeePosting).toBe(true);
  });

  it("rejects negative resolved fees", () => {
    expect(() =>
      createPaymentFeeQuote({
        operation: "DEPOSIT",
        providerCode: "provider-a",
        methodCode: "bank-transfer",
        amountMinor: 10_000n,
        resolvedFeeMinor: -1n,
      }),
    ).toThrow("Payment fee cannot be negative");
  });

  it("requires provider, method and a positive transaction amount", () => {
    expect(() =>
      createPaymentFeeQuote({
        operation: "DEPOSIT",
        providerCode: "",
        methodCode: "bank-transfer",
        amountMinor: 10_000n,
      }),
    ).toThrow("requires a provider code");

    expect(() =>
      createPaymentFeeQuote({
        operation: "DEPOSIT",
        providerCode: "provider-a",
        methodCode: "",
        amountMinor: 10_000n,
      }),
    ).toThrow("requires a payment method code");

    expect(() =>
      createPaymentFeeQuote({
        operation: "DEPOSIT",
        providerCode: "provider-a",
        methodCode: "bank-transfer",
        amountMinor: 0n,
      }),
    ).toThrow("amount must be positive integer minor units");
  });
});

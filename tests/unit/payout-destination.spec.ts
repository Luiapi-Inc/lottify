import { describe, expect, it } from "vitest";
import {
  PayoutDestinationError,
  maskAccountNumber,
  payoutDestinationDigest,
  payoutDestinationIsUsable,
  validatePayoutDestinationInput,
  type PayoutDestination,
} from "../../src/contexts/payments/domain/payout-destination";

function destination(overrides: Partial<PayoutDestination> = {}): PayoutDestination {
  return {
    id: "destination-1",
    memberId: "member-1",
    type: "BANK_ACCOUNT",
    bankCode: "KBANK",
    accountNumberMasked: "********1234",
    accountDigest: "digest",
    accountHolderName: "Somchai",
    currency: "THB",
    status: "VERIFIED",
    verificationEvidenceRef: "destination-verification:abc",
    verifiedAt: new Date("2026-09-10T09:00:00.000Z"),
    disabledAt: null,
    version: 1,
    createdAt: new Date("2026-09-10T09:00:00.000Z"),
    updatedAt: new Date("2026-09-10T09:00:00.000Z"),
    ...overrides,
  };
}

describe("Payout Destination domain", () => {
  it("masks the account reference and never exposes more than the last four digits", () => {
    expect(maskAccountNumber("1234567890")).toBe("******7890");
    expect(maskAccountNumber("123-456-7890")).toBe("******7890");
    expect(maskAccountNumber("123")).toBe("***");
  });

  it("digests the destination reference so raw account numbers are never persisted", () => {
    const digest = payoutDestinationDigest({
      type: "BANK_ACCOUNT",
      bankCode: "kbank",
      accountNumber: "123-456-7890",
    });
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain("1234567890");
    // Normalization makes the same destination stable across formatting.
    expect(
      payoutDestinationDigest({
        type: "BANK_ACCOUNT",
        bankCode: "KBANK",
        accountNumber: "1234567890",
      }),
    ).toBe(digest);
  });

  it("validates the destination shape", () => {
    expect(() =>
      validatePayoutDestinationInput({
        type: "BANK_ACCOUNT",
        bankCode: "KBANK",
        accountNumber: "1234567890",
        accountHolderName: "Somchai",
        currency: "THB",
      }),
    ).not.toThrow();
    expect(() =>
      validatePayoutDestinationInput({
        type: "BANK_ACCOUNT",
        bankCode: "",
        accountNumber: "1234567890",
        accountHolderName: "Somchai",
        currency: "THB",
      }),
    ).toThrow(PayoutDestinationError);
    expect(() =>
      validatePayoutDestinationInput({
        type: "BANK_ACCOUNT",
        bankCode: "KBANK",
        accountNumber: "12",
        accountHolderName: "Somchai",
        currency: "THB",
      }),
    ).toThrow(PayoutDestinationError);
  });

  it("is usable for a withdrawal only while verified and not disabled", () => {
    expect(payoutDestinationIsUsable(destination())).toBe(true);
    expect(payoutDestinationIsUsable(destination({ status: "PENDING" }))).toBe(false);
    expect(payoutDestinationIsUsable(destination({ status: "REJECTED" }))).toBe(false);
    expect(
      payoutDestinationIsUsable(destination({ disabledAt: new Date("2026-09-10T09:30:00.000Z") })),
    ).toBe(false);
  });
});

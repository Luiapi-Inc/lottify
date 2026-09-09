import { describe, expect, it } from "vitest";
import {
  DepositError,
  depositIsOpenForResolution,
  depositStatusForProviderOutcome,
  validateDepositInitiation,
} from "../../src/contexts/payments/domain/deposit";

describe("Payments Deposit domain", () => {
  it("validates initiation requires provider, method, and positive amount", () => {
    expect(() =>
      validateDepositInitiation({ providerCode: "", methodCode: "bank", amountMinor: 1n, currency: "THB" }),
    ).toThrow("Deposit provider code is required");
    expect(() =>
      validateDepositInitiation({ providerCode: "corridor", methodCode: "", amountMinor: 1n, currency: "THB" }),
    ).toThrow("Deposit payment method code is required");
    expect(() =>
      validateDepositInitiation({ providerCode: "corridor", methodCode: "bank", amountMinor: 0n, currency: "THB" }),
    ).toThrow("Deposit amount must be a positive integer");
    expect(() =>
      validateDepositInitiation({ providerCode: "corridor", methodCode: "bank", amountMinor: -5n, currency: "THB" }),
    ).toThrow("Deposit amount must be a positive integer");
  });

  it("maps provider outcomes to terminal deposit statuses", () => {
    expect(depositStatusForProviderOutcome("APPROVED")).toBe("COMPLETED");
    expect(depositStatusForProviderOutcome("REJECTED")).toBe("REJECTED");
    expect(depositStatusForProviderOutcome("PENDING")).toBe("PENDING");
  });

  it("considers only non-terminal deposits open for resolution", () => {
    expect(depositIsOpenForResolution("INITIATED")).toBe(true);
    expect(depositIsOpenForResolution("PENDING")).toBe(true);
    expect(depositIsOpenForResolution("REVIEW_REQUIRED")).toBe(true);
    expect(depositIsOpenForResolution("COMPLETED")).toBe(false);
    expect(depositIsOpenForResolution("REJECTED")).toBe(false);
  });

  it("carries a machine-readable code on domain errors", () => {
    const conflict = new DepositError("IDEMPOTENCY_CONFLICT", "changed payload");
    expect(conflict.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
import { describe, expect, it } from "vitest";
import {
  MEMBER_LEDGER_BUCKETS,
  assertBalancedLedgerPostings,
  assertReservationCanBeCreated,
  calculateAvailableMinorUnits,
} from "../../src/contexts/wallet-ledger/domain/financial-invariants";

describe("financial core invariants", () => {
  it("uses the locked Member ledger buckets", () => {
    expect(MEMBER_LEDGER_BUCKETS).toEqual(["CASH", "BONUS", "LOCKED"]);
  });

  it("accepts balanced THB postings in integer satang", () => {
    expect(() =>
      assertBalancedLedgerPostings([
        { side: "DEBIT", amountMinor: 12_345n, currency: "THB" },
        { side: "CREDIT", amountMinor: 12_345n, currency: "THB" },
      ]),
    ).not.toThrow();
  });

  it("accepts a balanced multi-posting transaction", () => {
    expect(() =>
      assertBalancedLedgerPostings([
        { side: "DEBIT", amountMinor: 10_000n, currency: "THB" },
        { side: "CREDIT", amountMinor: 8_000n, currency: "THB" },
        { side: "CREDIT", amountMinor: 2_000n, currency: "THB" },
      ]),
    ).not.toThrow();
  });

  it("rejects unbalanced postings", () => {
    expect(() =>
      assertBalancedLedgerPostings([
        { side: "DEBIT", amountMinor: 10_000n, currency: "THB" },
        { side: "CREDIT", amountMinor: 9_999n, currency: "THB" },
      ]),
    ).toThrow("must balance debit and credit");
  });

  it("rejects zero or negative posting amounts", () => {
    expect(() =>
      assertBalancedLedgerPostings([
        { side: "DEBIT", amountMinor: 0n, currency: "THB" },
        { side: "CREDIT", amountMinor: 0n, currency: "THB" },
      ]),
    ).toThrow("must be positive integer minor units");
  });

  it("derives available balance from posted spendable value minus active reservations", () => {
    expect(calculateAvailableMinorUnits(10_000n, [2_000n, 1_500n])).toBe(6_500n);
  });

  it("rejects invalid active reservation amounts instead of inflating availability", () => {
    expect(() => calculateAvailableMinorUnits(10_000n, [-1_000n])).toThrow(
      "Active reservation amount must be positive integer minor units",
    );
  });

  it("allows a reservation that exactly consumes the remaining availability", () => {
    expect(() =>
      assertReservationCanBeCreated(10_000n, [2_000n, 1_500n], 6_500n),
    ).not.toThrow();
  });

  it("rejects a reservation that would drive availability below zero", () => {
    expect(() =>
      assertReservationCanBeCreated(10_000n, [2_000n, 1_500n], 6_501n),
    ).toThrow("would exceed available spendable balance");
  });
});

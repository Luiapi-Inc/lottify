import { describe, expect, it } from "vitest";
import {
  hasBlockingNumberRestriction,
  NUMBER_RESTRICTION_KINDS,
  resolveStrictestMaxAmountMinor,
} from "../../src/contexts/lottery/domain/number-restriction";

describe("Lottery number restriction precedence", () => {
  it("locks the canonical number-restriction vocabulary", () => {
    expect(NUMBER_RESTRICTION_KINDS).toEqual([
      "BLOCKED",
      "REDUCED_PAYOUT",
      "MAX_AMOUNT",
    ]);
  });

  it("treats BLOCKED as authoritative regardless of other applicable kinds", () => {
    expect(
      hasBlockingNumberRestriction([
        "MAX_AMOUNT",
        "REDUCED_PAYOUT",
        "BLOCKED",
      ]),
    ).toBe(true);
    expect(
      hasBlockingNumberRestriction([
        "BLOCKED",
        "REDUCED_PAYOUT",
        "MAX_AMOUNT",
      ]),
    ).toBe(true);
    expect(
      hasBlockingNumberRestriction(["MAX_AMOUNT", "REDUCED_PAYOUT"]),
    ).toBe(false);
  });

  it("resolves multiple MAX_AMOUNT restrictions to the strictest amount", () => {
    expect(resolveStrictestMaxAmountMinor([10_000n, 2_500n, 5_000n])).toBe(
      2_500n,
    );
  });

  it("resolves the same strictest maximum regardless of input order", () => {
    expect(resolveStrictestMaxAmountMinor([1_000n, 9_000n, 4_000n])).toBe(
      1_000n,
    );
    expect(resolveStrictestMaxAmountMinor([4_000n, 1_000n, 9_000n])).toBe(
      1_000n,
    );
  });

  it("returns no maximum when no MAX_AMOUNT restriction is applicable", () => {
    expect(resolveStrictestMaxAmountMinor([])).toBeUndefined();
  });
});

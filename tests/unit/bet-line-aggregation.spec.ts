import { describe, expect, it } from "vitest";
import {
  aggregateEquivalentBetLines,
  type CanonicalBetLine,
} from "../../src/contexts/betting/domain/bet-line-aggregation";

describe("Betting canonical Bet Line aggregation", () => {
  it("merges duplicate-equivalent lines and sums stake in integer minor units", () => {
    expect(
      aggregateEquivalentBetLines([
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 1_000n },
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 2_500n },
      ]),
    ).toEqual([
      { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 3_500n },
    ]);
  });

  it("does not merge the same canonical number across different Bet Type codes", () => {
    expect(
      aggregateEquivalentBetLines([
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 1_000n },
        { betTypeCode: "TWO_DIGIT_REVERSE", canonicalNumber: "42", stakeMinor: 2_000n },
      ]),
    ).toEqual([
      { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 1_000n },
      { betTypeCode: "TWO_DIGIT_REVERSE", canonicalNumber: "42", stakeMinor: 2_000n },
    ]);
  });

  it("preserves exact canonical strings so semantic leading zeroes remain distinct", () => {
    expect(
      aggregateEquivalentBetLines([
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "01", stakeMinor: 1_000n },
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "1", stakeMinor: 2_000n },
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "01", stakeMinor: 3_000n },
      ]),
    ).toEqual([
      { betTypeCode: "TWO_DIGIT", canonicalNumber: "01", stakeMinor: 4_000n },
      { betTypeCode: "TWO_DIGIT", canonicalNumber: "1", stakeMinor: 2_000n },
    ]);
  });

  it("retains first-seen line order while aggregating later duplicates", () => {
    expect(
      aggregateEquivalentBetLines([
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "12", stakeMinor: 100n },
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "34", stakeMinor: 200n },
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "12", stakeMinor: 300n },
        { betTypeCode: "THREE_DIGIT", canonicalNumber: "012", stakeMinor: 400n },
      ]),
    ).toEqual([
      { betTypeCode: "TWO_DIGIT", canonicalNumber: "12", stakeMinor: 400n },
      { betTypeCode: "TWO_DIGIT", canonicalNumber: "34", stakeMinor: 200n },
      { betTypeCode: "THREE_DIGIT", canonicalNumber: "012", stakeMinor: 400n },
    ]);
  });

  it("does not mutate input lines", () => {
    const lines: CanonicalBetLine[] = [
      { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 1_000n },
      { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 2_000n },
    ];
    const before = lines.map((line) => ({ ...line }));

    aggregateEquivalentBetLines(lines);

    expect(lines).toEqual(before);
  });

  it("sums bigint stakes without floating-point precision loss", () => {
    const firstStakeMinor = 123_456_789_012_345_678n;
    const secondStakeMinor = 223_456_789_012_345_678n;

    expect(
      aggregateEquivalentBetLines([
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: firstStakeMinor },
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: secondStakeMinor },
      ]),
    ).toEqual([
      {
        betTypeCode: "TWO_DIGIT",
        canonicalNumber: "42",
        stakeMinor: firstStakeMinor + secondStakeMinor,
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { resolveStrictestPerLineStakeLimits } from "../../src/contexts/lottery/domain/per-line-stake-limit";

describe("Lottery per-Line stake-limit precedence", () => {
  it("uses the highest applicable minimum stake", () => {
    expect(
      resolveStrictestPerLineStakeLimits({
        minimumsMinor: [1_000n, 2_500n, 1_500n],
        maximumsMinor: [],
      }),
    ).toEqual({ minStakeMinor: 2_500n });
  });

  it("uses the lowest applicable maximum stake", () => {
    expect(
      resolveStrictestPerLineStakeLimits({
        minimumsMinor: [],
        maximumsMinor: [10_000n, 7_500n, 12_000n],
      }),
    ).toEqual({ maxStakeMinor: 7_500n });
  });

  it("resolves both sides of the per-Line range independently", () => {
    expect(
      resolveStrictestPerLineStakeLimits({
        minimumsMinor: [500n, 1_000n, 750n],
        maximumsMinor: [20_000n, 8_000n, 10_000n],
      }),
    ).toEqual({
      minStakeMinor: 1_000n,
      maxStakeMinor: 8_000n,
    });
  });

  it("is independent of input order", () => {
    const first = resolveStrictestPerLineStakeLimits({
      minimumsMinor: [250n, 1_500n, 1_000n],
      maximumsMinor: [9_000n, 4_000n, 6_000n],
    });
    const second = resolveStrictestPerLineStakeLimits({
      minimumsMinor: [1_000n, 250n, 1_500n],
      maximumsMinor: [6_000n, 9_000n, 4_000n],
    });

    expect(first).toEqual(second);
    expect(first).toEqual({
      minStakeMinor: 1_500n,
      maxStakeMinor: 4_000n,
    });
  });

  it("returns no bound for a side with no applicable constraints", () => {
    expect(
      resolveStrictestPerLineStakeLimits({
        minimumsMinor: [],
        maximumsMinor: [],
      }),
    ).toEqual({});
  });

  it("preserves integer minor-unit values without floating-point conversion", () => {
    const minimumMinor = 123_456_789_012_345_678n;
    const maximumMinor = 223_456_789_012_345_678n;

    expect(
      resolveStrictestPerLineStakeLimits({
        minimumsMinor: [minimumMinor],
        maximumsMinor: [maximumMinor],
      }),
    ).toEqual({
      minStakeMinor: minimumMinor,
      maxStakeMinor: maximumMinor,
    });
  });
});

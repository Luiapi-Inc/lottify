import { describe, expect, it } from "vitest";
import {
  resolveQuoteLines,
  QuoteRuleError,
  type EffectiveBetTypeConfig,
} from "../../src/contexts/betting/domain/quote";

const DRAW_SNAPSHOT_PAYOUT = { kind: "FIXED", amountMinor: 9000n };

function betType(overrides: Partial<EffectiveBetTypeConfig> = {}): EffectiveBetTypeConfig {
  return {
    betTypeId: "bt-1",
    betTypeCode: "TD",
    betTypeVersionId: "btv-1",
    validationPattern: "^[0-9]{2}$",
    payout: DRAW_SNAPSHOT_PAYOUT,
    payoutSource: "DRAW_SNAPSHOT",
    minStakeMinor: 100n,
    maxStakeMinor: 100000n,
    numberRestrictions: [],
    bettingEnabled: true,
    ...overrides,
  };
}

describe("resolveQuoteLines", () => {
  it("aggregates duplicate-equivalent lines and computes a server-side total", () => {
    const result = resolveQuoteLines({
      betTypes: [betType()],
      rawLines: [
        { betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 100n },
        { betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 200n },
        { betTypeCode: "TD", canonicalNumber: "07", stakeMinor: 300n },
      ],
    });

    expect(result.lines).toHaveLength(2);
    expect(result.totalStakeMinor).toBe(600n);

    const fortyTwo = result.lines.find((line) => line.canonicalNumber === "42");
    expect(fortyTwo).toMatchObject({
      stakeMinor: 300n,
      betTypeCode: "TD",
      resolvedPayout: DRAW_SNAPSHOT_PAYOUT,
      payoutSource: "DRAW_SNAPSHOT",
      restrictions: [],
    });
  });

  it("rejects an empty Quote", () => {
    expect(() =>
      resolveQuoteLines({ betTypes: [betType()], rawLines: [] }),
    ).toThrowError(expect.objectContaining({ code: "EMPTY_QUOTE" }));
  });

  it("rejects an unknown Bet Type", () => {
    expect(() =>
      resolveQuoteLines({
        betTypes: [betType()],
        rawLines: [{ betTypeCode: "NOPE", canonicalNumber: "42", stakeMinor: 100n }],
      }),
    ).toThrowError(expect.objectContaining({ code: "BET_TYPE_NOT_FOUND" }));
  });

  it("rejects a disabled Bet Type", () => {
    expect(() =>
      resolveQuoteLines({
        betTypes: [betType({ bettingEnabled: false })],
        rawLines: [{ betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 100n }],
      }),
    ).toThrowError(expect.objectContaining({ code: "BET_TYPE_DISABLED" }));
  });

  it("rejects a canonical number that fails the Bet Type validation pattern", () => {
    expect(() =>
      resolveQuoteLines({
        betTypes: [betType()],
        rawLines: [{ betTypeCode: "TD", canonicalNumber: "abc", stakeMinor: 100n }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_NUMBER" }));
  });

  it("rejects a non-positive stake", () => {
    expect(() =>
      resolveQuoteLines({
        betTypes: [betType()],
        rawLines: [{ betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 0n }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_STAKE" }));
  });

  it("rejects a number with a BLOCKED restriction", () => {
    const blocked = betType({
      numberRestrictions: [
        { kind: "BLOCKED" },
        { kind: "MAX_AMOUNT", maxAmountMinor: 50000n },
      ],
    });
    expect(() =>
      resolveQuoteLines({
        betTypes: [blocked],
        rawLines: [{ betTypeCode: "TD", canonicalNumber: "13", stakeMinor: 100n }],
      }),
    ).toThrowError(expect.objectContaining({ code: "NUMBER_BLOCKED" }));
  });

  it("rejects a stake below the per-line minimum", () => {
    expect(() =>
      resolveQuoteLines({
        betTypes: [betType({ minStakeMinor: 500n })],
        rawLines: [{ betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 100n }],
      }),
    ).toThrowError(expect.objectContaining({ code: "STAKE_BELOW_MINIMUM" }));
  });

  it("rejects a stake above the per-line maximum", () => {
    expect(() =>
      resolveQuoteLines({
        betTypes: [betType({ maxStakeMinor: 500n })],
        rawLines: [{ betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 600n }],
      }),
    ).toThrowError(expect.objectContaining({ code: "STAKE_LIMIT_EXCEEDED" }));
  });

  it("rejects a stake above a MAX_AMOUNT restriction", () => {
    const restricted = betType({
      numberRestrictions: [{ kind: "MAX_AMOUNT", maxAmountMinor: 300n }],
    });
    expect(() =>
      resolveQuoteLines({
        betTypes: [restricted],
        rawLines: [{ betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 301n }],
      }),
    ).toThrowError(expect.objectContaining({ code: "MAX_AMOUNT_EXCEEDED" }));
  });

  it("applies REDUCED_PAYOUT (strictest) over the draw payout and records the restriction", () => {
    const reduced = betType({
      numberRestrictions: [
        { kind: "REDUCED_PAYOUT", payout: { kind: "FIXED", amountMinor: 4000n } },
        { kind: "REDUCED_PAYOUT", payout: { kind: "FIXED", amountMinor: 2000n } },
      ],
    });
    const result = resolveQuoteLines({
      betTypes: [reduced],
      rawLines: [{ betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 100n }],
    });
    const line = result.lines[0]!;
    expect(line.resolvedPayout).toEqual({ kind: "FIXED", amountMinor: 2000n });
    expect(line.restrictions).toContain("REDUCED_PAYOUT");
  });

  it("keeps MAX_AMOUNT cap within the per-line maximum (strictest wins)", () => {
    const restricted = betType({
      maxStakeMinor: 1000n,
      numberRestrictions: [{ kind: "MAX_AMOUNT", maxAmountMinor: 500n }],
    });
    // 700 is below the Bet-Type max (1000) but above the MAX_AMOUNT cap (500).
    expect(() =>
      resolveQuoteLines({
        betTypes: [restricted],
        rawLines: [{ betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 700n }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "MAX_AMOUNT_EXCEEDED" }),
    );
    // 400 is under both caps -> accepted with MAX_AMOUNT recorded.
    const result = resolveQuoteLines({
      betTypes: [restricted],
      rawLines: [{ betTypeCode: "TD", canonicalNumber: "42", stakeMinor: 400n }],
    });
    expect(result.lines[0]!.restrictions).toContain("MAX_AMOUNT");
  });

  it("throws a QuoteRuleError with a stable code and status", () => {
    try {
      resolveQuoteLines({ betTypes: [betType()], rawLines: [] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(QuoteRuleError);
      expect((error as QuoteRuleError).status).toBe(400);
      expect((error as QuoteRuleError).code).toBe("EMPTY_QUOTE");
    }
  });
});

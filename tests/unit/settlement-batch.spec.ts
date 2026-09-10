import { describe, expect, it } from "vitest";
import {
  InvalidSettlementBatchError,
  advanceSettlementBatch,
  evaluateBetLine,
  evaluateOrderSettlement,
  settlementPayoutMinor,
} from "../../src/contexts/result-settlement/domain/settlement-batch";

const FIXED_9000 = { kind: "FIXED", amountMinor: 9000n };

describe("settlementPayoutMinor (FIXED payout contract)", () => {
  it("pays the documented 90x for a 1 THB reference stake", () => {
    expect(
      settlementPayoutMinor({
        betTypeCode: "TWO_DIGIT",
        canonicalNumber: "42",
        stakeMinor: 100n,
        resolvedPayout: FIXED_9000,
      }),
    ).toBe(9000n);
  });

  it("scales linearly and floors deterministically", () => {
    expect(
      settlementPayoutMinor({
        betTypeCode: "TWO_DIGIT",
        canonicalNumber: "42",
        stakeMinor: 200n,
        resolvedPayout: FIXED_9000,
      }),
    ).toBe(18000n);
    expect(
      settlementPayoutMinor({
        betTypeCode: "TWO_DIGIT",
        canonicalNumber: "42",
        stakeMinor: 33n,
        resolvedPayout: FIXED_9000,
      }),
    ).toBe(2970n); // floor(33 * 9000 / 100)
  });

  it("rejects an unsupported payout kind", () => {
    expect(() =>
      settlementPayoutMinor({
        betTypeCode: "ODDS",
        canonicalNumber: "42",
        stakeMinor: 100n,
        resolvedPayout: { kind: "MULTIPLIER", multiplier: 1.5 },
      }),
    ).toThrow(InvalidSettlementBatchError);
  });
});

describe("evaluateBetLine", () => {
  const line = {
    betTypeCode: "TWO_DIGIT",
    canonicalNumber: "42",
    stakeMinor: 100n,
    resolvedPayout: FIXED_9000,
  };

  it("wins only when the winning number matches exactly", () => {
    expect(evaluateBetLine({ ...line, winningNumber: "42" })).toEqual({
      outcome: "WIN",
      payoutMinor: 9000n,
    });
    expect(evaluateBetLine({ ...line, winningNumber: "07" })).toEqual({
      outcome: "LOSE",
      payoutMinor: 0n,
    });
    expect(evaluateBetLine({ ...line, winningNumber: undefined })).toEqual({
      outcome: "LOSE",
      payoutMinor: 0n,
    });
  });
});

describe("evaluateOrderSettlement", () => {
  it("an Order wins when ANY line matches and pays the summed winning return", () => {
    const result = evaluateOrderSettlement({
      orderId: "order-1",
      lines: [
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 100n, resolvedPayout: FIXED_9000 },
        { betTypeCode: "TWO_DIGIT", canonicalNumber: "07", stakeMinor: 300n, resolvedPayout: FIXED_9000 },
      ],
      winningNumbers: { TWO_DIGIT: "42" },
    });
    expect(result).toEqual({ orderId: "order-1", outcome: "WIN", payoutMinor: 9000n });
  });

  it("an Order with no matching line loses with zero payout", () => {
    const result = evaluateOrderSettlement({
      orderId: "order-2",
      lines: [{ betTypeCode: "TWO_DIGIT", canonicalNumber: "07", stakeMinor: 300n, resolvedPayout: FIXED_9000 }],
      winningNumbers: { TWO_DIGIT: "42" },
    });
    expect(result).toEqual({ orderId: "order-2", outcome: "LOSE", payoutMinor: 0n });
  });
});

describe("advanceSettlementBatch", () => {
  it("walks PENDING -> CALCULATING -> POSTING -> COMMITTING -> COMPLETED", () => {
    let state: ReturnType<typeof advanceSettlementBatch> = "PENDING";
    for (const next of ["CALCULATING", "POSTING", "COMMITTING", "COMPLETED"] as const) {
      state = advanceSettlementBatch(state, next);
    }
    expect(state).toBe("COMPLETED");
  });

  it("rejects illegal jumps and terminal advancement", () => {
    expect(() => advanceSettlementBatch("PENDING", "COMPLETED")).toThrow(
      InvalidSettlementBatchError,
    );
    expect(() => advanceSettlementBatch("PENDING", "COMMITTING")).toThrow(
      InvalidSettlementBatchError,
    );
    expect(() => advanceSettlementBatch("COMPLETED", "CALCULATING")).toThrow(
      /terminal/,
    );
    expect(() => advanceSettlementBatch("FAILED", "POSTING")).toThrow(
      InvalidSettlementBatchError,
    );
  });

  it("routes failures to FAILED and RETRY_PENDING", () => {
    expect(advanceSettlementBatch("PENDING", "FAILED")).toBe("FAILED");
    expect(advanceSettlementBatch("POSTING", "RETRY_PENDING")).toBe("RETRY_PENDING");
  });
});

import { describe, expect, it } from "vitest";
import {
  assertTurnoverEntryTransition,
  calculateTurnoverAdjustment,
  calculateTurnoverContribution,
  calculateTurnoverProgress,
  type TurnoverEntryProgressFact,
} from "../../src/contexts/promotion/domain/turnover-ledger";
import { PromotionRuleError } from "../../src/contexts/promotion/domain/rule-error";
import { validTerms } from "../support/promotion-fixtures";

const ACCEPTED_AT = new Date("2026-10-15T12:00:00.000Z");

function bet(overrides: Partial<Parameters<typeof calculateTurnoverContribution>[1]> = {}) {
  return {
    betReference: "bet-1",
    productId: "product-1",
    betTypeCode: "TWO_DIGIT",
    stakeMinor: 10_000n,
    payoutRef: "payout-v1",
    acceptedAt: ACCEPTED_AT,
    ...overrides,
  };
}

describe("Turnover contribution", () => {
  it("contributes the accepted stake at the snapshotted contribution rate", () => {
    const decision = calculateTurnoverContribution(
      validTerms({
        scope: {
          eligibleProductIds: [],
          eligibleBetTypeCodes: [],
          contributionBps: 5_000,
          minPayoutRef: null,
        },
      }),
      bet(),
    );
    expect(decision).toEqual({ eligible: true, reason: null, contributionMinor: 5_000n });
  });

  it("refuses a Bet outside the snapshotted eligible scope", () => {
    const terms = validTerms({
      scope: {
        eligibleProductIds: ["product-1"],
        eligibleBetTypeCodes: ["THREE_DIGIT"],
        contributionBps: 10_000,
        minPayoutRef: "payout-v1",
      },
    });
    expect(calculateTurnoverContribution(terms, bet()).reason).toBe("BET_TYPE_NOT_IN_SCOPE");
    expect(
      calculateTurnoverContribution(terms, bet({ betTypeCode: "THREE_DIGIT", productId: "product-2" }))
        .reason,
    ).toBe("PRODUCT_NOT_IN_SCOPE");
    expect(
      calculateTurnoverContribution(
        terms,
        bet({ betTypeCode: "THREE_DIGIT", productId: "product-1", payoutRef: "other" }),
      ).reason,
    ).toBe("PAYOUT_RULE_NOT_ACCEPTED");
  });

  it("never records a contribution that rounds to zero", () => {
    const decision = calculateTurnoverContribution(
      validTerms({
        scope: {
          eligibleProductIds: [],
          eligibleBetTypeCodes: [],
          contributionBps: 1,
          minPayoutRef: null,
        },
      }),
      bet({ stakeMinor: 1n }),
    );
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("CONTRIBUTION_ROUNDS_TO_ZERO");
    expect(decision.contributionMinor).toBe(0n);
  });

  it("counts provisional progress but only finalized contribution releases a Promotion", () => {
    const entries: TurnoverEntryProgressFact[] = [
      { entryKind: "BET", state: "PROVISIONAL", contributionMinor: 20_000n },
      { entryKind: "BET", state: "FINALIZED", contributionMinor: 50_000n },
      { entryKind: "BET", state: "REMOVED", contributionMinor: 90_000n },
    ];
    const progress = calculateTurnoverProgress(entries, 100_000n);
    expect(progress.provisionalMinor).toBe(20_000n);
    expect(progress.finalizedMinor).toBe(50_000n);
    expect(progress.progressMinor).toBe(70_000n);
    expect(progress.remainingMinor).toBe(50_000n);
    expect(progress.releaseReached).toBe(false);

    const reached = calculateTurnoverProgress(
      [
        { entryKind: "BET", state: "FINALIZED", contributionMinor: 100_000n },
        { entryKind: "BET", state: "PROVISIONAL", contributionMinor: 5_000n },
      ],
      100_000n,
    );
    expect(reached.releaseReached).toBe(true);
    expect(reached.remainingMinor).toBe(0n);
  });

  it("accounts for a finalization only after the contribution lifecycle allows it", () => {
    expect(() => assertTurnoverEntryTransition("PROVISIONAL", "FINALIZED")).not.toThrow();
    expect(() => assertTurnoverEntryTransition("PROVISIONAL", "REMOVED")).not.toThrow();
    // A finalized contribution is terminal: corrections are compensations, not rewrites.
    expect(() => assertTurnoverEntryTransition("FINALIZED", "REMOVED")).toThrow(PromotionRuleError);
    expect(() => assertTurnoverEntryTransition("REMOVED", "FINALIZED")).toThrow(PromotionRuleError);
  });

  it("computes a correction as the signed difference against the original contribution", () => {
    expect(calculateTurnoverAdjustment(5_000n, 4_000n)).toBe(-1_000n);
    expect(calculateTurnoverAdjustment(5_000n, 7_000n)).toBe(2_000n);
    expect(() => calculateTurnoverAdjustment(5_000n, -1n)).toThrow(PromotionRuleError);
  });
});

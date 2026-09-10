import { describe, expect, it } from "vitest";
import {
  assertCampaignVersionEditable,
  assertCampaignVersionTransition,
  canTransitionCampaignVersion,
  canonicalJson,
  isCampaignVersionEffective,
  promotionTermsDigest,
  promotionTurnoverTargetMinor,
  validatePromotionCampaignTerms,
  type PromotionCampaignTerms,
} from "../../src/contexts/promotion/domain/campaign-terms";
import { PromotionRuleError } from "../../src/contexts/promotion/domain/rule-error";
import { validTerms } from "../support/promotion-fixtures";

describe("Promotion Campaign version semantics", () => {
  it("accepts a coherent versioned Campaign and derives its turnover target", () => {
    const terms = validTerms();
    expect(validatePromotionCampaignTerms(terms)).toEqual([]);
    // 50,000 minor units reward at a 3x turnover multiplier => 150,000 target.
    expect(promotionTurnoverTargetMinor(terms)).toBe(150_000n);
  });

  it("rejects terms that cannot be explained financially or historically", () => {
    const violations = validatePromotionCampaignTerms(
      validTerms({
        rewardAmountMinor: "0",
        currency: "THB",
        winningsDestination: "PROPORTIONAL",
        proportionalWinningsBps: null,
        expiryDaysAfterGrant: 0,
        turnoverMultiplierBps: -1,
        fundingSource: "  ",
        scope: {
          eligibleProductIds: [],
          eligibleBetTypeCodes: [],
          contributionBps: 20_000,
          minPayoutRef: null,
        },
      }),
    );
    const fields = violations.map((violation) => violation.field);
    expect(fields).toContain("rewardAmountMinor");
    expect(fields).toContain("proportionalWinningsBps");
    expect(fields).toContain("expiryDaysAfterGrant");
    expect(fields).toContain("turnoverMultiplierBps");
    expect(fields).toContain("fundingSource");
    expect(fields).toContain("scope.contributionBps");
  });

  it("rejects a proportional winnings rule that is not explicitly bounded", () => {
    expect(
      validatePromotionCampaignTerms(
        validTerms({ winningsDestination: "CASH", proportionalWinningsBps: 5_000 }),
      ).map((violation) => violation.field),
    ).toContain("proportionalWinningsBps");
  });

  it("digests the terms canonically so the digest survives a JSONB round-trip", () => {
    const terms = validTerms();
    const reordered = { ...terms } as Record<string, unknown>;
    const shuffled = Object.fromEntries(
      Object.keys(reordered)
        .sort()
        .reverse()
        .map((key) => [key, reordered[key]]),
    ) as unknown as PromotionCampaignTerms;
    expect(promotionTermsDigest(terms)).toBe(promotionTermsDigest(shuffled));
    expect(promotionTermsDigest(terms)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("locks the Draft → Validate → Approval → Publish → Retire lifecycle", () => {
    expect(canTransitionCampaignVersion("DRAFT", "VALIDATED")).toBe(true);
    expect(canTransitionCampaignVersion("VALIDATED", "PUBLISHED")).toBe(true);
    expect(canTransitionCampaignVersion("PUBLISHED", "RETIRED")).toBe(true);
    // A pure status mutation must never skip validation or reopen published terms.
    expect(canTransitionCampaignVersion("DRAFT", "PUBLISHED")).toBe(false);
    expect(canTransitionCampaignVersion("PUBLISHED", "VALIDATED")).toBe(false);
    expect(() => assertCampaignVersionTransition("DRAFT", "PUBLISHED")).toThrow(
      PromotionRuleError,
    );
    expect(() => assertCampaignVersionEditable("PUBLISHED")).toThrow(PromotionRuleError);
    expect(() => assertCampaignVersionEditable("RETIRED")).toThrow(PromotionRuleError);
    expect(() => assertCampaignVersionEditable("DRAFT")).not.toThrow();
  });

  it("treats only published versions inside their effective window as claimable", () => {
    const version = {
      state: "PUBLISHED" as const,
      effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
      effectiveUntil: new Date("2026-11-01T00:00:00.000Z"),
    };
    expect(isCampaignVersionEffective(version, new Date("2026-10-15T00:00:00.000Z"))).toBe(true);
    expect(isCampaignVersionEffective(version, new Date("2026-09-30T23:59:59.000Z"))).toBe(false);
    expect(isCampaignVersionEffective(version, new Date("2026-11-01T00:00:00.000Z"))).toBe(false);
    expect(
      isCampaignVersionEffective(
        { ...version, state: "VALIDATED" as const },
        new Date("2026-10-15T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

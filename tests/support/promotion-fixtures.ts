import type { PromotionCampaignTerms } from "../../src/contexts/promotion/domain/campaign-terms";

/** A coherent published-Campaign terms fixture; override only what a test proves. */
export function validTerms(overrides: Partial<PromotionCampaignTerms> = {}): PromotionCampaignTerms {
  return {
    schemaVersion: "promotion-terms-v1",
    rewardType: "BONUS_CREDIT",
    rewardAmountMinor: "50000",
    currency: "THB",
    eligibility: { requiredMemberStatus: "ACTIVE", excludedMemberIds: [] },
    scope: {
      eligibleProductIds: [],
      eligibleBetTypeCodes: [],
      contributionBps: 10_000,
      minPayoutRef: null,
    },
    turnoverMultiplierBps: 30_000,
    fundingSource: "welcome-2026",
    winningsDestination: "BONUS",
    proportionalWinningsBps: null,
    expiryDaysAfterGrant: 30,
    stacking: { mode: "EXCLUSIVE", priority: 10, compatibilityGroup: null },
    antiAbusePolicyRef: "anti-abuse-v1",
    policyVersion: "promotion-policy-v1",
    ...overrides,
  };
}

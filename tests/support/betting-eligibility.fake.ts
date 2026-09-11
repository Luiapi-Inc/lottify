import type { BettingEligibilityPort } from "../../src/contexts/betting/application/betting-eligibility.port";

export const allowBetEligibility: BettingEligibilityPort = {
  evaluate: async () => ({
    outcome: "ALLOW",
    reasonCodes: [],
    policyVersion: "test-betting-eligibility-v1",
  }),
};

export const denyBetEligibility: BettingEligibilityPort = {
  evaluate: async () => ({
    outcome: "DENY",
    reasonCodes: ["KYC_REQUIRED"],
    policyVersion: "capability-readiness-policy-v1",
  }),
};

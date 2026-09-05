import { describe, expect, it } from "vitest";
import {
  resolveWithdrawalEligibilityDecision,
  type WithdrawalEligibilityRuleResult,
  type WithdrawalEligibilityRuleResults,
} from "../../src/contexts/kyc-risk/domain/withdrawal-eligibility-policy";

const EVALUATED_AT = new Date("2026-09-05T03:00:00.000Z");
const VALID_UNTIL = new Date("2026-09-05T03:05:00.000Z");

function rule(
  outcome: WithdrawalEligibilityRuleResult["outcome"] = "ALLOW",
  reasonCodes: readonly string[] = [],
  evidenceRefs: readonly string[] = [],
): WithdrawalEligibilityRuleResult {
  return { outcome, reasonCodes, evidenceRefs };
}

function rules(
  overrides: Partial<WithdrawalEligibilityRuleResults> = {},
): WithdrawalEligibilityRuleResults {
  return {
    AMOUNT_LIMIT: rule(),
    DAILY_AGGREGATE: rule(),
    FREQUENCY: rule(),
    KYC_TIER: rule(),
    PAYOUT_DESTINATION_VERIFICATION: rule(),
    RISK: rule(),
    CAPABILITY_RESTRICTION: rule(),
    APPROVAL_THRESHOLD: rule(),
    ...overrides,
  };
}

function resolve(policyRules: WithdrawalEligibilityRuleResults) {
  return resolveWithdrawalEligibilityDecision({
    policyVersion: "withdrawal-eligibility:v1",
    evaluatedAt: EVALUATED_AT,
    validUntil: VALID_UNTIL,
    rules: policyRules,
  });
}

describe("withdrawal eligibility policy", () => {
  it("allows only when every withdrawal rule allows", () => {
    const decision = resolve(rules());

    expect(decision).toEqual(
      expect.objectContaining({
        capability: "WITHDRAW",
        outcome: "ALLOW",
        reasonCodes: [],
        evidenceRefs: [],
        policyVersion: "withdrawal-eligibility:v1",
      }),
    );
  });

  it("requires review when any applicable rule requires review", () => {
    const decision = resolve(
      rules({
        KYC_TIER: rule(
          "REVIEW_REQUIRED",
          ["KYC_TIER_REVIEW"],
          ["verification:kyc-123"],
        ),
      }),
    );

    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.reasonCodes).toEqual(["KYC_TIER_REVIEW"]);
    expect(decision.evidenceRefs).toEqual(["verification:kyc-123"]);
  });

  it("denies when any rule denies even if another rule only requires review", () => {
    const decision = resolve(
      rules({
        APPROVAL_THRESHOLD: rule("REVIEW_REQUIRED", ["APPROVAL_REQUIRED"]),
        CAPABILITY_RESTRICTION: rule(
          "DENY",
          ["WITHDRAWAL_BLOCKED"],
          ["restriction:withdrawal-1"],
        ),
      }),
    );

    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toEqual(["WITHDRAWAL_BLOCKED"]);
    expect(decision.evidenceRefs).toEqual(["restriction:withdrawal-1"]);
  });

  it("preserves reasons and evidence from every rule tied at the strictest outcome", () => {
    const decision = resolve(
      rules({
        AMOUNT_LIMIT: rule(
          "DENY",
          ["AMOUNT_LIMIT_EXCEEDED"],
          ["policy-limit:amount"],
        ),
        DAILY_AGGREGATE: rule(
          "DENY",
          ["DAILY_AGGREGATE_EXCEEDED"],
          ["withdrawal-aggregate:2026-09-05"],
        ),
        RISK: rule("REVIEW_REQUIRED", ["RISK_REVIEW"]),
      }),
    );

    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toEqual([
      "AMOUNT_LIMIT_EXCEEDED",
      "DAILY_AGGREGATE_EXCEEDED",
    ]);
    expect(decision.evidenceRefs).toEqual([
      "policy-limit:amount",
      "withdrawal-aggregate:2026-09-05",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  resolveEligibilityDecision,
  type EligibilityPolicyLayerResult,
  type EligibilityPolicyLayerResults,
} from "../../src/contexts/kyc-risk/domain/eligibility-policy";

const EVALUATED_AT = new Date("2026-09-04T04:45:00.000Z");
const VALID_UNTIL = new Date("2026-09-04T04:50:00.000Z");

function layer(
  outcome: EligibilityPolicyLayerResult["outcome"] = "ALLOW",
  reasonCodes: readonly string[] = [],
  evidenceRefs: readonly string[] = [],
): EligibilityPolicyLayerResult {
  return { outcome, reasonCodes, evidenceRefs };
}

function layers(
  overrides: Partial<EligibilityPolicyLayerResults> = {},
): EligibilityPolicyLayerResults {
  return {
    HARD_RESTRICTION_OR_SELF_EXCLUSION: layer(),
    COMPLIANCE: layer(),
    RISK: layer(),
    CAPABILITY_POLICY: layer(),
    ...overrides,
  };
}

function resolve(policyLayers: EligibilityPolicyLayerResults) {
  return resolveEligibilityDecision({
    capability: "BET",
    policyVersion: "bet-eligibility:v4",
    evaluatedAt: EVALUATED_AT,
    validUntil: VALID_UNTIL,
    layers: policyLayers,
  });
}

describe("eligibility policy precedence", () => {
  it("keeps a hard restriction authoritative over every lower-priority layer", () => {
    const decision = resolve(
      layers({
        HARD_RESTRICTION_OR_SELF_EXCLUSION: layer(
          "DENY",
          ["SELF_EXCLUSION"],
          ["restriction:self-exclusion-1"],
        ),
        COMPLIANCE: layer("ALLOW"),
        RISK: layer("ALLOW"),
        CAPABILITY_POLICY: layer("ALLOW"),
      }),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        outcome: "DENY",
        reasonCodes: ["SELF_EXCLUSION"],
        evidenceRefs: ["restriction:self-exclusion-1"],
      }),
    );
  });

  it("evaluates compliance before risk and capability policy", () => {
    const decision = resolve(
      layers({
        COMPLIANCE: layer("REVIEW_REQUIRED", ["COMPLIANCE_REVIEW"]),
        RISK: layer("DENY", ["RISK_DENY"]),
        CAPABILITY_POLICY: layer("DENY", ["BUSINESS_DENY"]),
      }),
    );

    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.reasonCodes).toEqual(["COMPLIANCE_REVIEW"]);
  });

  it("evaluates risk before capability policy", () => {
    const decision = resolve(
      layers({
        RISK: layer("CHALLENGE/REAUTH_REQUIRED", ["REAUTH_REQUIRED"]),
        CAPABILITY_POLICY: layer("DENY", ["BUSINESS_DENY"]),
      }),
    );

    expect(decision.outcome).toBe("CHALLENGE/REAUTH_REQUIRED");
    expect(decision.reasonCodes).toEqual(["REAUTH_REQUIRED"]);
  });

  it("allows only after every higher-priority policy layer allows", () => {
    const decision = resolve(layers());

    expect(decision.outcome).toBe("ALLOW");
    expect(decision.reasonCodes).toEqual([]);
    expect(decision.evidenceRefs).toEqual([]);
  });
});

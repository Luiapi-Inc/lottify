import type { EligibilityPolicyLayerResult } from "./eligibility-policy";

export interface EvaluateSelfExclusionPolicyInput {
  active: boolean;
  evidenceRefs: readonly string[];
}

export function evaluateSelfExclusionPolicy(
  input: EvaluateSelfExclusionPolicyInput,
): EligibilityPolicyLayerResult {
  if (!input.active) {
    return {
      outcome: "ALLOW",
      reasonCodes: [],
      evidenceRefs: [],
    };
  }

  return {
    outcome: "DENY",
    reasonCodes: ["SELF_EXCLUSION"],
    evidenceRefs: [...input.evidenceRefs],
  };
}

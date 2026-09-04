import {
  createEligibilityDecision,
  type EligibilityDecision,
  type EligibilityDecisionOutcome,
} from "./eligibility-decision";

export const ELIGIBILITY_POLICY_LAYERS = [
  "HARD_RESTRICTION_OR_SELF_EXCLUSION",
  "COMPLIANCE",
  "RISK",
  "CAPABILITY_POLICY",
] as const;

export type EligibilityPolicyLayer =
  (typeof ELIGIBILITY_POLICY_LAYERS)[number];

export interface EligibilityPolicyLayerResult {
  outcome: EligibilityDecisionOutcome;
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
}

export type EligibilityPolicyLayerResults = Record<
  EligibilityPolicyLayer,
  EligibilityPolicyLayerResult
>;

export interface ResolveEligibilityDecisionInput {
  capability: string;
  policyVersion: string;
  evaluatedAt: Date;
  validUntil: Date;
  layers: EligibilityPolicyLayerResults;
}

export function resolveEligibilityDecision(
  input: ResolveEligibilityDecisionInput,
): EligibilityDecision {
  for (const layer of ELIGIBILITY_POLICY_LAYERS) {
    const result = input.layers[layer];
    if (result.outcome !== "ALLOW") {
      return createEligibilityDecision({
        capability: input.capability,
        outcome: result.outcome,
        reasonCodes: result.reasonCodes,
        policyVersion: input.policyVersion,
        evidenceRefs: result.evidenceRefs,
        evaluatedAt: input.evaluatedAt,
        validUntil: input.validUntil,
      });
    }
  }

  return createEligibilityDecision({
    capability: input.capability,
    outcome: "ALLOW",
    policyVersion: input.policyVersion,
    evaluatedAt: input.evaluatedAt,
    validUntil: input.validUntil,
  });
}

export const ELIGIBILITY_DECISION_OUTCOMES = [
  "ALLOW",
  "DENY",
  "REVIEW_REQUIRED",
  "CHALLENGE/REAUTH_REQUIRED",
] as const;

export type EligibilityDecisionOutcome =
  (typeof ELIGIBILITY_DECISION_OUTCOMES)[number];

export interface EligibilityDecision {
  capability: string;
  outcome: EligibilityDecisionOutcome;
  reasonCodes: readonly string[];
  policyVersion: string;
  evidenceRefs: readonly string[];
  evaluatedAt: Date;
  validUntil: Date;
}

export interface CreateEligibilityDecisionInput {
  capability: string;
  outcome: EligibilityDecisionOutcome;
  reasonCodes?: readonly string[];
  policyVersion: string;
  evidenceRefs?: readonly string[];
  evaluatedAt: Date;
  validUntil: Date;
}

export function createEligibilityDecision(
  input: CreateEligibilityDecisionInput,
): EligibilityDecision {
  if (input.validUntil.getTime() <= input.evaluatedAt.getTime()) {
    throw new Error("Eligibility decision freshness window must end after evaluation time");
  }

  return {
    capability: input.capability,
    outcome: input.outcome,
    reasonCodes: [...(input.reasonCodes ?? [])],
    policyVersion: input.policyVersion,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    evaluatedAt: new Date(input.evaluatedAt),
    validUntil: new Date(input.validUntil),
  };
}

export function isEligibilityDecisionFresh(
  decision: EligibilityDecision,
  at: Date,
): boolean {
  return (
    decision.evaluatedAt.getTime() <= at.getTime() &&
    at.getTime() < decision.validUntil.getTime()
  );
}

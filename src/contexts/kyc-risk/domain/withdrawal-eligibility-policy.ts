import {
  createEligibilityDecision,
  type EligibilityDecision,
} from "./eligibility-decision";

export const WITHDRAWAL_ELIGIBILITY_RULES = [
  "AMOUNT_LIMIT",
  "DAILY_AGGREGATE",
  "FREQUENCY",
  "KYC_TIER",
  "PAYOUT_DESTINATION_VERIFICATION",
  "RISK",
  "CAPABILITY_RESTRICTION",
  "APPROVAL_THRESHOLD",
] as const;

export type WithdrawalEligibilityRule =
  (typeof WITHDRAWAL_ELIGIBILITY_RULES)[number];

export const WITHDRAWAL_ELIGIBILITY_OUTCOMES = [
  "ALLOW",
  "REVIEW_REQUIRED",
  "DENY",
] as const;

export type WithdrawalEligibilityOutcome =
  (typeof WITHDRAWAL_ELIGIBILITY_OUTCOMES)[number];

export interface WithdrawalEligibilityRuleResult {
  outcome: WithdrawalEligibilityOutcome;
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
}

export type WithdrawalEligibilityRuleResults = Record<
  WithdrawalEligibilityRule,
  WithdrawalEligibilityRuleResult
>;

export interface ResolveWithdrawalEligibilityDecisionInput {
  policyVersion: string;
  evaluatedAt: Date;
  validUntil: Date;
  rules: WithdrawalEligibilityRuleResults;
}

const OUTCOME_SEVERITY: Record<WithdrawalEligibilityOutcome, number> = {
  ALLOW: 0,
  REVIEW_REQUIRED: 1,
  DENY: 2,
};

export function resolveWithdrawalEligibilityDecision(
  input: ResolveWithdrawalEligibilityDecisionInput,
): EligibilityDecision {
  let strictestOutcome: WithdrawalEligibilityOutcome = "ALLOW";

  for (const rule of WITHDRAWAL_ELIGIBILITY_RULES) {
    const result = input.rules[rule];
    if (OUTCOME_SEVERITY[result.outcome] > OUTCOME_SEVERITY[strictestOutcome]) {
      strictestOutcome = result.outcome;
    }
  }

  const strictestResults = WITHDRAWAL_ELIGIBILITY_RULES.map(
    (rule) => input.rules[rule],
  ).filter((result) => result.outcome === strictestOutcome);

  return createEligibilityDecision({
    capability: "WITHDRAW",
    outcome: strictestOutcome,
    reasonCodes: strictestResults.flatMap((result) => result.reasonCodes),
    policyVersion: input.policyVersion,
    evidenceRefs: strictestResults.flatMap((result) => result.evidenceRefs),
    evaluatedAt: input.evaluatedAt,
    validUntil: input.validUntil,
  });
}

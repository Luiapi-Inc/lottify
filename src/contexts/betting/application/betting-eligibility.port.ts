export type BettingEligibilityOutcome =
  | "ALLOW"
  | "DENY"
  | "REVIEW_REQUIRED"
  | "CHALLENGE/REAUTH_REQUIRED";

export interface BettingEligibilityDecision {
  readonly outcome: BettingEligibilityOutcome;
  readonly reasonCodes: readonly string[];
  readonly policyVersion: string;
  readonly evidenceRefs?: readonly string[];
}

export interface BettingEligibilityPort {
  evaluate(memberId: string, at: Date): Promise<BettingEligibilityDecision>;
}

export const BETTING_ELIGIBILITY_PORT = Symbol("BETTING_ELIGIBILITY_PORT");

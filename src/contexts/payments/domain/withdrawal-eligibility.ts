import type { WithdrawalEligibilityOutcome } from "./withdrawal";

/**
 * Withdrawal eligibility resolution for the locked KYC/Risk rule set
 * (Ticket 06). Every rule whose authoritative input this vertical can observe is
 * required as evaluated input and resolved deny-first: a lower-priority layer can
 * never replace an earlier non-allow decision.
 *
 * This resolver does not invent threshold values. Rules whose thresholds are not
 * yet defined by the owning policy (amount limit, daily aggregate, frequency,
 * KYC tier, risk, approval threshold) are supplied by the caller as an already
 * evaluated `additionalReview` signal, so the Withdrawal vertical cannot act as
 * a second balance/policy authority.
 */
export const WITHDRAWAL_ELIGIBILITY_POLICY_VERSION = "withdrawal-eligibility-v1";

export const WITHDRAWAL_ELIGIBILITY_REASON_CODES = [
  "PAYOUT_DESTINATION_UNAVAILABLE",
  "PAYOUT_DESTINATION_NOT_VERIFIED",
  "CAPABILITY_RESTRICTION",
  "REVIEW_REQUIRED",
  "ELIGIBLE",
] as const;

export type WithdrawalEligibilityReasonCode =
  (typeof WITHDRAWAL_ELIGIBILITY_REASON_CODES)[number];

export interface WithdrawalEligibilityInput {
  policyVersion: string;
  evaluatedAt: Date;
  validUntil: Date;
  destination: {
    /** A destination reference was supplied and exists. */
    present: boolean;
    /** The destination is owned by the requesting Member. */
    ownedByMember: boolean;
    verified: boolean;
    disabled: boolean;
  };
  capability: {
    withdrawalBlocked: boolean;
    reasonCodes?: readonly string[];
    evidenceRefs?: readonly string[];
  };
  /** Already evaluated policy/review signal from the owning policy layer. */
  additionalReview: {
    required: boolean;
    reasonCodes?: readonly string[];
    evidenceRefs?: readonly string[];
  };
}

export interface WithdrawalEligibilityDecision {
  outcome: WithdrawalEligibilityOutcome;
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
  policyVersion: string;
  evaluatedAt: Date;
  validUntil: Date;
}

export function resolveWithdrawalEligibility(
  input: WithdrawalEligibilityInput,
): WithdrawalEligibilityDecision {
  if (input.validUntil.getTime() <= input.evaluatedAt.getTime()) {
    throw new Error("Withdrawal eligibility freshness window must end after evaluation time");
  }

  const denied = (
    reasonCode: WithdrawalEligibilityReasonCode,
    evidenceRefs: readonly string[] = [],
  ): WithdrawalEligibilityDecision => ({
    outcome: "DENY",
    reasonCodes: [reasonCode],
    evidenceRefs: [...evidenceRefs],
    policyVersion: input.policyVersion,
    evaluatedAt: new Date(input.evaluatedAt),
    validUntil: new Date(input.validUntil),
  });

  const destination = input.destination;
  if (!destination.present || !destination.ownedByMember || destination.disabled) {
    return denied("PAYOUT_DESTINATION_UNAVAILABLE", ["destination:state"]);
  }
  if (!destination.verified) {
    return denied("PAYOUT_DESTINATION_NOT_VERIFIED", ["destination:verification"]);
  }
  if (input.capability.withdrawalBlocked) {
    return denied("CAPABILITY_RESTRICTION", [
      "capability:withdrawal",
      ...(input.capability.evidenceRefs ?? []),
    ]);
  }
  if (input.additionalReview.required) {
    return {
      outcome: "REVIEW_REQUIRED",
      reasonCodes: ["REVIEW_REQUIRED", ...(input.additionalReview.reasonCodes ?? [])],
      evidenceRefs: [...(input.additionalReview.evidenceRefs ?? [])],
      policyVersion: input.policyVersion,
      evaluatedAt: new Date(input.evaluatedAt),
      validUntil: new Date(input.validUntil),
    };
  }

  return {
    outcome: "ALLOW",
    reasonCodes: ["ELIGIBLE"],
    evidenceRefs: ["destination:verification"],
    policyVersion: input.policyVersion,
    evaluatedAt: new Date(input.evaluatedAt),
    validUntil: new Date(input.validUntil),
  };
}

export function isWithdrawalEligibilityFresh(
  decision: { evaluatedAt: Date; validUntil: Date },
  at: Date,
): boolean {
  return (
    decision.evaluatedAt.getTime() <= at.getTime() &&
    at.getTime() < decision.validUntil.getTime()
  );
}

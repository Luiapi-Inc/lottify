/**
 * Cross-context seam for the Member capability restrictions KYC/Risk eligibility
 * depends on.
 *
 * Ticket 01 assigns "effective Member capability restrictions" to the Member
 * context; the locked Ticket 06 capability-restriction rules
 * (`member/domain/capability-restriction.ts`) evaluate them. KYC/Risk owns the
 * eligibility decision and reads that fact through this port instead of
 * re-deriving it from another context's storage or re-implementing the rules.
 */
export interface CapabilityRestrictionEvaluation {
  readonly blocked: boolean;
  readonly selfExclusion: boolean;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CapabilityRestrictionPort {
  evaluate(
    memberId: string,
    capability: string,
    at: Date,
  ): Promise<CapabilityRestrictionEvaluation>;
}

export const CAPABILITY_RESTRICTION_PORT = Symbol("CAPABILITY_RESTRICTION_PORT");

/**
 * Cross-context seam for the Member onboarding facts KYC/Risk capability
 * readiness depends on.
 *
 * Ticket 06 derives readiness from explicit requirements — required Terms
 * acceptance and mandatory profile fields among them. Those facts are owned by
 * the Member context (Issue 64: `TermsService` / `ProfileService`); KYC/Risk
 * reads them through this port rather than re-deriving them from another
 * context's storage or re-implementing the acceptance/completeness rules.
 */
export interface MemberReadinessRequirements {
  readonly termsSatisfied: boolean;
  readonly profileComplete: boolean;
  readonly missingProfileFields: readonly string[];
}

export interface MemberReadinessFactsPort {
  getRequirements(
    memberId: string,
    at: Date,
  ): Promise<MemberReadinessRequirements>;
}

export const MEMBER_READINESS_FACTS_PORT = Symbol("MEMBER_READINESS_FACTS_PORT");

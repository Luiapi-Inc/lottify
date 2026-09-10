/**
 * Cross-context seam for the Member facts Promotion eligibility depends on.
 *
 * Promotion owns its eligibility criteria; the resolved Member status is
 * identity-access's fact and is read through this port rather than being
 * re-derived from another context's storage.
 */
export interface PromotionMemberFacts {
  readonly memberId: string;
  readonly status: string;
}

export interface PromotionMemberFactsPort {
  getMemberFacts(memberId: string): Promise<PromotionMemberFacts>;
}

export const PROMOTION_MEMBER_FACTS_PORT = Symbol("PROMOTION_MEMBER_FACTS_PORT");

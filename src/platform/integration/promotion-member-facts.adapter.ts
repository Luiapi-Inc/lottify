import { Injectable } from "@nestjs/common";
import { MemberAuthService } from "../../contexts/identity-access/application/member-auth.service";
import type {
  PromotionMemberFacts,
  PromotionMemberFactsPort,
} from "../../contexts/promotion/application/promotion-member-facts.port";

/**
 * Cross-context seam that resolves the Member facts Promotion eligibility
 * depends on. The Member record is identity-access's fact; Promotion reads it
 * through its own port instead of re-deriving it from another context's storage.
 */
@Injectable()
export class PromotionMemberFactsAdapter implements PromotionMemberFactsPort {
  constructor(private readonly members: MemberAuthService) {}

  async getMemberFacts(memberId: string): Promise<PromotionMemberFacts> {
    const member = await this.members.me(memberId);
    return { memberId: member.memberId, status: member.status };
  }
}

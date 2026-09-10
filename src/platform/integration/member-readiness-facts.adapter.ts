import { Inject, Injectable } from "@nestjs/common";
import { TermsService } from "../../contexts/member/application/terms.service";
import { ProfileService } from "../../contexts/member/application/profile.service";
import type {
  MemberReadinessFactsPort,
  MemberReadinessRequirements,
} from "../../contexts/kyc-risk/application/member-readiness-facts.port";

/**
 * Cross-context seam that resolves the Member onboarding facts KYC/Risk
 * capability readiness depends on. Terms acceptance and mandatory profile
 * completeness are Member-context facts (Issue 64); KYC/Risk reads them through
 * this port instead of re-deriving them from another context's storage.
 */
@Injectable()
export class MemberReadinessFactsAdapter implements MemberReadinessFactsPort {
  constructor(
    @Inject(TermsService) private readonly terms: TermsService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  async getRequirements(
    memberId: string,
    at: Date,
  ): Promise<MemberReadinessRequirements> {
    const [terms, profile] = await Promise.all([
      this.terms.getMemberTerms(memberId, at),
      this.profiles.getProfile(memberId),
    ]);

    return {
      termsSatisfied: terms.satisfied,
      profileComplete: profile.profileComplete,
      missingProfileFields: profile.missingMandatoryFields,
    };
  }
}

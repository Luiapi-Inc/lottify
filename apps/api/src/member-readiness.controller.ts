import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import {
  CAPABILITY_READINESS_POLICY_VERSION,
  EligibilityService,
  READINESS_CAPABILITIES,
  type MemberReadinessView,
  type ReadinessCapabilityDecision,
} from "../../../src/contexts/kyc-risk/application/eligibility.service";
import { ELIGIBILITY_DECISION_OUTCOMES } from "../../../src/contexts/kyc-risk/domain/eligibility-decision";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";
import { toOnboardingHttp } from "./onboarding-error.mapper";

class KycReadinessBody {
  @ApiProperty({ type: Boolean, description: "Whether any evaluated capability requires KYC" })
  required!: boolean;

  @ApiProperty({
    enum: ["VERIFIED", "REJECTED", "REVIEW_REQUIRED", "MORE_INFO_REQUIRED"],
    nullable: true,
    description: "Canonical, provider-independent KYC outcome, or null when no KYC state exists",
  })
  status!: string | null;

  @ApiProperty({ type: Boolean, description: "KYC is VERIFIED and the KYC verification is fresh" })
  verified!: boolean;

  @ApiProperty({ type: Boolean, description: "KYC was verified but the verification has expired" })
  expired!: boolean;
}

class ReadinessRequirementsBody {
  @ApiProperty({ type: Boolean, description: "Every currently required Terms version is accepted" })
  termsSatisfied!: boolean;

  @ApiProperty({ type: Boolean, description: "Every mandatory profile field has a stored value" })
  profileComplete!: boolean;

  @ApiProperty({ enum: ["fullName", "dateOfBirth", "province"], isArray: true })
  missingProfileFields!: string[];

  @ApiProperty({ type: KycReadinessBody })
  kyc!: KycReadinessBody;

  @ApiProperty({
    type: [String],
    description: "Coded requirements that are not yet satisfied (renders onboarding/blocked state)",
  })
  outstandingRequirements!: string[];
}

class CapabilityReadinessBody {
  @ApiProperty({ enum: [...READINESS_CAPABILITIES] })
  capability!: string;

  @ApiProperty({ enum: [...ELIGIBILITY_DECISION_OUTCOMES] })
  outcome!: string;

  @ApiProperty({ type: [String], description: "Machine-readable reasons for a non-allow decision" })
  reasonCodes!: string[];

  @ApiProperty({ type: String, format: "date-time" })
  evaluatedAt!: Date;

  @ApiProperty({ type: String, format: "date-time", description: "Bounded decision freshness window" })
  validUntil!: Date;
}

class MemberReadinessBody {
  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  asOf!: Date;

  @ApiProperty({ type: String, description: "Effective readiness policy version" })
  policyVersion!: string;

  @ApiProperty({ type: [CapabilityReadinessBody] })
  capabilities!: CapabilityReadinessBody[];

  @ApiProperty({ type: ReadinessRequirementsBody })
  requirements!: ReadinessRequirementsBody;
}

@ApiTags("Member Readiness")
@Controller("api/v1/member/readiness")
@UseGuards(MemberAuthGuard)
export class MemberReadinessController {
  constructor(@Inject(EligibilityService) private readonly eligibility: EligibilityService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Read the Member's capability readiness and KYC state",
    description:
      "Reports, per capability, whether the Member is currently allowed, denied, or requires review, with coded reasons and the outstanding explicit requirements (Terms, profile, KYC). Decisions follow the locked deny-first layer precedence and are point-in-time; an ALLOW is never fabricated and evidence contents are never exposed.",
  })
  @ApiOkResponse({ type: MemberReadinessBody })
  async getReadiness(
    @Req() request: MemberAuthenticatedRequest,
  ): Promise<MemberReadinessBody> {
    try {
      const view = await this.eligibility.getReadiness(
        request.memberAuth!.memberId,
        new Date(),
      );
      return toReadinessBody(view);
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }
}

export function toReadinessBody(view: MemberReadinessView): MemberReadinessBody {
  return {
    memberId: view.memberId,
    asOf: view.asOf,
    policyVersion: CAPABILITY_READINESS_POLICY_VERSION,
    capabilities: view.capabilities.map(toCapabilityBody),
    requirements: {
      termsSatisfied: view.requirements.termsSatisfied,
      profileComplete: view.requirements.profileComplete,
      missingProfileFields: [...view.requirements.missingProfileFields],
      kyc: {
        required: view.requirements.kyc.required,
        status: view.requirements.kyc.status,
        verified: view.requirements.kyc.verified,
        expired: view.requirements.kyc.expired,
      },
      outstandingRequirements: [...view.requirements.outstandingRequirements],
    },
  };
}

function toCapabilityBody(decision: ReadinessCapabilityDecision): CapabilityReadinessBody {
  return {
    capability: decision.capability,
    outcome: decision.outcome,
    reasonCodes: [...decision.reasonCodes],
    evaluatedAt: decision.evaluatedAt,
    validUntil: decision.validUntil,
  };
}

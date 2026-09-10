import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service";
import type { MemberCapability } from "../../contexts/member/domain/capability-restriction";
import {
  getEffectiveCapabilityRestrictions,
  type MemberCapabilityRestriction,
} from "../../contexts/member/domain/capability-restriction";
import { isSelfExclusionRestriction } from "../../contexts/member/domain/self-exclusion";
import type {
  CapabilityRestrictionEvaluation,
  CapabilityRestrictionPort,
} from "../../contexts/kyc-risk/application/capability-restriction.port";

/**
 * Cross-context seam that resolves the Member capability restrictions KYC/Risk
 * eligibility depends on. The locked Ticket 06 capability-restriction rules
 * (`member/domain/capability-restriction.ts`) evaluate persisted rows; the
 * adapter reads that Member-owned persistence and returns the effective
 * evaluation without KYC/Risk re-implementing the rules.
 */
@Injectable()
export class CapabilityRestrictionAdapter implements CapabilityRestrictionPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async evaluate(
    memberId: string,
    capability: string,
    at: Date,
  ): Promise<CapabilityRestrictionEvaluation> {
    const rows = await this.prisma.capabilityRestriction.findMany({
      where: { memberId },
    });

    const restrictions: MemberCapabilityRestriction[] = rows.map((row) => ({
      type: row.type as MemberCapabilityRestriction["type"],
      source: row.source,
      reason: row.reason,
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
      actorOrPolicyRef: row.actorOrPolicyRef,
    }));

    const effective = getEffectiveCapabilityRestrictions(
      capability as MemberCapability,
      restrictions,
      at,
    );

    if (effective.length === 0) {
      return { blocked: false, selfExclusion: false, reasonCodes: [], evidenceRefs: [] };
    }

    const selfExclusion = effective.some(isSelfExclusionRestriction);
    return {
      blocked: true,
      selfExclusion,
      reasonCodes: selfExclusion ? ["SELF_EXCLUSION"] : ["CAPABILITY_BLOCKED"],
      evidenceRefs: effective.map((restriction) => restriction.actorOrPolicyRef),
    };
  }
}

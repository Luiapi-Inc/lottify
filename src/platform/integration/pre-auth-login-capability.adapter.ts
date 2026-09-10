import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service";
import {
  getEffectiveCapabilityRestrictions,
  type MemberCapabilityRestriction,
} from "../../contexts/member/domain/capability-restriction";
import { SELF_EXCLUSION_RESTRICTION_SOURCE } from "../../contexts/member/domain/self-exclusion";
import type {
  MemberLoginCapabilityDecision,
  MemberLoginCapabilityPort,
} from "../../contexts/identity-access/application/pre-auth-login-capability.port";

/**
 * The pre-auth login gate: only an effective `LOGIN_BLOCKED` restriction denies
 * login. `getEffectiveCapabilityRestrictions("LOGIN", ...)` is the locked
 * Ticket 06 capability → restriction mapping, so a `BET_BLOCKED` (including a
 * responsible-gaming self-exclusion, which the Member context models as
 * `BET_BLOCKED`) never gates login.
 */
export function evaluateLoginCapability(
  restrictions: readonly MemberCapabilityRestriction[],
  at: Date,
): MemberLoginCapabilityDecision {
  const effective = getEffectiveCapabilityRestrictions(
    "LOGIN",
    restrictions,
    at,
  );
  if (effective.length === 0) {
    return { allowed: true, reasonCode: null, evidenceRefs: [] };
  }

  const selfExclusion = effective.some(
    (restriction) => restriction.source === SELF_EXCLUSION_RESTRICTION_SOURCE,
  );
  return {
    allowed: false,
    reasonCode: selfExclusion ? "SELF_EXCLUSION" : "CAPABILITY_BLOCKED",
    evidenceRefs: effective.map((restriction) => restriction.actorOrPolicyRef),
  };
}

/**
 * Cross-context seam that resolves the Member capability restriction gating the
 * pre-auth login boundary. The Member context owns the persisted restrictions
 * and the Ticket 06 domain rules; this adapter reads that Member-owned
 * persistence and applies the locked rules, so Identity & Access never reaches
 * into another context's storage or re-derives the semantics.
 */
@Injectable()
export class PreAuthLoginCapabilityAdapter
  implements MemberLoginCapabilityPort
{
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async evaluateLoginCapability(
    memberId: string,
    at: Date,
  ): Promise<MemberLoginCapabilityDecision> {
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

    return evaluateLoginCapability(restrictions, at);
  }
}

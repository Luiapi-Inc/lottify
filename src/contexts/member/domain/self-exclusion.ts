import type { MemberCapabilityRestriction } from "./capability-restriction";

export const SELF_EXCLUSION_RESTRICTION_SOURCE = "self-exclusion" as const;

export interface CreateSelfExclusionBetRestrictionInput {
  activatedAt: Date;
  effectiveUntil: Date | null;
  reason: string;
  actorOrPolicyRef: string;
}

export type NormalAdminRestrictionRemovalDisposition =
  | "DENY_SELF_EXCLUSION"
  | "DEFER_TO_GOVERNING_POLICY";

export function createSelfExclusionBetRestriction(
  input: CreateSelfExclusionBetRestrictionInput,
): MemberCapabilityRestriction {
  if (input.reason.trim().length === 0) {
    throw new Error("Self-exclusion restriction requires a reason");
  }

  if (input.actorOrPolicyRef.trim().length === 0) {
    throw new Error("Self-exclusion restriction requires a policy or evidence reference");
  }

  if (
    input.effectiveUntil !== null &&
    input.effectiveUntil.getTime() <= input.activatedAt.getTime()
  ) {
    throw new Error("Self-exclusion expiry must be after activation");
  }

  return {
    type: "BET_BLOCKED",
    source: SELF_EXCLUSION_RESTRICTION_SOURCE,
    reason: input.reason,
    effectiveFrom: new Date(input.activatedAt),
    effectiveUntil:
      input.effectiveUntil === null ? null : new Date(input.effectiveUntil),
    actorOrPolicyRef: input.actorOrPolicyRef,
  };
}

export function isSelfExclusionRestriction(
  restriction: MemberCapabilityRestriction,
): boolean {
  return (
    restriction.type === "BET_BLOCKED" &&
    restriction.source === SELF_EXCLUSION_RESTRICTION_SOURCE
  );
}

export function normalAdminRemovalDisposition(
  restriction: MemberCapabilityRestriction,
): NormalAdminRestrictionRemovalDisposition {
  return isSelfExclusionRestriction(restriction)
    ? "DENY_SELF_EXCLUSION"
    : "DEFER_TO_GOVERNING_POLICY";
}

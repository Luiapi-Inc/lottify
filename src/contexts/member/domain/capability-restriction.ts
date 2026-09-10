export const MEMBER_CAPABILITIES = [
  "BET",
  "WITHDRAWAL",
  "DEPOSIT",
  "LOGIN",
  "PROMOTION",
] as const;

export type MemberCapability = (typeof MEMBER_CAPABILITIES)[number];

export const MEMBER_CAPABILITY_RESTRICTION_TYPES = [
  "BET_BLOCKED",
  "WITHDRAWAL_BLOCKED",
  "DEPOSIT_BLOCKED",
  "LOGIN_BLOCKED",
  "PROMOTION_BLOCKED",
] as const;

export type MemberCapabilityRestrictionType =
  (typeof MEMBER_CAPABILITY_RESTRICTION_TYPES)[number];

export interface MemberCapabilityRestriction {
  type: MemberCapabilityRestrictionType;
  source: string;
  reason: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  actorOrPolicyRef: string;
}

const RESTRICTION_TYPE_BY_CAPABILITY: Record<
  MemberCapability,
  MemberCapabilityRestrictionType
> = {
  BET: "BET_BLOCKED",
  WITHDRAWAL: "WITHDRAWAL_BLOCKED",
  DEPOSIT: "DEPOSIT_BLOCKED",
  LOGIN: "LOGIN_BLOCKED",
  PROMOTION: "PROMOTION_BLOCKED",
};

/** The locked capability -> restriction-type mapping (Ticket 06). */
export function restrictionTypeForCapability(
  capability: MemberCapability,
): MemberCapabilityRestrictionType {
  return RESTRICTION_TYPE_BY_CAPABILITY[capability];
}

export function isCapabilityRestrictionEffective(
  restriction: MemberCapabilityRestriction,
  at: Date,
): boolean {
  return (
    restriction.effectiveFrom.getTime() <= at.getTime() &&
    (restriction.effectiveUntil === null ||
      at.getTime() < restriction.effectiveUntil.getTime())
  );
}

export function getEffectiveCapabilityRestrictions(
  capability: MemberCapability,
  restrictions: readonly MemberCapabilityRestriction[],
  at: Date,
): MemberCapabilityRestriction[] {
  const expectedType = RESTRICTION_TYPE_BY_CAPABILITY[capability];
  return restrictions.filter(
    (restriction) =>
      restriction.type === expectedType &&
      isCapabilityRestrictionEffective(restriction, at),
  );
}

export function isCapabilityBlocked(
  capability: MemberCapability,
  restrictions: readonly MemberCapabilityRestriction[],
  at: Date,
): boolean {
  return getEffectiveCapabilityRestrictions(capability, restrictions, at).length > 0;
}

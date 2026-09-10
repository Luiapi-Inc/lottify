/**
 * Cross-context seam for the Member capability restriction that gates the
 * pre-auth Member login boundary.
 *
 * Ticket 01 assigns "effective Member capability restrictions" to the Member
 * context, and the locked Ticket 06 capability-restriction rules
 * (`member/domain/capability-restriction.ts`) evaluate them. Identity & Access
 * owns login and session establishment, so it consumes the evaluated fact
 * through this port rather than reading another context's storage or
 * re-implementing the rule.
 *
 * The decision is point-in-time: it is evaluated against the restriction's
 * effective period at the login instant, never cached.
 */
export const MEMBER_LOGIN_CAPABILITY_REASON_CODES = [
  "CAPABILITY_BLOCKED",
  "SELF_EXCLUSION",
] as const;

export type MemberLoginCapabilityReasonCode =
  (typeof MEMBER_LOGIN_CAPABILITY_REASON_CODES)[number];

export interface MemberLoginCapabilityDecision {
  readonly allowed: boolean;
  /** Stable coded reason when denied; never rendered to the client verbatim. */
  readonly reasonCode: MemberLoginCapabilityReasonCode | null;
  /** Opaque actor/policy references for the restrictions that denied login. */
  readonly evidenceRefs: readonly string[];
}

export interface MemberLoginCapabilityPort {
  evaluateLoginCapability(
    memberId: string,
    at: Date,
  ): Promise<MemberLoginCapabilityDecision>;
}

export const MEMBER_LOGIN_CAPABILITY_PORT = Symbol(
  "MEMBER_LOGIN_CAPABILITY_PORT",
);

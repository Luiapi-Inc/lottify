import type {
  PromotionCampaignTerms,
  PromotionCampaignVersionRecord,
  PromotionStackingMode,
} from "./campaign-terms";
import { isCampaignVersionEffective } from "./campaign-terms";
import { PromotionRuleError } from "./rule-error";

/**
 * Member-specific Promotion Entitlement semantics (Ticket 07).
 *
 * When a Member earns or is granted a Promotion, Promotion creates an
 * Entitlement snapshot containing the exact Campaign version, the granted
 * reward, the turnover target, the eligible scope, the contribution rules, the
 * expiry and winnings-destination rules, and the stacking decision. Later
 * Campaign changes never rewrite an existing Entitlement.
 */

export const PROMOTION_ENTITLEMENT_STATES = [
  "ACTIVE",
  "RELEASE_PENDING",
  "COMPLETED",
  "EXPIRED",
  "REVOKED",
] as const;

export type PromotionEntitlementState = (typeof PROMOTION_ENTITLEMENT_STATES)[number];

export interface PromotionEntitlementSnapshot {
  readonly memberId: string;
  readonly campaignId: string;
  readonly campaignCode: string;
  readonly campaignVersionId: string;
  readonly campaignVersion: number;
  readonly terms: PromotionCampaignTerms;
  readonly termsDigest: string;
  readonly rewardMinor: bigint;
  readonly turnoverTargetMinor: bigint;
  readonly expiresAt: Date;
  readonly grantedAt: Date;
  readonly stackingDecision: PromotionStackingDecision;
  readonly policyVersion: string;
}

export interface PromotionStackingCandidateFact {
  readonly campaignVersionId: string;
  readonly campaignCode: string;
  readonly campaignVersion: number;
  readonly mode: PromotionStackingMode;
  readonly priority: number;
  readonly compatibilityGroup: string | null;
  readonly expiresAt: Date | null;
}

export interface PromotionStackingSuppression {
  readonly campaignVersionId: string;
  readonly campaignCode: string;
  readonly reason:
    | "SUPPRESSED_BY_EXCLUSIVE"
    | "STACKABLE_REQUIRES_COMPATIBILITY_GROUP"
    | "STACKABLE_GROUP_CONFLICT";
  readonly holderCampaignVersionId: string | null;
}

export interface PromotionStackingDecision {
  readonly granted: readonly PromotionStackingCandidateFact[];
  readonly suppressed: readonly PromotionStackingSuppression[];
}

/**
 * Deterministic conflict resolution before grant. Ordering is explicit and
 * total: explicit priority, then nearest expiry, then Campaign code, then
 * Campaign version, then id — query or database order never decides the
 * outcome. Exclusive Campaigns suppress every lower-ranked conflicting
 * Campaign; stackable Campaigns combine only within an explicit compatibility
 * group.
 */
export function resolvePromotionStacking(
  candidates: readonly PromotionStackingCandidateFact[],
): PromotionStackingDecision {
  const ordered = [...candidates].sort(compareStackingCandidates);
  const granted: PromotionStackingCandidateFact[] = [];
  const suppressed: PromotionStackingSuppression[] = [];
  const groupHolders = new Map<string, string>();
  let exclusiveHolder: PromotionStackingCandidateFact | null = null;
  let ungroupedStackableHolder: PromotionStackingCandidateFact | null = null;

  for (const candidate of ordered) {
    if (exclusiveHolder) {
      suppressed.push({
        campaignVersionId: candidate.campaignVersionId,
        campaignCode: candidate.campaignCode,
        reason: "SUPPRESSED_BY_EXCLUSIVE",
        holderCampaignVersionId: exclusiveHolder.campaignVersionId,
      });
      continue;
    }

    if (candidate.mode === "EXCLUSIVE") {
      exclusiveHolder = candidate;
      granted.push(candidate);
      continue;
    }

    if (candidate.compatibilityGroup === null) {
      if (ungroupedStackableHolder) {
        suppressed.push({
          campaignVersionId: candidate.campaignVersionId,
          campaignCode: candidate.campaignCode,
          reason: "STACKABLE_REQUIRES_COMPATIBILITY_GROUP",
          holderCampaignVersionId: ungroupedStackableHolder.campaignVersionId,
        });
        continue;
      }
      ungroupedStackableHolder = candidate;
      granted.push(candidate);
      continue;
    }

    const holder = groupHolders.get(candidate.compatibilityGroup);
    if (holder) {
      suppressed.push({
        campaignVersionId: candidate.campaignVersionId,
        campaignCode: candidate.campaignCode,
        reason: "STACKABLE_GROUP_CONFLICT",
        holderCampaignVersionId: holder,
      });
      continue;
    }
    groupHolders.set(candidate.compatibilityGroup, candidate.campaignVersionId);
    granted.push(candidate);
  }

  return { granted, suppressed };
}

function compareStackingCandidates(
  left: PromotionStackingCandidateFact,
  right: PromotionStackingCandidateFact,
): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const leftExpiry = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightExpiry = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
  if (left.campaignCode !== right.campaignCode) {
    return left.campaignCode < right.campaignCode ? -1 : 1;
  }
  if (left.campaignVersion !== right.campaignVersion) {
    return right.campaignVersion - left.campaignVersion;
  }
  return left.campaignVersionId < right.campaignVersionId ? -1 : 1;
}

export interface PromotionMemberFacts {
  readonly memberId: string;
  readonly status: string;
}

export type PromotionIneligibilityReason =
  | "CAMPAIGN_NOT_EFFECTIVE"
  | "MEMBER_STATUS_MISMATCH"
  | "MEMBER_EXCLUDED"
  | "CAMPAIGN_VERSION_ALREADY_GRANTED";

export interface PromotionEligibilityDecision {
  readonly eligible: boolean;
  readonly reasons: readonly PromotionIneligibilityReason[];
}

export interface PromotionEligibilityInput {
  readonly version: Pick<
    PromotionCampaignVersionRecord,
    "id" | "state" | "effectiveFrom" | "effectiveUntil"
  >;
  readonly terms: PromotionCampaignTerms;
  readonly facts: PromotionMemberFacts;
  readonly heldCampaignVersionIds: readonly string[];
  readonly at: Date;
}

/** Campaign-owned eligibility evaluation against the resolved Member facts. */
export function decidePromotionEligibility(
  input: PromotionEligibilityInput,
): PromotionEligibilityDecision {
  const reasons: PromotionIneligibilityReason[] = [];

  if (!isCampaignVersionEffective(input.version, input.at)) reasons.push("CAMPAIGN_NOT_EFFECTIVE");

  const requiredStatus = input.terms.eligibility.requiredMemberStatus;
  if (requiredStatus !== null && requiredStatus !== input.facts.status) {
    reasons.push("MEMBER_STATUS_MISMATCH");
  }
  if (input.terms.eligibility.excludedMemberIds.includes(input.facts.memberId)) {
    reasons.push("MEMBER_EXCLUDED");
  }
  if (input.heldCampaignVersionIds.includes(input.version.id)) {
    reasons.push("CAMPAIGN_VERSION_ALREADY_GRANTED");
  }

  return { eligible: reasons.length === 0, reasons };
}

const ENTITLEMENT_TRANSITIONS: Record<
  PromotionEntitlementState,
  readonly PromotionEntitlementState[]
> = {
  ACTIVE: ["RELEASE_PENDING", "EXPIRED", "REVOKED"],
  RELEASE_PENDING: ["COMPLETED", "EXPIRED"],
  COMPLETED: [],
  EXPIRED: [],
  REVOKED: [],
};

export function canTransitionEntitlement(
  from: PromotionEntitlementState,
  to: PromotionEntitlementState,
): boolean {
  return ENTITLEMENT_TRANSITIONS[from].includes(to);
}

export function assertEntitlementTransition(
  from: PromotionEntitlementState,
  to: PromotionEntitlementState,
): void {
  if (!canTransitionEntitlement(from, to)) {
    throw new PromotionRuleError(
      "STATE_CONFLICT",
      `Promotion Entitlement cannot transition from ${from} to ${to}`,
      { from, to },
    );
  }
}

/** Client-visible actions derived from the locked Entitlement state machine. */
export function entitlementAllowedActions(state: PromotionEntitlementState): string[] {
  return [...ENTITLEMENT_TRANSITIONS[state]];
}

export function isEntitlementTerminal(state: PromotionEntitlementState): boolean {
  return ENTITLEMENT_TRANSITIONS[state].length === 0;
}

/** Expiry instant derived from the snapshotted grant time and expiry window. */
export function entitlementExpiryFor(terms: PromotionCampaignTerms, grantedAt: Date): Date {
  return new Date(grantedAt.getTime() + terms.expiryDaysAfterGrant * 24 * 60 * 60 * 1000);
}

/**
 * Value still traceable to the Entitlement: granted reward minus what already
 * left it through a conversion or an expiry removal.
 */
export function remainingEntitlementBonusMinor(input: {
  rewardMinor: bigint;
  releasedMinor: bigint;
  expiredMinor: bigint;
}): bigint {
  const remaining = input.rewardMinor - input.releasedMinor - input.expiredMinor;
  return remaining > 0n ? remaining : 0n;
}

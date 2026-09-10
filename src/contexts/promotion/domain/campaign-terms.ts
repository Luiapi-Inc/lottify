import { createHash } from "node:crypto";
import { PromotionRuleError } from "./rule-error";

/**
 * Promotion Campaign version semantics (Ticket 07).
 *
 * A Campaign is the versioned configuration root that defines eligibility,
 * reward type/value, eligible Product/Bet Type scope, turnover rules,
 * stacking/exclusivity, effective period, expiry, anti-abuse and
 * reward-funding behaviour. A published version is immutable: later changes are
 * new versions, never edits of the published terms.
 */

export const PROMOTION_CAMPAIGN_STATES = [
  "DRAFT",
  "VALIDATED",
  "PUBLISHED",
  "RETIRED",
] as const;

export type PromotionCampaignState = (typeof PROMOTION_CAMPAIGN_STATES)[number];

export const PROMOTION_WINNINGS_DESTINATIONS = ["BONUS", "CASH", "PROPORTIONAL"] as const;
export type PromotionWinningsDestination = (typeof PROMOTION_WINNINGS_DESTINATIONS)[number];

export const PROMOTION_STACKING_MODES = ["EXCLUSIVE", "STACKABLE"] as const;
export type PromotionStackingMode = (typeof PROMOTION_STACKING_MODES)[number];

export const PROMOTION_REWARD_TYPES = ["BONUS_CREDIT"] as const;
export type PromotionRewardType = (typeof PROMOTION_REWARD_TYPES)[number];

export const PROMOTION_TERMS_SCHEMA_VERSION = "promotion-terms-v1" as const;

export interface PromotionEligibilityCriteria {
  /** Required stored Member status, or null when the Campaign is open to any status. */
  readonly requiredMemberStatus: string | null;
  /** Explicit Member exclusions (anti-abuse / operational exclusions). */
  readonly excludedMemberIds: readonly string[];
}

export interface PromotionTurnoverScope {
  /** Eligible Product ids; empty means every Product. */
  readonly eligibleProductIds: readonly string[];
  /** Eligible Bet Type codes; empty means every Bet Type. */
  readonly eligibleBetTypeCodes: readonly string[];
  /** Contribution percentage of an eligible accepted stake, in basis points (0..10000). */
  readonly contributionBps: number;
  /** Minimum accepted payout/odds policy reference, or null when no odds rule applies. */
  readonly minPayoutRef: string | null;
}

export interface PromotionStackingTerms {
  readonly mode: PromotionStackingMode;
  /** Explicit priority; higher wins before any expiry/tie-break ordering. */
  readonly priority: number;
  /** Explicit compatibility group; stackable Campaigns combine only within one group. */
  readonly compatibilityGroup: string | null;
}

export interface PromotionCampaignTerms {
  readonly schemaVersion: typeof PROMOTION_TERMS_SCHEMA_VERSION;
  readonly rewardType: PromotionRewardType;
  /** Reward granted into the Member BONUS bucket, integer minor units. */
  readonly rewardAmountMinor: string;
  readonly currency: "THB";
  readonly eligibility: PromotionEligibilityCriteria;
  readonly scope: PromotionTurnoverScope;
  /** Turnover target = reward * turnoverMultiplierBps / 10000. */
  readonly turnoverMultiplierBps: number;
  /** Promotion funding/control source the reward is posted from. */
  readonly fundingSource: string;
  readonly winningsDestination: PromotionWinningsDestination;
  /** Required explicit proportional rule when winningsDestination is PROPORTIONAL. */
  readonly proportionalWinningsBps: number | null;
  readonly expiryDaysAfterGrant: number;
  readonly stacking: PromotionStackingTerms;
  readonly antiAbusePolicyRef: string;
  readonly policyVersion: string;
}

export interface PromotionCampaignVersionRecord {
  readonly id: string;
  readonly campaignId: string;
  readonly campaignCode: string;
  readonly version: number;
  readonly revision: number;
  readonly state: PromotionCampaignState;
  readonly terms: PromotionCampaignTerms;
  readonly termsDigest: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly publishedAt: Date | null;
}

/** Draft → Validate → Approval → Publish → Monitor/Retire. */
const CAMPAIGN_TRANSITIONS: Record<PromotionCampaignState, readonly PromotionCampaignState[]> = {
  DRAFT: ["VALIDATED"],
  VALIDATED: ["DRAFT", "PUBLISHED"],
  PUBLISHED: ["RETIRED"],
  RETIRED: [],
};

export function canTransitionCampaignVersion(
  from: PromotionCampaignState,
  to: PromotionCampaignState,
): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function assertCampaignVersionTransition(
  from: PromotionCampaignState,
  to: PromotionCampaignState,
): void {
  if (!canTransitionCampaignVersion(from, to)) {
    throw new PromotionRuleError(
      "STATE_CONFLICT",
      `Promotion Campaign version cannot transition from ${from} to ${to}`,
      { from, to },
    );
  }
}

/** A published or retired version is immutable history. */
export function assertCampaignVersionEditable(state: PromotionCampaignState): void {
  if (state === "PUBLISHED" || state === "RETIRED") {
    throw new PromotionRuleError(
      "STATE_CONFLICT",
      "A published Promotion Campaign version is immutable; create a new version instead",
      { state },
    );
  }
}

export interface PromotionTermsViolation {
  readonly field: string;
  readonly message: string;
}

/**
 * Semantic validation of the accepted Campaign terms. Structural parsing is the
 * API boundary's job; this proves the terms are internally consistent and
 * financially explicable before a version can be validated or published.
 */
export function validatePromotionCampaignTerms(
  terms: PromotionCampaignTerms,
): PromotionTermsViolation[] {
  const violations: PromotionTermsViolation[] = [];
  const fail = (field: string, message: string) => violations.push({ field, message });

  if (terms.schemaVersion !== PROMOTION_TERMS_SCHEMA_VERSION) {
    fail("schemaVersion", `schemaVersion must be ${PROMOTION_TERMS_SCHEMA_VERSION}`);
  }
  if (terms.currency !== "THB") fail("currency", "currency must be THB");
  if (terms.rewardType !== "BONUS_CREDIT") fail("rewardType", "rewardType must be BONUS_CREDIT");

  const reward = parseMinorUnits(terms.rewardAmountMinor);
  if (reward === null || reward <= 0n) {
    fail("rewardAmountMinor", "rewardAmountMinor must be a positive integer minor-unit string");
  }

  if (!Number.isInteger(terms.turnoverMultiplierBps) || terms.turnoverMultiplierBps < 0) {
    fail("turnoverMultiplierBps", "turnoverMultiplierBps must be a non-negative integer");
  }
  const contributionBps = terms.scope?.contributionBps;
  if (!Number.isInteger(contributionBps) || contributionBps < 0 || contributionBps > 10_000) {
    fail("scope.contributionBps", "scope.contributionBps must be an integer between 0 and 10000");
  }
  if (!terms.expiryDaysAfterGrant || !Number.isInteger(terms.expiryDaysAfterGrant) || terms.expiryDaysAfterGrant < 1) {
    fail("expiryDaysAfterGrant", "expiryDaysAfterGrant must be a positive integer number of days");
  }
  if (typeof terms.fundingSource !== "string" || terms.fundingSource.trim() === "") {
    fail("fundingSource", "fundingSource must name the Promotion funding/control source");
  }
  if (typeof terms.antiAbusePolicyRef !== "string" || terms.antiAbusePolicyRef.trim() === "") {
    fail("antiAbusePolicyRef", "antiAbusePolicyRef is required");
  }
  if (typeof terms.policyVersion !== "string" || terms.policyVersion.trim() === "") {
    fail("policyVersion", "policyVersion is required");
  }

  if (!PROMOTION_WINNINGS_DESTINATIONS.includes(terms.winningsDestination)) {
    fail("winningsDestination", "winningsDestination must be BONUS, CASH or PROPORTIONAL");
  }
  if (terms.winningsDestination === "PROPORTIONAL") {
    const bps = terms.proportionalWinningsBps;
    if (bps === null || bps === undefined || !Number.isInteger(bps) || bps < 1 || bps > 10_000) {
      fail(
        "proportionalWinningsBps",
        "proportionalWinningsBps is required (1..10000) when winningsDestination is PROPORTIONAL",
      );
    }
  } else if (terms.proportionalWinningsBps !== null && terms.proportionalWinningsBps !== undefined) {
    fail(
      "proportionalWinningsBps",
      "proportionalWinningsBps is only meaningful when winningsDestination is PROPORTIONAL",
    );
  }

  if (!terms.scope || !Array.isArray(terms.scope.eligibleProductIds) || !Array.isArray(terms.scope.eligibleBetTypeCodes)) {
    fail("scope", "scope must list eligibleProductIds and eligibleBetTypeCodes");
  }
  if (!terms.eligibility || !Array.isArray(terms.eligibility.excludedMemberIds)) {
    fail("eligibility", "eligibility.excludedMemberIds must be an array");
  }
  if (!terms.stacking || !PROMOTION_STACKING_MODES.includes(terms.stacking.mode)) {
    fail("stacking.mode", "stacking.mode must be EXCLUSIVE or STACKABLE");
  } else {
    if (!Number.isInteger(terms.stacking.priority)) {
      fail("stacking.priority", "stacking.priority must be an integer");
    }
    if (terms.stacking.mode === "STACKABLE" && terms.stacking.compatibilityGroup !== null) {
      if (typeof terms.stacking.compatibilityGroup !== "string" || terms.stacking.compatibilityGroup.trim() === "") {
        fail(
          "stacking.compatibilityGroup",
          "stacking.compatibilityGroup must be a non-empty string or null",
        );
      }
    }
  }

  return violations;
}

function parseMinorUnits(value: string): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

/** Turnover target derived only from the snapshotted reward and multiplier. */
export function promotionTurnoverTargetMinor(terms: PromotionCampaignTerms): bigint {
  const reward = parseMinorUnits(terms.rewardAmountMinor);
  if (reward === null) {
    throw new PromotionRuleError("VALIDATION_ERROR", "rewardAmountMinor is not integer minor units", {
      rewardAmountMinor: terms.rewardAmountMinor,
    });
  }
  return (reward * BigInt(terms.turnoverMultiplierBps)) / 10_000n;
}

/**
 * Canonical terms digest. The stored canonical serialization keeps the digest
 * verifiable after a JSONB round-trip.
 */
export function promotionTermsDigest(terms: PromotionCampaignTerms): string {
  return createHash("sha256").update(canonicalJson(terms), "utf8").digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item as Record<string, unknown>)
          .sort()
          .map((key) => [key, (item as Record<string, unknown>)[key]]),
      );
    }
    return item;
  });
}

/** A Campaign version is claimable while it is published and inside its window. */
export function isCampaignVersionEffective(
  version: Pick<PromotionCampaignVersionRecord, "state" | "effectiveFrom" | "effectiveUntil">,
  at: Date,
): boolean {
  if (version.state !== "PUBLISHED") return false;
  if (version.effectiveFrom.getTime() > at.getTime()) return false;
  if (version.effectiveUntil !== null && at.getTime() >= version.effectiveUntil.getTime()) return false;
  return true;
}

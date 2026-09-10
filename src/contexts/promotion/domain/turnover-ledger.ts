import type { PromotionCampaignTerms } from "./campaign-terms";
import { PromotionRuleError } from "./rule-error";

/**
 * Turnover contribution semantics (Ticket 07).
 *
 * Turnover measures eligible wagering contribution toward a release. A confirmed
 * eligible Bet creates a PROVISIONAL contribution; cancellation/refund removes it;
 * a terminal non-refunded outcome finalizes it; later corrections add compensating
 * adjustment entries. Only FINALIZED contribution can release a Promotion.
 */

export const PROMOTION_TURNOVER_ENTRY_KINDS = ["BET", "ADJUSTMENT"] as const;
export type PromotionTurnoverEntryKind = (typeof PROMOTION_TURNOVER_ENTRY_KINDS)[number];

export const PROMOTION_TURNOVER_ENTRY_STATES = ["PROVISIONAL", "FINALIZED", "REMOVED"] as const;
export type PromotionTurnoverEntryState = (typeof PROMOTION_TURNOVER_ENTRY_STATES)[number];

export interface TurnoverEntryProgressFact {
  readonly entryKind: PromotionTurnoverEntryKind;
  readonly state: PromotionTurnoverEntryState;
  readonly contributionMinor: bigint;
}

export interface TurnoverProgress {
  readonly provisionalMinor: bigint;
  readonly finalizedMinor: bigint;
  /** Member-visible progress: finalized plus still-provisional contribution. */
  readonly progressMinor: bigint;
  readonly targetMinor: bigint;
  readonly remainingMinor: bigint;
  /** Only finalized contribution can release the Promotion. */
  readonly releaseReached: boolean;
}

export function calculateTurnoverProgress(
  entries: readonly TurnoverEntryProgressFact[],
  targetMinor: bigint,
): TurnoverProgress {
  let provisionalMinor = 0n;
  let finalizedMinor = 0n;
  for (const entry of entries) {
    if (entry.state === "PROVISIONAL") provisionalMinor += entry.contributionMinor;
    else if (entry.state === "FINALIZED") finalizedMinor += entry.contributionMinor;
  }
  const progressMinor = finalizedMinor + provisionalMinor;
  const remainingMinor = targetMinor - finalizedMinor > 0n ? targetMinor - finalizedMinor : 0n;
  return {
    provisionalMinor,
    finalizedMinor,
    progressMinor,
    targetMinor,
    remainingMinor,
    releaseReached: targetMinor >= 0n && finalizedMinor >= targetMinor,
  };
}

export interface AcceptedBetTurnoverFacts {
  readonly betReference: string;
  readonly productId: string;
  readonly betTypeCode: string;
  /** Accepted stake from the snapshotted source allocation (BONUS and CASH). */
  readonly stakeMinor: bigint;
  /** Accepted payout/odds rule reference the Bet was priced with. */
  readonly payoutRef: string;
  readonly acceptedAt: Date;
}

export type PromotionTurnoverIneligibilityReason =
  | "PRODUCT_NOT_IN_SCOPE"
  | "BET_TYPE_NOT_IN_SCOPE"
  | "PAYOUT_RULE_NOT_ACCEPTED"
  | "STAKE_NOT_POSITIVE"
  | "CONTRIBUTION_ROUNDS_TO_ZERO"
  | "NOT_EFFECTIVE";

export interface TurnoverContributionDecision {
  readonly eligible: boolean;
  readonly reason: PromotionTurnoverIneligibilityReason | null;
  readonly contributionMinor: bigint;
}

/**
 * Contribution is computed from the accepted source allocation and the
 * Campaign terms snapshotted on the Entitlement: eligible funding source,
 * Product/Bet Type scope, contribution percentage and the minimum payout/odds
 * rule. The latest Campaign configuration is never consulted.
 */
export function calculateTurnoverContribution(
  terms: PromotionCampaignTerms,
  facts: AcceptedBetTurnoverFacts,
): TurnoverContributionDecision {
  const refuse = (reason: PromotionTurnoverIneligibilityReason): TurnoverContributionDecision => ({
    eligible: false,
    reason,
    contributionMinor: 0n,
  });

  if (scopeExcludes(terms.scope.eligibleProductIds, facts.productId)) {
    return refuse("PRODUCT_NOT_IN_SCOPE");
  }
  if (scopeExcludes(terms.scope.eligibleBetTypeCodes, facts.betTypeCode)) {
    return refuse("BET_TYPE_NOT_IN_SCOPE");
  }
  if (terms.scope.minPayoutRef !== null && terms.scope.minPayoutRef !== facts.payoutRef) {
    return refuse("PAYOUT_RULE_NOT_ACCEPTED");
  }
  if (facts.stakeMinor <= 0n) return refuse("STAKE_NOT_POSITIVE");

  const contributionMinor = (facts.stakeMinor * BigInt(terms.scope.contributionBps)) / 10_000n;
  if (contributionMinor <= 0n) return refuse("CONTRIBUTION_ROUNDS_TO_ZERO");

  return { eligible: true, reason: null, contributionMinor };
}

function scopeExcludes(allowlist: readonly string[], value: string): boolean {
  return allowlist.length > 0 && !allowlist.includes(value);
}

const TURNOVER_TRANSITIONS: Record<
  PromotionTurnoverEntryState,
  readonly PromotionTurnoverEntryState[]
> = {
  PROVISIONAL: ["FINALIZED", "REMOVED"],
  FINALIZED: [],
  REMOVED: [],
};

export function assertTurnoverEntryTransition(
  from: PromotionTurnoverEntryState,
  to: PromotionTurnoverEntryState,
): void {
  if (!TURNOVER_TRANSITIONS[from].includes(to)) {
    throw new PromotionRuleError(
      "TURNOVER_STATE_CONFLICT",
      `Turnover contribution cannot transition from ${from} to ${to}`,
      { from, to },
    );
  }
}

/**
 * Compensating turnover adjustment for a later correction/re-settlement. The
 * correction never rewrites the original contribution; it records the signed
 * difference as a new FINALIZED adjustment entry.
 */
export function calculateTurnoverAdjustment(
  originalContributionMinor: bigint,
  correctedContributionMinor: bigint,
): bigint {
  if (correctedContributionMinor < 0n) {
    throw new PromotionRuleError(
      "VALIDATION_ERROR",
      "Corrected turnover contribution cannot be negative",
    );
  }
  return correctedContributionMinor - originalContributionMinor;
}

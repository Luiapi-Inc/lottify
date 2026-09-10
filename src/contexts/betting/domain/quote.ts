// Betting Quote resolver (Wayfinder Issue 33 slice / Issue 44).
//
// Pure resolver that turns raw member-submitted bet lines into normalized,
// duplicate-aggregated Quote lines with server-authoritative resolved payout,
// stake limits and number restrictions. It deliberately recomputes every trusted
// value (payout, limits, total) from the effective Draw configuration rather
// than trusting any client-asserted amount or payout.
//
// The resolver consumes the *effective* per-Bet-Type configuration (Draw
// Snapshot resolved against the published Draw Override chain) produced by the
// application layer, and the effective number restrictions, so that payout
// precedence `Draw Override → Draw Snapshot / Bet-Type Default` and restriction
// dominance (`BLOCKED` dominates, `MAX_AMOUNT` strictest amount,
// `REDUCED_PAYOUT` strictest payout) are already applied before this function
// runs. The resolution of expiry/cutoff is handled by quote-expiry; the
// authoritative cutoff gate is applied by the application service. This module
// stays inside the betting bounded context and never imports a sibling context.

import {
  aggregateEquivalentBetLines,
  type CanonicalBetLine,
} from "./bet-line-aggregation";

/** Server-authoritative payout precedence source for a resolved line. */
export type QuotePayoutSource = "DRAW_OVERRIDE" | "DRAW_SNAPSHOT";

/** A number-level restriction on a Bet Type within a Draw (post-override). */
export type QuoteNumberRestriction =
  | { readonly kind: "BLOCKED" }
  | { readonly kind: "MAX_AMOUNT"; readonly maxAmountMinor: bigint }
  | { readonly kind: "REDUCED_PAYOUT"; readonly payout: unknown };

/**
 * Effective per-Bet-Type Draw configuration used to resolve a Quote. The
 * application layer produces this through the cross-context Draw port (the
 * platform adapter resolves the Draw snapshot + published Override chain).
 */
export interface EffectiveBetTypeConfig {
  readonly betTypeId: string;
  readonly betTypeCode: string;
  readonly betTypeVersionId: string;
  readonly validationPattern: string;
  readonly payout: unknown;
  readonly payoutSource: QuotePayoutSource;
  readonly minStakeMinor: bigint;
  readonly maxStakeMinor: bigint;
  readonly numberRestrictions: readonly QuoteNumberRestriction[];
  readonly bettingEnabled: boolean;
}

/** A raw member-submitted line; duplicate-equivalent lines are allowed. */
export interface RawQuoteLine {
  readonly betTypeCode: string;
  readonly canonicalNumber: string;
  readonly stakeMinor: bigint;
}

/** A normalized, aggregated Quote line returned to the client. */
export interface NormalizedQuoteLine {
  readonly betTypeId: string;
  readonly betTypeCode: string;
  readonly betTypeVersionId: string;
  readonly canonicalNumber: string;
  readonly stakeMinor: bigint;
  readonly resolvedPayout: unknown;
  readonly payoutSource: QuotePayoutSource;
  /** Canonical codes of the restrictions applied to this line (never BLOCKED). */
  readonly restrictions: readonly string[];
}

export type QuoteRuleCode =
  | "EMPTY_QUOTE"
  | "INVALID_STAKE"
  | "BET_TYPE_NOT_FOUND"
  | "BET_TYPE_DISABLED"
  | "INVALID_NUMBER"
  | "NUMBER_BLOCKED"
  | "STAKE_BELOW_MINIMUM"
  | "STAKE_LIMIT_EXCEEDED"
  | "MAX_AMOUNT_EXCEEDED";

export class QuoteRuleError extends Error {
  readonly code: QuoteRuleCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: QuoteRuleCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "QuoteRuleError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ResolveQuoteLinesInput {
  /** Effective (post-override) Bet Type configurations keyed by resolution. */
  readonly betTypes: readonly EffectiveBetTypeConfig[];
  readonly rawLines: readonly RawQuoteLine[];
}

export interface ResolveQuoteLinesResult {
  readonly lines: readonly NormalizedQuoteLine[];
  readonly totalStakeMinor: bigint;
}

/**
 * Validates, aggregates duplicate-equivalent lines and resolves the strictest
 * payout / stake limits / number restrictions per line. Every value is computed
 * server-side from the effective Draw configuration.
 */
export function resolveQuoteLines(
  input: ResolveQuoteLinesInput,
): ResolveQuoteLinesResult {
  if (input.rawLines.length === 0) {
    throw new QuoteRuleError(
      "EMPTY_QUOTE",
      "A Quote requires at least one bet line",
      400,
      { field: "lines" },
    );
  }

  const byCode = new Map<string, EffectiveBetTypeConfig>();
  for (const betType of input.betTypes) {
    byCode.set(betType.betTypeCode, betType);
  }

  // 1. Validate each raw line before aggregation so failures are attributed to
  //    the offending canonical line, not the aggregated total.
  const validatedLines: CanonicalBetLine[] = input.rawLines.map((line) => {
    const betType = byCode.get(line.betTypeCode.trim());
    if (!betType) {
      throw new QuoteRuleError(
        "BET_TYPE_NOT_FOUND",
        `Bet Type ${line.betTypeCode} is not part of the Draw`,
        400,
        { betTypeCode: line.betTypeCode, field: "lines" },
      );
    }
    if (!betType.bettingEnabled) {
      throw new QuoteRuleError(
        "BET_TYPE_DISABLED",
        `Bet Type ${line.betTypeCode} is not accepting bets`,
        409,
        { betTypeCode: line.betTypeCode, field: "lines" },
      );
    }
    if (!line.canonicalNumber.trim()) {
      throw new QuoteRuleError(
        "INVALID_NUMBER",
        `Bet Type ${line.betTypeCode} requires a canonical number`,
        400,
        { betTypeCode: line.betTypeCode, field: "lines" },
      );
    }
    if (
      !new RegExp(betType.validationPattern).test(line.canonicalNumber.trim())
    ) {
      throw new QuoteRuleError(
        "INVALID_NUMBER",
        `Number ${line.canonicalNumber} is not a valid ${line.betTypeCode} number`,
        400,
        { betTypeCode: line.betTypeCode, canonicalNumber: line.canonicalNumber, field: "lines" },
      );
    }
    if (line.stakeMinor <= 0n) {
      throw new QuoteRuleError(
        "INVALID_STAKE",
        "Every bet line stake must be a positive integer minor-unit amount",
        400,
        { betTypeCode: line.betTypeCode, canonicalNumber: line.canonicalNumber, field: "lines" },
      );
    }
    return {
      betTypeCode: betType.betTypeCode,
      canonicalNumber: line.canonicalNumber.trim(),
      stakeMinor: line.stakeMinor,
    };
  });

  // 2. Aggregate duplicate-equivalent lines (same Bet Type + canonical number).
  const aggregated = aggregateEquivalentBetLines(validatedLines);

  // 3. Resolve each aggregated line against the effective configuration.
  const lines: NormalizedQuoteLine[] = aggregated.map((line) => {
    const betType = byCode.get(line.betTypeCode);
    if (!betType) {
      throw new QuoteRuleError(
        "BET_TYPE_NOT_FOUND",
        `Bet Type ${line.betTypeCode} is not part of the Draw`,
        400,
        { betTypeCode: line.betTypeCode },
      );
    }

    // BLOCKED dominates every other rule.
    const hasBlockingRestriction = betType.numberRestrictions.some(
      (restriction) => restriction.kind === "BLOCKED",
    );
    if (hasBlockingRestriction) {
      throw new QuoteRuleError(
        "NUMBER_BLOCKED",
        `Number ${line.canonicalNumber} is blocked for Bet Type ${line.betTypeCode}`,
        409,
        { betTypeCode: line.betTypeCode, canonicalNumber: line.canonicalNumber },
      );
    }

    // Strictest applicable per-line stake limits from the effective config.
    const minStakeMinor = betType.minStakeMinor;
    const maxStakeMinor = betType.maxStakeMinor;

    // MAX_AMOUNT restriction: strictest applicable amount further caps the line.
    const maxAmountMinor = strictestMaxAmountMinor(
      betType.numberRestrictions
        .filter((restriction): restriction is Extract<QuoteNumberRestriction, { kind: "MAX_AMOUNT" }> =>
          restriction.kind === "MAX_AMOUNT",
        )
        .map((restriction) => restriction.maxAmountMinor),
    );

    const effectiveMax =
      maxAmountMinor === undefined
        ? maxStakeMinor
        : maxStakeMinor === undefined
          ? maxAmountMinor
          : maxStakeMinor < maxAmountMinor
            ? maxStakeMinor
            : maxAmountMinor;

    if (minStakeMinor !== undefined && line.stakeMinor < minStakeMinor) {
      throw new QuoteRuleError(
        "STAKE_BELOW_MINIMUM",
        `Stake ${line.stakeMinor} is below the minimum for Bet Type ${line.betTypeCode}`,
        400,
        {
          betTypeCode: line.betTypeCode,
          canonicalNumber: line.canonicalNumber,
          minStakeMinor: minStakeMinor.toString(),
          stakeMinor: line.stakeMinor.toString(),
        },
      );
    }
    if (effectiveMax !== undefined && line.stakeMinor > effectiveMax) {
      throw new QuoteRuleError(
        maxAmountMinor !== undefined && line.stakeMinor > maxAmountMinor
          ? "MAX_AMOUNT_EXCEEDED"
          : "STAKE_LIMIT_EXCEEDED",
        `Stake ${line.stakeMinor} exceeds the maximum for Bet Type ${line.betTypeCode}`,
        400,
        {
          betTypeCode: line.betTypeCode,
          canonicalNumber: line.canonicalNumber,
          maxStakeMinor: effectiveMax.toString(),
          stakeMinor: line.stakeMinor.toString(),
        },
      );
    }

    // REDUCED_PAYOUT: strictest applicable reduced payout wins over the default.
    const reducedPayout = strictestReducedPayout(
      betType.numberRestrictions
        .filter((restriction): restriction is Extract<QuoteNumberRestriction, { kind: "REDUCED_PAYOUT" }> =>
          restriction.kind === "REDUCED_PAYOUT",
        )
        .map((restriction) => restriction.payout),
    );

    const appliedRestrictions: string[] = [];
    if (maxAmountMinor !== undefined) appliedRestrictions.push("MAX_AMOUNT");
    if (reducedPayout !== undefined) appliedRestrictions.push("REDUCED_PAYOUT");

    return {
      betTypeId: betType.betTypeId,
      betTypeCode: betType.betTypeCode,
      betTypeVersionId: betType.betTypeVersionId,
      canonicalNumber: line.canonicalNumber,
      stakeMinor: line.stakeMinor,
      resolvedPayout: reducedPayout === undefined ? betType.payout : reducedPayout,
      payoutSource: betType.payoutSource,
      restrictions: appliedRestrictions,
    };
  });

  const totalStakeMinor = lines.reduce(
    (total, line) => total + line.stakeMinor,
    0n,
  );

  return Object.freeze({ lines: Object.freeze(lines), totalStakeMinor });
}

/** Strictest (lowest) MAX_AMOUNT cap among the applicable restrictions. */
function strictestMaxAmountMinor(
  amounts: readonly bigint[],
): bigint | undefined {
  let strictest: bigint | undefined;
  for (const amount of amounts) {
    if (strictest === undefined || amount < strictest) strictest = amount;
  }
  return strictest;
}

/** Picks the most restrictive reduced payout: smallest FIXED amountMinor. */
function strictestReducedPayout(payouts: readonly unknown[]): unknown | undefined {
  let strictest: unknown | undefined;
  let strictestAmount: bigint | undefined;

  for (const payout of payouts) {
    const amount = fixedPayoutAmountMinor(payout);
    if (amount !== undefined) {
      if (strictestAmount === undefined || amount < strictestAmount) {
        strictest = payout;
        strictestAmount = amount;
      }
      continue;
    }
    // Non-numeric reduced payouts fall back to first-applicable deterministically.
    if (strictest === undefined) strictest = payout;
  }

  return strictest;
}

function fixedPayoutAmountMinor(payout: unknown): bigint | undefined {
  if (
    payout !== null &&
    typeof payout === "object" &&
    (payout as { kind?: unknown }).kind === "FIXED"
  ) {
    const amount = (payout as { amountMinor?: unknown }).amountMinor;
    if (typeof amount === "bigint") return amount;
    if (typeof amount === "string" && /^\d+$/.test(amount)) return BigInt(amount);
    if (typeof amount === "number" && Number.isInteger(amount) && amount >= 0) {
      return BigInt(amount);
    }
  }
  return undefined;
}

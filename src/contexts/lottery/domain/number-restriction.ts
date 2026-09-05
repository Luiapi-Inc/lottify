export const NUMBER_RESTRICTION_KINDS = [
  "BLOCKED",
  "REDUCED_PAYOUT",
  "MAX_AMOUNT",
] as const;

export type NumberRestrictionKind = (typeof NUMBER_RESTRICTION_KINDS)[number];

export function hasBlockingNumberRestriction(
  kinds: readonly NumberRestrictionKind[],
): boolean {
  return kinds.includes("BLOCKED");
}

export function resolveStrictestMaxAmountMinor(
  applicableMaxAmountsMinor: readonly bigint[],
): bigint | undefined {
  let strictest: bigint | undefined;

  for (const amountMinor of applicableMaxAmountsMinor) {
    if (strictest === undefined || amountMinor < strictest) {
      strictest = amountMinor;
    }
  }

  return strictest;
}

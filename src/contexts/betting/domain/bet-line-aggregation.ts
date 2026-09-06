export interface CanonicalBetLine {
  readonly betTypeCode: string;
  readonly canonicalNumber: string;
  readonly stakeMinor: bigint;
}

export function aggregateEquivalentBetLines(
  lines: readonly CanonicalBetLine[],
): CanonicalBetLine[] {
  const aggregated: CanonicalBetLine[] = [];
  const indexByBetTypeAndNumber = new Map<string, Map<string, number>>();

  for (const line of lines) {
    let indexByNumber = indexByBetTypeAndNumber.get(line.betTypeCode);
    if (indexByNumber === undefined) {
      indexByNumber = new Map<string, number>();
      indexByBetTypeAndNumber.set(line.betTypeCode, indexByNumber);
    }

    const existingIndex = indexByNumber.get(line.canonicalNumber);
    if (existingIndex === undefined) {
      indexByNumber.set(line.canonicalNumber, aggregated.length);
      aggregated.push({ ...line });
      continue;
    }

    const existing = aggregated[existingIndex];
    if (existing === undefined) {
      throw new Error("Canonical Bet Line aggregation index is inconsistent");
    }
    aggregated[existingIndex] = {
      ...existing,
      stakeMinor: existing.stakeMinor + line.stakeMinor,
    };
  }

  return aggregated;
}

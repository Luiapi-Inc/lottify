export const DRAW_PAYOUT_SOURCES = ["DRAW_OVERRIDE", "DRAW_SNAPSHOT"] as const;

export type DrawPayoutSource = (typeof DRAW_PAYOUT_SOURCES)[number];

export interface DrawPayoutResolution<TPayout> {
  readonly payout: TPayout;
  readonly source: DrawPayoutSource;
}

export interface DrawPayoutCandidates<TPayout> {
  readonly drawSnapshot: TPayout;
  readonly drawOverride?: TPayout;
}

export function resolveDrawPayout<TPayout>(
  candidates: DrawPayoutCandidates<TPayout>,
): DrawPayoutResolution<TPayout> {
  if (candidates.drawOverride !== undefined) {
    return {
      payout: candidates.drawOverride,
      source: "DRAW_OVERRIDE",
    };
  }

  return {
    payout: candidates.drawSnapshot,
    source: "DRAW_SNAPSHOT",
  };
}

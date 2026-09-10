// Cross-context port (boundary) between the betting and lottery contexts.
//
// The betting bounded context must not import lottery domain directly. To
// resolve a Quote it needs the Draw's *effective* configuration (snapshot
// resolved against the published Override chain). That is lottery-owned, so it
// is obtained through this port; a platform adapter (composition root) resolves
// it with the lottery domain and returns betting-local types.

import type { EffectiveBetTypeConfig } from "../domain/quote";

export interface EffectiveDrawForQuote {
  readonly draw: {
    readonly id: string;
    readonly productId: string;
    readonly productVersionId: string;
    readonly state: string;
  };
  readonly cutoffAt: Date;
  readonly betTypes: readonly EffectiveBetTypeConfig[];
}

export interface BettingQuoteDrawPort {
  /**
   * Loads a Draw and its effective (post-override) per-Bet-Type configuration
   * as of `asOf`. Returns `null` when the Draw does not exist.
   */
  loadEffectiveDraw(
    drawId: string,
    asOf: Date,
  ): Promise<EffectiveDrawForQuote | null>;
}

export const BETTING_QUOTE_DRAW_PORT = Symbol("BETTING_QUOTE_DRAW_PORT");

/**
 * Cross-context seam into the authoritative Wallet & Ledger financial core.
 *
 * Promotion never mutates a balance directly. Reward grant, turnover release
 * (BONUS → CASH conversion) and expiry removal are all posted through this port,
 * every posting is linked to the Promotion Entitlement that caused it, and every
 * posting is idempotent on the Entitlement so a recovery retry can never apply a
 * monetary Promotion effect twice.
 */
export interface PromotionLedgerGrantInput {
  readonly entitlementId: string;
  readonly memberId: string;
  readonly amountMinor: bigint;
  readonly fundingSource: string;
  readonly correlationId: string;
  readonly effectiveAt: Date;
}

export interface PromotionLedgerReleaseInput {
  readonly entitlementId: string;
  readonly memberId: string;
  readonly amountMinor: bigint;
  readonly fundingSource: string;
  readonly correlationId: string;
  readonly effectiveAt: Date;
}

export interface PromotionLedgerExpiryInput extends PromotionLedgerReleaseInput {}

export interface PromotionLedgerPort {
  /** Posts the granted reward into the Member BONUS bucket from Promotion funding. */
  grantBonus(input: PromotionLedgerGrantInput): Promise<string>;
  /** Converts reachable BONUS value into CASH on turnover completion. */
  convertBonusToCash(input: PromotionLedgerReleaseInput): Promise<string>;
  /** Removes remaining bonus value traceable to an expired Entitlement. */
  removeExpiredBonus(input: PromotionLedgerExpiryInput): Promise<string>;
}

export const PROMOTION_LEDGER_PORT = Symbol("PROMOTION_LEDGER_PORT");

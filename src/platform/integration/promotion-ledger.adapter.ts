import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";
import type {
  PromotionLedgerExpiryInput,
  PromotionLedgerGrantInput,
  PromotionLedgerPort,
  PromotionLedgerReleaseInput,
} from "../../contexts/promotion/application/promotion-ledger.port";

/**
 * Cross-context seam that posts Promotion monetary effects into the
 * authoritative Wallet & Ledger financial core:
 *
 *   * grant  — Promotion funding/control → Member BONUS
 *   * release — Member BONUS → Member CASH (turnover completion conversion)
 *   * expiry — Member BONUS → Promotion funding/control (remaining value only)
 *
 * Every posting is scoped and keyed by the Promotion Entitlement, so a retry
 * after a crash between the durable posting and the Entitlement resolution
 * replays the exact same transaction instead of moving money twice.
 */
@Injectable()
export class PromotionLedgerAdapter implements PromotionLedgerPort {
  constructor(private readonly ledger: FinancialLedgerService) {}

  async grantBonus(input: PromotionLedgerGrantInput): Promise<string> {
    const memberBonusAccountId = await this.ledger.ensureMemberAccount(
      input.memberId,
      "BONUS",
      "THB",
    );
    const fundingAccountId = await this.ledger.ensureSystemAccount(
      promotionFundingAccount(input.fundingSource),
      "THB",
    );

    return this.ledger.post({
      businessTransactionId: `promotion-grant:${input.entitlementId}`,
      operationType: "PROMOTION_BONUS_GRANT",
      correlationId: input.correlationId,
      idempotency: {
        scope: `PROMOTION_BONUS_GRANT:${input.entitlementId}`,
        key: input.entitlementId,
        fingerprint: promotionPostingFingerprint({
          operationType: "PROMOTION_BONUS_GRANT",
          entitlementId: input.entitlementId,
          memberId: input.memberId,
          amountMinor: input.amountMinor,
        }),
      },
      domainReferences: {
        promotionEntitlementId: input.entitlementId,
        promotionFundingSource: input.fundingSource,
      },
      currency: "THB",
      effectiveAt: input.effectiveAt,
      postings: [
        { accountId: memberBonusAccountId, side: "CREDIT", amountMinor: input.amountMinor },
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: input.amountMinor },
      ],
    });
  }

  async convertBonusToCash(input: PromotionLedgerReleaseInput): Promise<string> {
    const memberBonusAccountId = await this.ledger.ensureMemberAccount(
      input.memberId,
      "BONUS",
      "THB",
    );
    const memberCashAccountId = await this.ledger.ensureMemberAccount(
      input.memberId,
      "CASH",
      "THB",
    );

    return this.ledger.post({
      businessTransactionId: `promotion-release:${input.entitlementId}`,
      operationType: "PROMOTION_BONUS_TO_CASH",
      correlationId: input.correlationId,
      idempotency: {
        scope: `PROMOTION_BONUS_TO_CASH:${input.entitlementId}`,
        key: input.entitlementId,
        fingerprint: promotionPostingFingerprint({
          operationType: "PROMOTION_BONUS_TO_CASH",
          entitlementId: input.entitlementId,
          memberId: input.memberId,
          amountMinor: input.amountMinor,
        }),
      },
      domainReferences: {
        promotionEntitlementId: input.entitlementId,
        promotionFundingSource: input.fundingSource,
      },
      currency: "THB",
      effectiveAt: input.effectiveAt,
      postings: [
        { accountId: memberCashAccountId, side: "CREDIT", amountMinor: input.amountMinor },
        { accountId: memberBonusAccountId, side: "DEBIT", amountMinor: input.amountMinor },
      ],
    });
  }

  async removeExpiredBonus(input: PromotionLedgerExpiryInput): Promise<string> {
    const memberBonusAccountId = await this.ledger.ensureMemberAccount(
      input.memberId,
      "BONUS",
      "THB",
    );
    const fundingAccountId = await this.ledger.ensureSystemAccount(
      promotionFundingAccount(input.fundingSource),
      "THB",
    );

    return this.ledger.post({
      businessTransactionId: `promotion-expiry:${input.entitlementId}`,
      operationType: "PROMOTION_BONUS_EXPIRY",
      correlationId: input.correlationId,
      idempotency: {
        scope: `PROMOTION_BONUS_EXPIRY:${input.entitlementId}`,
        key: input.entitlementId,
        fingerprint: promotionPostingFingerprint({
          operationType: "PROMOTION_BONUS_EXPIRY",
          entitlementId: input.entitlementId,
          memberId: input.memberId,
          amountMinor: input.amountMinor,
        }),
      },
      domainReferences: {
        promotionEntitlementId: input.entitlementId,
        promotionFundingSource: input.fundingSource,
      },
      currency: "THB",
      effectiveAt: input.effectiveAt,
      postings: [
        { accountId: fundingAccountId, side: "CREDIT", amountMinor: input.amountMinor },
        { accountId: memberBonusAccountId, side: "DEBIT", amountMinor: input.amountMinor },
      ],
    });
  }
}

export function promotionFundingAccount(fundingSource: string): string {
  return `promotion-funding:${fundingSource}`;
}

function promotionPostingFingerprint(input: {
  operationType: string;
  entitlementId: string;
  memberId: string;
  amountMinor: bigint;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        operationType: input.operationType,
        entitlementId: input.entitlementId,
        memberId: input.memberId,
        amountMinor: input.amountMinor.toString(),
      }),
    )
    .digest("hex");
}

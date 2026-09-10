// Platform composition-root adapter for the settlement -> wallet-ledger port.
//
// Lives in the platform layer so it may combine the Wallet & Ledger application
// service with the settlement port types. A winning payout credits the Member's
// CASH bucket and debits the Betting Settlement system account; a correction
// reverses the prior payout. Both are idempotent per Order / payout
// transaction, so replay of a crashed batch or correction can never pay a
// winner twice or reverse it twice.

import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";
import {
  SettlementWalletError,
  type SettlementWalletPort,
} from "../../contexts/result-settlement/application/settlement.ports";

/** Counterparty account that holds committed stakes / pays winning returns. */
const BETTING_SETTLEMENT_SYSTEM_CODE = "betting-settlement";

@Injectable()
export class SettlementWalletAdapter implements SettlementWalletPort {
  constructor(private readonly ledger: FinancialLedgerService) {}

  async postSettlementPayout(input: {
    orderId: string;
    memberId: string;
    drawId: string;
    amountMinor: bigint;
    currency: "THB";
    correlationId: string;
  }): Promise<{ transactionId: string }> {
    const currency = "THB" as const;
    if (input.amountMinor <= 0n) {
      throw new SettlementWalletError(
        "INSUFFICIENT_FUNDS",
        "Settlement payout must be positive integer minor units",
        { orderId: input.orderId },
      );
    }
    const cashAccountId = await this.ledger.ensureMemberAccount(
      input.memberId,
      "CASH",
      currency,
    );
    const settlementAccountId = await this.ledger.ensureSystemAccount(
      BETTING_SETTLEMENT_SYSTEM_CODE,
      currency,
    );

    const transactionId = await this.ledger.post({
      businessTransactionId: `${input.orderId}:settle`,
      operationType: "SETTLEMENT_PAYOUT",
      correlationId: input.correlationId,
      idempotency: {
        scope: `SETTLEMENT_PAYOUT:${input.orderId}`,
        key: input.orderId,
        fingerprint: payoutFingerprint(input),
      },
      domainReferences: { orderId: input.orderId, drawId: input.drawId },
      currency,
      effectiveAt: new Date(),
      postings: [
        { accountId: settlementAccountId, side: "DEBIT", amountMinor: input.amountMinor },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: input.amountMinor },
      ],
    });
    return { transactionId };
  }

  async reverseSettlementPayout(input: {
    orderId: string;
    payoutTransactionId: string;
    memberId: string;
    drawId: string;
    currency: "THB";
    correlationId: string;
  }): Promise<{ transactionId: string }> {
    const transactionId = await this.ledger.reverseTransaction({
      originalTransactionId: input.payoutTransactionId,
      businessTransactionId: `${input.orderId}:settle:reversal`,
      operationType: "SETTLEMENT_PAYOUT_REVERSAL",
      correlationId: input.correlationId,
      idempotency: {
        scope: `SETTLEMENT_PAYOUT_REVERSAL:${input.payoutTransactionId}`,
        key: input.payoutTransactionId,
        fingerprint: reversalFingerprint(input),
      },
      domainReferences: { orderId: input.orderId, drawId: input.drawId },
      effectiveAt: new Date(),
    });
    return { transactionId };
  }
}

function payoutFingerprint(input: {
  orderId: string;
  memberId: string;
  drawId: string;
  amountMinor: bigint;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        orderId: input.orderId,
        memberId: input.memberId,
        drawId: input.drawId,
        amountMinor: input.amountMinor.toString(),
      }),
    )
    .digest("hex");
}

function reversalFingerprint(input: {
  orderId: string;
  payoutTransactionId: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        orderId: input.orderId,
        payoutTransactionId: input.payoutTransactionId,
      }),
    )
    .digest("hex");
}

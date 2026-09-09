import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";
import type {
  DepositLedgerPort,
} from "../../contexts/payments/application/deposit-ledger.port";
import type { PaymentCurrency } from "../../contexts/payments/domain/payment-provider-result";

/**
 * Cross-context seam that posts the authoritative Deposit credit into Wallet &
 * Ledger. A Deposit completion is a verified/defaulted provider APPROVED with a
 * Ledger DEPOSIT_CREDIT posting; this adapter ensures the posting is idempotent
 * on depositId so a reconciliation retry never double-credits.
 */
@Injectable()
export class DepositLedgerAdapter implements DepositLedgerPort {
  constructor(private readonly ledger: FinancialLedgerService) {}

  async creditDeposit(input: {
    depositId: string;
    memberId: string;
    providerId: string;
    amountMinor: bigint;
    currency: PaymentCurrency;
    correlationId: string;
  }): Promise<string> {
    const currency = "THB" as const;
    const memberCashAccountId = await this.ledger.ensureMemberAccount(
      input.memberId,
      "CASH",
      currency,
    );
    const providerClearingAccountId = await this.ledger.ensureSystemAccount(
      `payment-provider:${input.providerId}`,
      currency,
    );

    return this.ledger.post({
      businessTransactionId: input.depositId,
      operationType: "DEPOSIT_CREDIT",
      correlationId: input.correlationId,
      idempotency: {
        scope: `DEPOSIT_CREDIT:${input.depositId}`,
        key: input.depositId,
        fingerprint: depositCreditFingerprint(input),
      },
      domainReferences: {
        depositId: input.depositId,
        providerId: input.providerId,
      },
      currency,
      effectiveAt: new Date(),
      postings: [
        { accountId: memberCashAccountId, side: "CREDIT", amountMinor: input.amountMinor },
        { accountId: providerClearingAccountId, side: "DEBIT", amountMinor: input.amountMinor },
      ],
    });
  }
}

function depositCreditFingerprint(input: {
  memberId: string;
  providerId: string;
  amountMinor: bigint;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        memberId: input.memberId,
        providerId: input.providerId,
        amountMinor: input.amountMinor.toString(),
      }),
    )
    .digest("hex");
}
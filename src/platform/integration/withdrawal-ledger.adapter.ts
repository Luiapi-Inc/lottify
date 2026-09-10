import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";
import {
  WithdrawalFundsUnavailableError,
  type WithdrawalLedgerPort,
} from "../../contexts/payments/application/withdrawal-ledger.port";

/**
 * Cross-context seam that lets Payments orchestrate a Withdrawal without ever
 * mutating a balance: Wallet & Ledger owns the Reservation, its release and the
 * authoritative `WITHDRAWAL_FINALIZE` posting. Every operation is idempotent on
 * the Withdrawal identity so a retry or crash recovery cannot duplicate a hold,
 * a release, or a posting.
 */
@Injectable()
export class WithdrawalLedgerAdapter implements WithdrawalLedgerPort {
  constructor(private readonly ledger: FinancialLedgerService) {}

  async getWithdrawalAvailableMinor(input: {
    memberId: string;
    currency: "THB";
  }): Promise<bigint> {
    const projection = await this.ledger.getWalletProjection(input.memberId, input.currency);
    return projection.buckets.find((bucket) => bucket.bucket === "CASH")?.availableMinor ?? 0n;
  }

  async reserveWithdrawal(input: {
    withdrawalId: string;
    memberId: string;
    amountMinor: bigint;
    currency: "THB";
    correlationId: string;
  }): Promise<string> {
    const memberCashAccountId = await this.ledger.ensureMemberAccount(
      input.memberId,
      "CASH",
      input.currency,
    );

    try {
      return await this.ledger.reserve({
        purpose: "WITHDRAWAL",
        businessReference: withdrawalBusinessReference(input.withdrawalId),
        memberId: input.memberId,
        currency: input.currency,
        amountMinor: input.amountMinor,
        correlationId: input.correlationId,
        idempotency: {
          scope: reserveScope(input.withdrawalId),
          key: input.withdrawalId,
          fingerprint: hash({
            withdrawalId: input.withdrawalId,
            memberId: input.memberId,
            amountMinor: input.amountMinor.toString(),
            currency: input.currency,
          }),
        },
        // Withdrawal Reservations may use Member CASH only: LOCKED value is
        // never spendable and BONUS is not withdrawable (financial core).
        allocations: [{ accountId: memberCashAccountId, amountMinor: input.amountMinor }],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        /exceed available spendable balance/i.test(message) ||
        /debt blocks/i.test(message)
      ) {
        // The Ledger is the only balance authority: an oversized or otherwise
        // unavailable request is a funds failure, never a Payments-side clamp.
        throw new WithdrawalFundsUnavailableError(message);
      }
      throw error;
    }
  }

  async releaseWithdrawal(input: {
    withdrawalId: string;
    reservationId: string;
    correlationId: string;
  }): Promise<void> {
    await this.ledger.releaseReservation(input.reservationId);
  }

  async finalizeWithdrawal(input: {
    withdrawalId: string;
    memberId: string;
    reservationId: string;
    amountMinor: bigint;
    currency: "THB";
    providerId: string;
    correlationId: string;
  }): Promise<string> {
    const payoutClearingAccountId = await this.ledger.ensureSystemAccount(
      `payout-provider:${input.providerId}`,
      input.currency,
    );

    return this.ledger.consumeReservationAndPost({
      reservationId: input.reservationId,
      businessTransactionId: input.withdrawalId,
      operationType: "WITHDRAWAL_FINALIZE",
      correlationId: input.correlationId,
      idempotency: {
        scope: finalizeScope(input.withdrawalId),
        key: input.withdrawalId,
        fingerprint: hash({
          withdrawalId: input.withdrawalId,
          memberId: input.memberId,
          reservationId: input.reservationId,
          amountMinor: input.amountMinor.toString(),
          currency: input.currency,
          providerId: input.providerId,
        }),
      },
      domainReferences: {
        withdrawalId: input.withdrawalId,
        providerId: input.providerId,
      },
      currency: input.currency,
      effectiveAt: new Date(),
      destinations: [{ accountId: payoutClearingAccountId, amountMinor: input.amountMinor }],
    });
  }
}

export function withdrawalBusinessReference(withdrawalId: string): string {
  return `withdrawal:${withdrawalId}`;
}

export function reserveScope(withdrawalId: string): string {
  return `WITHDRAWAL_RESERVE:${withdrawalId}`;
}

export function finalizeScope(withdrawalId: string): string {
  return `WITHDRAWAL_FINALIZE:${withdrawalId}`;
}

function hash(value: Readonly<Record<string, string>>): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

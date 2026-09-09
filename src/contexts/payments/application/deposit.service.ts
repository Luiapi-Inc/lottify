import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  PAYMENT_PROVIDER_ADAPTER,
  PaymentProviderAdapterError,
  type PaymentProviderAdapter,
} from "./payment-provider.adapter";
import { DEPOSIT_LEDGER_PORT, type DepositLedgerPort } from "./deposit-ledger.port";
import {
  DEPOSIT_REPOSITORY,
  type DepositRepository,
} from "../domain/deposit.repository";
import {
  DepositError,
  depositIsOpenForResolution,
  depositStatusForProviderOutcome,
  validateDepositInitiation,
  type Deposit,
} from "../domain/deposit";
import type {
  PaymentCurrency,
  PaymentProviderOutcome,
} from "../domain/payment-provider-result";

export interface InitiateDepositCommand {
  providerCode: string;
  methodCode: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
  idempotencyKey: string;
}

@Injectable()
export class DepositService {
  constructor(
    @Inject(DEPOSIT_REPOSITORY) private readonly deposits: DepositRepository,
    @Inject(DEPOSIT_LEDGER_PORT) private readonly ledger: DepositLedgerPort,
    @Inject(PAYMENT_PROVIDER_ADAPTER) private readonly provider: PaymentProviderAdapter,
  ) {}

  /**
   * Initiates a Member deposit idempotently by a scoped Idempotency-Key. A
   * retry with the same key returns the prior result; a changed payload with the
   * same key is an IDEMPOTENCY_CONFLICT. On an ambiguous provider outcome the
   * Deposit is recorded as REVIEW_REQUIRED and NEVER credited or blindly
   * re-initiated; recovery happens through getDeposit/reconcileDeposit which only
   * credits on proven provider APPROVED and with an idempotent Ledger posting.
   */
  async initiateDeposit(
    memberId: string,
    command: InitiateDepositCommand,
    correlationId: string,
  ): Promise<Deposit> {
    if (!command.idempotencyKey.trim() || command.idempotencyKey.length > 200) {
      throw new DepositError(
        "INVALID",
        "Idempotency-Key is required and must be at most 200 characters",
      );
    }
    validateDepositInitiation(command);

    const scope = `DEPOSIT_INITIATE:${memberId}`;
    const fingerprint = depositFingerprint({
      memberId,
      methodCode: command.methodCode,
      amountMinor: command.amountMinor,
      currency: command.currency,
    });

    // Same-key retry returns the prior durable result.
    const existing = await this.deposits.findByIdempotency(scope, command.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new DepositError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different deposit payload",
        );
      }
      return existing;
    }

    const id = randomUUID();
    const correlation = correlationId || randomUUID();
    const created = await this.deposits.create({
      id,
      memberId,
      providerId: command.providerCode,
      providerCode: command.providerCode,
      methodCode: command.methodCode,
      amountMinor: command.amountMinor,
      currency: command.currency,
      idempotencyScope: scope,
      idempotencyKey: command.idempotencyKey,
      fingerprint,
      providerReferenceKey: `dep:${id}`,
      correlationId: correlation,
    });
    // A concurrent request with the same key won the insert: replay its result.
    if (!created) {
      const raced = await this.deposits.findByIdempotency(scope, command.idempotencyKey);
      if (!raced) {
        throw new DepositError("INVALID", "Deposit could not be created");
      }
      if (raced.fingerprint !== fingerprint) {
        throw new DepositError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different deposit payload",
        );
      }
      return raced;
    }

    const requestAttemptId = randomUUID();
    try {
      const initiated = await this.provider.initiateDeposit({
        depositId: created.id,
        providerId: created.providerId,
        providerCode: created.providerCode,
        methodCode: created.methodCode,
        amountMinor: created.amountMinor,
        currency: created.currency,
        providerReferenceKey: created.providerReferenceKey,
        requestAttemptId,
        correlationId: correlation,
      });
      return await this.applyProviderOutcome(
        created,
        initiated.result.outcome,
        initiated.identity.providerTransactionId,
      );
    } catch (error) {
      if (error instanceof PaymentProviderAdapterError) {
        return this.recordProviderFailure(created, error.failure.category);
      }
      // Unclassified failure is ambiguous per Ticket 09: never a definitive
      // outcome, never blindly retried.
      return this.recordProviderFailure(created, "AMBIGUOUS_OUTCOME");
    }
  }

  /**
   * Reconciles an open Deposit against the provider by known reference. A
   * timeout/transport retry reuses the same provider reference key and never
   * re-initiates the external side effect; credit happens only once a definitive
   * APPROVED status is observed, and is idempotent on the Ledger posting.
   */
  async reconcileDeposit(
    memberId: string,
    depositId: string,
    correlationId: string,
  ): Promise<Deposit> {
    const deposit = await this.requireOwnedDeposit(memberId, depositId);
    return this.resolveAgainstProvider(deposit, correlationId || deposit.correlationId);
  }

  async getDeposit(memberId: string, depositId: string): Promise<Deposit> {
    return this.requireOwnedDeposit(memberId, depositId);
  }

  private async applyProviderOutcome(
    deposit: Deposit,
    outcome: PaymentProviderOutcome,
    providerTransactionId: string | null,
  ): Promise<Deposit> {
    const status = depositStatusForProviderOutcome(outcome);
    const resolved = await this.deposits.resolve(deposit.id, {
      providerTransactionId,
      status,
      incomingProviderError: null,
    });
    return this.creditIfCompleted(resolved);
  }

  private async recordProviderFailure(
    deposit: Deposit,
    category: string,
  ): Promise<Deposit> {
    const status = category === "BUSINESS_REJECTION" ? "REJECTED" : "REVIEW_REQUIRED";
    return this.deposits.resolve(deposit.id, {
      status,
      incomingProviderError: category,
    });
  }

  private async resolveAgainstProvider(
    deposit: Deposit,
    correlationId: string,
  ): Promise<Deposit> {
    if (deposit.ledgerTransactionId) {
      return deposit; // already credited; terminal.
    }
    if (!depositIsOpenForResolution(deposit.status)) {
      return deposit; // REJECTED is terminal; nothing to resolve.
    }

    try {
      const statusResult = await this.provider.getDepositStatus({
        depositId: deposit.id,
        providerId: deposit.providerId,
        providerReferenceKey: deposit.providerReferenceKey,
        providerTransactionId: deposit.providerTransactionId ?? undefined,
        requestAttemptId: randomUUID(),
        correlationId,
      });
      const status = depositStatusForProviderOutcome(statusResult.result.outcome);
      const resolved = await this.deposits.resolve(deposit.id, {
        providerTransactionId: statusResult.identity.providerTransactionId,
        status,
        incomingProviderError: null,
      });
      return this.creditIfCompleted(resolved);
    } catch (error) {
      if (!(error instanceof PaymentProviderAdapterError)) {
        // Unclassified status failure is treated as ambiguous; no credit.
        return this.deposits.resolve(deposit.id, {
          status: "REVIEW_REQUIRED",
          incomingProviderError: "UNCLASSIFIED",
        });
      }
      const status =
        error.failure.category === "BUSINESS_REJECTION" ? "REJECTED" : "REVIEW_REQUIRED";
      return this.deposits.resolve(deposit.id, {
        status,
        incomingProviderError: error.failure.category,
      });
    }
  }

  private async creditIfCompleted(deposit: Deposit): Promise<Deposit> {
    if (deposit.status !== "COMPLETED" || deposit.ledgerTransactionId) {
      return deposit;
    }
    const ledgerTransactionId = await this.ledger.creditDeposit({
      depositId: deposit.id,
      memberId: deposit.memberId,
      providerId: deposit.providerId,
      amountMinor: deposit.amountMinor,
      currency: deposit.currency,
      correlationId: deposit.correlationId,
    });
    return this.deposits.markCredited(deposit.id, ledgerTransactionId);
  }

  private async requireOwnedDeposit(memberId: string, depositId: string): Promise<Deposit> {
    const deposit = await this.deposits.findById(depositId);
    if (!deposit || deposit.memberId !== memberId) {
      throw new DepositError("NOT_FOUND", "Deposit not found");
    }
    return deposit;
  }
}

export function depositFingerprint(input: {
  memberId: string;
  methodCode: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        memberId: input.memberId,
        methodCode: input.methodCode,
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
      }),
    )
    .digest("hex");
}
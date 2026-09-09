import type {
  GetDepositStatusInput,
  GetDepositStatusResult,
  InitiateDepositInput,
  InitiateDepositResult,
  PaymentProviderAdapter,
  PaymentProviderFailure,
  PaymentProviderOperationIdentity,
} from "../application/payment-provider.adapter";
import {
  PaymentProviderAdapterError,
} from "../application/payment-provider.adapter";
import {
  createNormalizedPaymentProviderResult,
  type NormalizedPaymentProviderResult,
  type PaymentProviderOutcome,
} from "../domain/payment-provider-result";

export interface DeterministicPaymentScenario {
  /** Outcome returned synchronously by initiateDeposit. */
  outcome?: PaymentProviderOutcome;
  /**
   * When set, initiateDeposit fails with this classified failure before
   * returning a result (e.g. an AMBIGUOUS_OUTCOME). The Deposit is recorded as
   * REVIEW_REQUIRED and never credited until getDepositStatus resolves it.
   */
  startFailure?: PaymentProviderFailure;
  /**
   * Outcome returned by getDepositStatus on a later recovery/status query. When
   * absent the stored outcome is reused. Use this to drive PENDING -> APPROVED
   * or REVIEW_REQUIRED -> APPROVED recovery in deterministic tests.
   */
  resolveOutcome?: PaymentProviderOutcome;
}

interface StoredOperation {
  depositId: string;
  providerId: string;
  providerReferenceKey: string;
  providerTransactionId: string | null;
  currentResult: NormalizedPaymentProviderResult | null;
  resolveOutcome?: PaymentProviderOutcome;
}

/**
 * Deterministic in-memory payment provider (Ticket 09 deterministic fake/sandbox
 * for the Deposit vertical). Scenarios are keyed by provider code; provider
 * reference keys identify logical operations so a transport timeout never
 * creates a fresh external operation identity on retry. No production payment
 * provider is wired yet, so this fake is the default binding and a single
 * source of deterministic truth for tests.
 */
export class DeterministicPaymentProviderFake implements PaymentProviderAdapter {
  private readonly operations = new Map<string, StoredOperation>();
  private initiateCalls = 0;

  constructor(
    private readonly scenarios: Readonly<Record<string, DeterministicPaymentScenario>> = {},
  ) {}

  /** Number of times initiateDeposit was invoked (retries must not re-initiate). */
  get initiateCallCount(): number {
    return this.initiateCalls;
  }

  async initiateDeposit(
    input: InitiateDepositInput,
  ): Promise<InitiateDepositResult> {
    this.initiateCalls += 1;
    const replay = this.operations.get(input.providerReferenceKey);
    if (replay) {
      return { identity: this.identity(input, replay), result: this.requireResult(replay) };
    }

    const scenario = this.scenarios[input.providerCode];
    if (!scenario) {
      throw new PaymentProviderAdapterError(
        "No deterministic payment provider scenario configured",
        { category: "INTEGRATION_CONTRACT_ERROR", retryable: false, evidenceRefs: [] },
      );
    }

    const operation: StoredOperation = {
      depositId: input.depositId,
      providerId: input.providerId,
      providerReferenceKey: input.providerReferenceKey,
      providerTransactionId: null,
      currentResult: null,
      resolveOutcome: scenario.resolveOutcome,
    };
    if (scenario.startFailure) {
      this.operations.set(input.providerReferenceKey, operation);
      throw new PaymentProviderAdapterError(
        "Deterministic payment provider start failure",
        scenario.startFailure,
      );
    }

    const result = createNormalizedPaymentProviderResult({
      outcome: scenario.outcome ?? "APPROVED",
    });
    operation.currentResult = result;
    operation.providerTransactionId = `dep-provider-txn:${input.providerReferenceKey}`;
    this.operations.set(input.providerReferenceKey, operation);
    return { identity: this.identity(input, operation), result };
  }

  async getDepositStatus(
    input: GetDepositStatusInput,
  ): Promise<GetDepositStatusResult> {
    const operation = this.operations.get(input.providerReferenceKey);
    if (!operation) {
      throw new PaymentProviderAdapterError(
        "Unknown deterministic payment provider transaction",
        { category: "DEFINITIVE_FAILURE", retryable: false, evidenceRefs: [] },
      );
    }
    if (
      input.providerTransactionId !== undefined &&
      operation.providerTransactionId !== null &&
      input.providerTransactionId !== operation.providerTransactionId
    ) {
      throw new PaymentProviderAdapterError(
        "Payment provider transaction identity does not match",
        { category: "INTEGRATION_CONTRACT_ERROR", retryable: false, evidenceRefs: [] },
      );
    }

    if (operation.resolveOutcome) {
      operation.currentResult = createNormalizedPaymentProviderResult({
        outcome: operation.resolveOutcome,
      });
      operation.providerTransactionId =
        operation.providerTransactionId ?? `dep-provider-txn:${input.providerReferenceKey}`;
    }

    return {
      identity: this.identity(input, operation),
      result: this.requireResult(operation),
    };
  }

  private requireResult(operation: StoredOperation): NormalizedPaymentProviderResult {
    if (!operation.currentResult) {
      // No synchronous result was established (ambiguous start that has not
      // yet been resolved): status recovery is the only safe path.
      throw new PaymentProviderAdapterError(
        "Deterministic payment provider operation is ambiguous and unresolved",
        { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
      );
    }
    return operation.currentResult;
  }

  private identity(
    input: {
      depositId: string;
      providerId: string;
      providerReferenceKey: string;
      requestAttemptId: string;
      correlationId: string;
    },
    operation: StoredOperation,
  ): PaymentProviderOperationIdentity {
    return {
      depositId: operation.depositId,
      providerId: operation.providerId,
      providerTransactionId: operation.providerTransactionId,
      providerReferenceKey: operation.providerReferenceKey,
      requestAttemptId: input.requestAttemptId,
      correlationId: input.correlationId,
    };
  }
}
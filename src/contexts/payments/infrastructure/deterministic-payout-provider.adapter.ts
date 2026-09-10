import type {
  GetPayoutStatusInput,
  GetPayoutStatusResult,
  InitiatePayoutInput,
  InitiatePayoutResult,
  PayoutProviderAdapter,
} from "../application/payout-provider.adapter";
import {
  PayoutProviderAdapterError,
} from "../application/payout-provider.adapter";
import type { PaymentProviderFailure, PaymentProviderOperationIdentity } from "../application/payment-provider.adapter";
import {
  createNormalizedPaymentProviderResult,
  type NormalizedPaymentProviderResult,
  type PaymentProviderOutcome,
} from "../domain/payment-provider-result";

export interface DeterministicPayoutScenario {
  /** Outcome returned synchronously by initiatePayout. */
  outcome?: PaymentProviderOutcome;
  /**
   * When set, initiatePayout fails with this classified failure before returning
   * a result (e.g. an AMBIGUOUS_OUTCOME). The Withdrawal enters `RECONCILING`
   * with the Reservation retained and is never blindly retried.
   */
  startFailure?: PaymentProviderFailure;
  /**
   * Outcome returned by getPayoutStatus on a later reconciliation. When absent
   * the stored outcome is reused. Use this to drive
   * PAYOUT_PROCESSING -> PAYOUT_CONFIRMED or RECONCILING -> FAILED recovery.
   */
  resolveOutcome?: PaymentProviderOutcome;
}

interface StoredPayoutOperation {
  withdrawalId: string;
  providerId: string;
  providerReferenceKey: string;
  providerTransactionId: string | null;
  currentResult: NormalizedPaymentProviderResult | null;
  resolveOutcome?: PaymentProviderOutcome;
}

/**
 * Deterministic in-memory payout provider (Ticket 09 deterministic
 * fake/sandbox for the Withdrawal vertical). Scenarios are keyed by provider
 * code; provider reference keys identify logical payout operations so a
 * transport timeout never creates a fresh external operation identity. No
 * production payout provider is wired yet, so this fake is the default binding
 * and a single source of deterministic truth for tests.
 */
export class DeterministicPayoutProviderFake implements PayoutProviderAdapter {
  private readonly operations = new Map<string, StoredPayoutOperation>();
  private initiateCalls = 0;

  constructor(
    private readonly scenarios: Readonly<Record<string, DeterministicPayoutScenario>> = {},
  ) {}

  /** Number of times initiatePayout was invoked (a reconcile must not re-initiate). */
  get initiateCallCount(): number {
    return this.initiateCalls;
  }

  async initiatePayout(input: InitiatePayoutInput): Promise<InitiatePayoutResult> {
    this.initiateCalls += 1;
    const replay = this.operations.get(input.providerReferenceKey);
    if (replay) {
      return { identity: this.identity(input, replay), result: this.requireResult(replay) };
    }

    const scenario = this.scenarios[input.providerId];
    if (!scenario) {
      throw new PayoutProviderAdapterError("No deterministic payout provider scenario configured", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }

    const operation: StoredPayoutOperation = {
      withdrawalId: input.withdrawalId,
      providerId: input.providerId,
      providerReferenceKey: input.providerReferenceKey,
      providerTransactionId: null,
      currentResult: null,
      resolveOutcome: scenario.resolveOutcome,
    };

    if (scenario.startFailure) {
      this.operations.set(input.providerReferenceKey, operation);
      throw new PayoutProviderAdapterError(
        "Deterministic payout provider start failure",
        scenario.startFailure,
      );
    }

    const result = createNormalizedPaymentProviderResult({
      outcome: scenario.outcome ?? "APPROVED",
    });
    operation.currentResult = result;
    operation.providerTransactionId = `payout-provider-txn:${input.providerReferenceKey}`;
    this.operations.set(input.providerReferenceKey, operation);
    return { identity: this.identity(input, operation), result };
  }

  async getPayoutStatus(input: GetPayoutStatusInput): Promise<GetPayoutStatusResult> {
    const operation = this.operations.get(input.providerReferenceKey);
    if (!operation) {
      throw new PayoutProviderAdapterError("Unknown deterministic payout provider transaction", {
        category: "DEFINITIVE_FAILURE",
        retryable: false,
        evidenceRefs: [],
      });
    }
    if (
      input.providerTransactionId !== undefined &&
      operation.providerTransactionId !== null &&
      input.providerTransactionId !== operation.providerTransactionId
    ) {
      throw new PayoutProviderAdapterError("Payout provider transaction identity does not match", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }

    if (operation.resolveOutcome) {
      operation.currentResult = createNormalizedPaymentProviderResult({
        outcome: operation.resolveOutcome,
      });
      operation.providerTransactionId =
        operation.providerTransactionId ?? `payout-provider-txn:${input.providerReferenceKey}`;
    }

    return {
      identity: this.identity(input, operation),
      result: this.requireResult(operation),
    };
  }

  private requireResult(operation: StoredPayoutOperation): NormalizedPaymentProviderResult {
    if (!operation.currentResult) {
      // No synchronous result was established (ambiguous start that has not been
      // resolved yet): reconciliation is the only safe path.
      throw new PayoutProviderAdapterError(
        "Deterministic payout provider operation is ambiguous and unresolved",
        { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
      );
    }
    return operation.currentResult;
  }

  private identity(
    input: {
      withdrawalId: string;
      providerId: string;
      providerReferenceKey: string;
      requestAttemptId: string;
      correlationId: string;
    },
    operation: StoredPayoutOperation,
  ): PaymentProviderOperationIdentity {
    return {
      depositId: operation.withdrawalId,
      providerId: operation.providerId,
      providerTransactionId: operation.providerTransactionId,
      providerReferenceKey: operation.providerReferenceKey,
      requestAttemptId: input.requestAttemptId,
      correlationId: input.correlationId,
    };
  }
}

import {
  KycProviderAdapterError,
  type GetKycVerificationStatusInput,
  type GetKycVerificationStatusResult,
  type KycProviderAdapter,
  type KycProviderFailure,
  type KycProviderWebhookInput,
  type KycProviderWebhookResult,
  type StartKycVerificationInput,
  type StartKycVerificationResult,
} from "../../src/contexts/kyc-risk/application/kyc-provider.adapter";
import {
  createNormalizedKycProviderResult,
  type KycProviderOutcome,
} from "../../src/contexts/kyc-risk/domain/kyc-provider-result";

interface DeterministicKycScenario {
  outcome: KycProviderOutcome;
  evidenceRefs?: readonly string[];
  startFailure?: KycProviderFailure;
}

interface StoredOperation {
  verificationCaseId: string;
  providerId: string;
  providerReferenceKey: string;
  providerTransactionId: string;
  result: ReturnType<typeof createNormalizedKycProviderResult>;
  unresolvedStartFailure: KycProviderFailure | null;
}

interface DeterministicWebhookPayload {
  eventId: string;
  providerTransactionId: string;
  outcome: KycProviderOutcome;
  evidenceRefs?: readonly string[];
}

export class DeterministicKycProviderFake implements KycProviderAdapter {
  private readonly operationsByReferenceKey = new Map<string, StoredOperation>();
  private readonly operationsByTransactionId = new Map<string, StoredOperation>();
  private readonly processedWebhookEvents = new Map<string, KycProviderWebhookResult>();

  constructor(
    private readonly scenarios: Readonly<Record<string, DeterministicKycScenario>>,
  ) {}

  async startVerification(
    input: StartKycVerificationInput,
  ): Promise<StartKycVerificationResult> {
    const existing = this.operationsByReferenceKey.get(input.providerReferenceKey);
    if (existing) {
      this.assertSameLogicalOperation(existing, input);
      if (existing.unresolvedStartFailure) {
        throw new KycProviderAdapterError(
          "Deterministic KYC provider start remains ambiguous until status recovery",
          existing.unresolvedStartFailure,
        );
      }
      return {
        identity: this.operationIdentity(
          existing,
          input.requestAttemptId,
          input.correlationId,
        ),
        result: existing.result,
      };
    }

    const scenario = this.scenarios[input.verificationCaseId];
    if (!scenario) {
      throw new KycProviderAdapterError("No deterministic KYC scenario configured", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }

    const operation: StoredOperation = {
      verificationCaseId: input.verificationCaseId,
      providerId: input.providerId,
      providerReferenceKey: input.providerReferenceKey,
      providerTransactionId: `kyc-provider-txn:${input.providerReferenceKey}`,
      result: createNormalizedKycProviderResult({
        outcome: scenario.outcome,
        evidenceRefs: scenario.evidenceRefs,
      }),
      unresolvedStartFailure:
        scenario.startFailure?.category === "AMBIGUOUS_OUTCOME"
          ? scenario.startFailure
          : null,
    };

    if (scenario.startFailure?.category !== "AMBIGUOUS_OUTCOME") {
      if (scenario.startFailure) {
        throw new KycProviderAdapterError(
          "Deterministic KYC provider start failure",
          scenario.startFailure,
        );
      }
    }

    this.operationsByReferenceKey.set(input.providerReferenceKey, operation);
    this.operationsByTransactionId.set(operation.providerTransactionId, operation);

    if (operation.unresolvedStartFailure) {
      throw new KycProviderAdapterError(
        "Deterministic KYC provider start failure",
        operation.unresolvedStartFailure,
      );
    }

    return {
      identity: this.operationIdentity(
        operation,
        input.requestAttemptId,
        input.correlationId,
      ),
      result: operation.result,
    };
  }

  async getVerificationStatus(
    input: GetKycVerificationStatusInput,
  ): Promise<GetKycVerificationStatusResult> {
    const byReference = this.operationsByReferenceKey.get(input.providerReferenceKey);
    const operation = input.providerTransactionId
      ? this.operationsByTransactionId.get(input.providerTransactionId)
      : byReference;
    if (!operation) {
      throw new KycProviderAdapterError("Unknown deterministic KYC provider transaction", {
        category: "DEFINITIVE_FAILURE",
        retryable: false,
        evidenceRefs: [],
      });
    }

    this.assertSameLogicalOperation(operation, input);
    if (
      input.providerTransactionId !== undefined &&
      operation.providerTransactionId !== input.providerTransactionId
    ) {
      throw new KycProviderAdapterError("KYC provider transaction identity does not match", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }
    operation.unresolvedStartFailure = null;

    return {
      identity: this.operationIdentity(
        operation,
        input.requestAttemptId,
        input.correlationId,
      ),
      result: operation.result,
    };
  }

  async verifyAndNormalizeWebhook(
    input: KycProviderWebhookInput,
  ): Promise<KycProviderWebhookResult> {
    if (input.headers["x-deterministic-kyc-signature"] !== "valid") {
      throw new KycProviderAdapterError("KYC provider webhook authenticity check failed", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }
    if (input.headers["x-deterministic-kyc-timestamp-valid"] !== "true") {
      throw new KycProviderAdapterError("KYC provider webhook timestamp tolerance check failed", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }

    const payload = this.parseWebhookPayload(input.rawBody);
    const existing = this.processedWebhookEvents.get(payload.eventId);
    if (existing) {
      return {
        ...existing,
        validation: { ...existing.validation, delivery: "DUPLICATE" },
      };
    }

    const operation = this.operationsByTransactionId.get(payload.providerTransactionId);
    if (!operation || operation.providerId !== input.providerId) {
      throw new KycProviderAdapterError("KYC provider webhook references an unknown transaction", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }

    const result = createNormalizedKycProviderResult({
      outcome: payload.outcome,
      evidenceRefs: payload.evidenceRefs,
    });
    operation.result = result;

    const normalized: KycProviderWebhookResult = {
      providerId: input.providerId,
      providerEventIdentity: payload.eventId,
      providerTransactionId: payload.providerTransactionId,
      validation: {
        authenticity: "VERIFIED",
        timestampTolerance: "VERIFIED",
        delivery: "NEW",
      },
      result,
      evidenceRefs: [...(payload.evidenceRefs ?? [])],
      correlationId: input.correlationId,
    };
    this.processedWebhookEvents.set(payload.eventId, normalized);
    return normalized;
  }

  private assertSameLogicalOperation(
    operation: StoredOperation,
    input: {
      verificationCaseId: string;
      providerId: string;
      providerReferenceKey: string;
    },
  ): void {
    if (
      operation.verificationCaseId !== input.verificationCaseId ||
      operation.providerId !== input.providerId ||
      operation.providerReferenceKey !== input.providerReferenceKey
    ) {
      throw new KycProviderAdapterError(
        "Provider reference key cannot be reused for a different KYC operation",
        {
          category: "INTEGRATION_CONTRACT_ERROR",
          retryable: false,
          evidenceRefs: [],
        },
      );
    }
  }

  private operationIdentity(
    operation: StoredOperation,
    requestAttemptId: string,
    correlationId: string,
  ) {
    return {
      verificationCaseId: operation.verificationCaseId,
      providerId: operation.providerId,
      providerTransactionId: operation.providerTransactionId,
      providerReferenceKey: operation.providerReferenceKey,
      requestAttemptId,
      correlationId,
    };
  }

  private parseWebhookPayload(rawBody: string): DeterministicWebhookPayload {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new KycProviderAdapterError("KYC provider webhook payload is invalid", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }

    if (!isDeterministicWebhookPayload(parsed)) {
      throw new KycProviderAdapterError("KYC provider webhook payload is invalid", {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
        evidenceRefs: [],
      });
    }

    return parsed;
  }
}

function isDeterministicWebhookPayload(
  value: unknown,
): value is DeterministicWebhookPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.eventId === "string" &&
    typeof candidate.providerTransactionId === "string" &&
    typeof candidate.outcome === "string" &&
    ["VERIFIED", "REJECTED", "REVIEW_REQUIRED", "MORE_INFO_REQUIRED"].includes(
      candidate.outcome,
    ) &&
    (candidate.evidenceRefs === undefined ||
      (Array.isArray(candidate.evidenceRefs) &&
        candidate.evidenceRefs.every((item) => typeof item === "string")))
  );
}

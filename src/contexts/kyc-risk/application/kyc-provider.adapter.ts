import type { NormalizedKycProviderResult } from "../domain/kyc-provider-result";

export const KYC_PROVIDER_FAILURE_CATEGORIES = [
  "TRANSIENT",
  "DEFINITIVE_FAILURE",
  "BUSINESS_REJECTION",
  "AMBIGUOUS_OUTCOME",
  "INTEGRATION_CONTRACT_ERROR",
] as const;

export type KycProviderFailureCategory =
  (typeof KYC_PROVIDER_FAILURE_CATEGORIES)[number];

export const KYC_PROVIDER_FAILURE_RETRYABILITY: Readonly<
  Record<KycProviderFailureCategory, boolean>
> = {
  TRANSIENT: true,
  DEFINITIVE_FAILURE: false,
  BUSINESS_REJECTION: false,
  AMBIGUOUS_OUTCOME: false,
  INTEGRATION_CONTRACT_ERROR: false,
};

export interface KycProviderFailure {
  category: KycProviderFailureCategory;
  retryable: boolean;
  evidenceRefs: readonly string[];
}

export interface KycProviderOperationIdentity {
  verificationCaseId: string;
  providerId: string;
  providerTransactionId: string;
  providerReferenceKey: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface StartKycVerificationInput {
  verificationCaseId: string;
  providerId: string;
  providerReferenceKey: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface StartKycVerificationResult {
  identity: KycProviderOperationIdentity;
  result: NormalizedKycProviderResult;
}

export interface GetKycVerificationStatusInput {
  verificationCaseId: string;
  providerId: string;
  providerTransactionId?: string;
  providerReferenceKey: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface GetKycVerificationStatusResult {
  identity: KycProviderOperationIdentity;
  result: NormalizedKycProviderResult;
}

export interface KycProviderWebhookInput {
  providerId: string;
  rawBody: string;
  headers: Readonly<Record<string, string | undefined>>;
  receivedAt: Date;
  correlationId: string;
}

export interface KycProviderWebhookResult {
  providerId: string;
  providerEventIdentity: string;
  providerTransactionId: string;
  validation: {
    authenticity: "VERIFIED";
    timestampTolerance: "VERIFIED";
    delivery: "NEW" | "DUPLICATE";
  };
  result: NormalizedKycProviderResult;
  evidenceRefs: readonly string[];
  correlationId: string;
}

export interface KycProviderAdapter {
  startVerification(
    input: StartKycVerificationInput,
  ): Promise<StartKycVerificationResult>;

  getVerificationStatus(
    input: GetKycVerificationStatusInput,
  ): Promise<GetKycVerificationStatusResult>;

  verifyAndNormalizeWebhook(
    input: KycProviderWebhookInput,
  ): Promise<KycProviderWebhookResult>;
}

export class KycProviderAdapterError extends Error {
  readonly failure: KycProviderFailure;

  constructor(message: string, failure: KycProviderFailure) {
    super(message);
    this.name = "KycProviderAdapterError";
    if (
      failure.retryable !== KYC_PROVIDER_FAILURE_RETRYABILITY[failure.category]
    ) {
      throw new Error(
        `KYC provider failure ${failure.category} has invalid retryability`,
      );
    }
    this.failure = {
      ...failure,
      evidenceRefs: [...failure.evidenceRefs],
    };
  }
}

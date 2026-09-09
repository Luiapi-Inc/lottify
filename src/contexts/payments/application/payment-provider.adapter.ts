import type { NormalizedPaymentProviderResult, PaymentCurrency } from "../domain/payment-provider-result";

export const PAYMENT_PROVIDER_FAILURE_CATEGORIES = [
  "TRANSIENT",
  "DEFINITIVE_FAILURE",
  "BUSINESS_REJECTION",
  "AMBIGUOUS_OUTCOME",
  "INTEGRATION_CONTRACT_ERROR",
] as const;

export type PaymentProviderFailureCategory =
  (typeof PAYMENT_PROVIDER_FAILURE_CATEGORIES)[number];

export const PAYMENT_PROVIDER_FAILURE_RETRYABILITY: Readonly<
  Record<PaymentProviderFailureCategory, boolean>
> = {
  TRANSIENT: true,
  DEFINITIVE_FAILURE: false,
  BUSINESS_REJECTION: false,
  AMBIGUOUS_OUTCOME: false,
  INTEGRATION_CONTRACT_ERROR: false,
};

export interface PaymentProviderFailure {
  category: PaymentProviderFailureCategory;
  retryable: boolean;
  evidenceRefs: readonly string[];
}

export interface PaymentProviderOperationIdentity {
  depositId: string;
  providerId: string;
  providerTransactionId: string | null;
  providerReferenceKey: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface InitiateDepositInput {
  depositId: string;
  providerId: string;
  providerCode: string;
  methodCode: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
  providerReferenceKey: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface InitiateDepositResult {
  identity: PaymentProviderOperationIdentity;
  result: NormalizedPaymentProviderResult;
}

export interface GetDepositStatusInput {
  depositId: string;
  providerId: string;
  providerReferenceKey: string;
  providerTransactionId?: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface GetDepositStatusResult {
  identity: PaymentProviderOperationIdentity;
  result: NormalizedPaymentProviderResult;
}

/**
 * Canonical deposit-provider adapter contract (Ticket 09). External payment
 * providers are hidden behind this domain-owned seam; vendor-native statuses and
 * errors are normalized before they can influence the Deposit workflow. An
 * AMBIGUOUS_OUTCOME is never a definitive failure: the owning workflow must
 * reconcile via getDepositStatus before crediting or retrying the side effect.
 */
export interface PaymentProviderAdapter {
  initiateDeposit(input: InitiateDepositInput): Promise<InitiateDepositResult>;
  getDepositStatus(input: GetDepositStatusInput): Promise<GetDepositStatusResult>;
}

export const PAYMENT_PROVIDER_ADAPTER = Symbol("PAYMENT_PROVIDER_ADAPTER");

export class PaymentProviderAdapterError extends Error {
  readonly failure: PaymentProviderFailure;

  constructor(message: string, failure: PaymentProviderFailure) {
    super(message);
    this.name = "PaymentProviderAdapterError";
    if (failure.retryable !== PAYMENT_PROVIDER_FAILURE_RETRYABILITY[failure.category]) {
      throw new Error(
        `Payment provider failure ${failure.category} has invalid retryability`,
      );
    }
    this.failure = {
      ...failure,
      evidenceRefs: [...failure.evidenceRefs],
    };
  }
}
import type {
  PaymentProviderFailure,
  PaymentProviderOperationIdentity,
} from "./payment-provider.adapter";
import type { NormalizedPaymentProviderResult, PaymentCurrency } from "../domain/payment-provider-result";

export interface InitiatePayoutInput {
  withdrawalId: string;
  providerId: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
  destinationReference: string;
  providerReferenceKey: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface InitiatePayoutResult {
  identity: PaymentProviderOperationIdentity;
  result: NormalizedPaymentProviderResult;
}

export interface GetPayoutStatusInput {
  withdrawalId: string;
  providerId: string;
  providerReferenceKey: string;
  providerTransactionId?: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface GetPayoutStatusResult {
  identity: PaymentProviderOperationIdentity;
  result: NormalizedPaymentProviderResult;
}

/**
 * Canonical payout-provider adapter contract (Ticket 09). Payout providers are
 * hidden behind this domain-owned seam; vendor-native payout statuses and errors
 * are normalized before they can influence the Withdrawal workflow.
 *
 * An AMBIGUOUS_OUTCOME is never a definitive failure: the owning workflow keeps
 * the Reservation and enters reconciliation via `getPayoutStatus` until the
 * external side effect is proven. A blind payout retry is forbidden.
 */
export interface PayoutProviderAdapter {
  initiatePayout(input: InitiatePayoutInput): Promise<InitiatePayoutResult>;
  getPayoutStatus(input: GetPayoutStatusInput): Promise<GetPayoutStatusResult>;
}

export const PAYOUT_PROVIDER_ADAPTER = Symbol("PAYOUT_PROVIDER_ADAPTER");

export class PayoutProviderAdapterError extends Error {
  readonly failure: PaymentProviderFailure;

  constructor(message: string, failure: PaymentProviderFailure) {
    super(message);
    this.name = "PayoutProviderAdapterError";
    this.failure = { ...failure, evidenceRefs: [...failure.evidenceRefs] };
  }
}

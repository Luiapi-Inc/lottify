export const PAYMENT_CURRENCIES = ["THB"] as const;

export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];

export const PAYMENT_PROVIDER_OUTCOMES = ["PENDING", "APPROVED", "REJECTED"] as const;

export type PaymentProviderOutcome = (typeof PAYMENT_PROVIDER_OUTCOMES)[number];

export interface NormalizedPaymentProviderResult {
  outcome: PaymentProviderOutcome;
  evidenceRefs: readonly string[];
}

/**
 * Builds the normalized, deterministic provider result a deposit workflow may
 * explain to members and persist. Provider-native statuses never become
 * canonical business states directly (Ticket 09, provider/async round 1).
 */
export function createNormalizedPaymentProviderResult(input: {
  outcome: PaymentProviderOutcome;
  evidenceRefs?: readonly string[];
}): NormalizedPaymentProviderResult {
  if (!PAYMENT_PROVIDER_OUTCOMES.includes(input.outcome)) {
    throw new Error(`Unknown payment provider outcome: ${String(input.outcome)}`);
  }
  return {
    outcome: input.outcome,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
  };
}
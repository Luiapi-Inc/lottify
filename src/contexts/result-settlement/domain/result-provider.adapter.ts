// Result provider adapter boundary (Wayfinder Issue 09).
//
// The Result & Settlement context owns result intake, but the source of the
// winning data is an external provider. Like every provider in v1, it is hidden
// behind a domain-owned adapter so settlement never depends on vendor payloads
// or status codes. The adapter normalizes a provider result into the canonical
// Product-shaped payload plus its schema/source references; vendor-native
// shapes never become business state directly.
//
// The v1 deterministic test adapter (deterministic-result-provider.fake.ts)
// implements this port so integration evidence can drive matching, mismatch and
// correction scenarios without an external dependency.

import type { WinningNumbers } from "./result-revision";

export const RESULT_PROVIDER_ADAPTER = Symbol("RESULT_PROVIDER_ADAPTER");

/** Canonical error taxonomy per Ticket 09 provider round 3. */
export type ResultProviderErrorCategory =
  | "TRANSIENT"
  | "DEFINITIVE_FAILURE"
  | "BUSINESS_REJECTION"
  | "AMBIGUOUS_OUTCOME"
  | "INTEGRATION_CONTRACT_ERROR";

export class ResultProviderAdapterError extends Error {
  readonly category: ResultProviderErrorCategory;
  constructor(category: ResultProviderErrorCategory, message: string) {
    super(message);
    this.name = "ResultProviderAdapterError";
    this.category = category;
  }
}

export interface ResultProviderResult {
  /** Provider + provider-transaction identity for the source evidence. */
  readonly identity: {
    readonly providerId: string;
    readonly providerTransactionId: string | null;
  };
  readonly result: {
    /** Normalized `{ betTypeCode: winningCanonicalNumber }` for evaluation. */
    readonly winningNumbers: WinningNumbers;
    readonly resultSchemaVersionRef: string;
    /** Opaque reference retained as provider evidence. */
    readonly providerEvidenceRef: string | null;
  };
}

export interface ResultProviderAdapter {
  /**
   * Fetch the authoritative winning data for a Draw by its result source
   * reference. The provider may return a definitive result, a business
   * rejection, or throw a classified adapter error (an unclassified throw is
   * treated by the caller as AMBIGUOUS_OUTCOME and never auto-settled).
   */
  fetchResult(input: {
    readonly drawId: string;
    readonly resultSourceRef: string | null;
    readonly correlationId: string;
  }): Promise<ResultProviderResult>;
}

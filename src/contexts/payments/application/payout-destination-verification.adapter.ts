import type { PayoutDestinationType } from "../domain/payout-destination";

export const PAYOUT_DESTINATION_VERIFICATION_OUTCOMES = [
  "VERIFIED",
  "REJECTED",
  "PENDING",
] as const;

export type PayoutDestinationVerificationOutcome =
  (typeof PAYOUT_DESTINATION_VERIFICATION_OUTCOMES)[number];

export interface PayoutDestinationVerificationRequest {
  destinationId: string;
  memberId: string;
  type: PayoutDestinationType;
  bankCode: string;
  accountDigest: string;
  accountHolderName: string;
  requestAttemptId: string;
  correlationId: string;
}

export interface PayoutDestinationVerificationResult {
  outcome: PayoutDestinationVerificationOutcome;
  evidenceRef: string;
  providerId: string;
}

/**
 * Payout Destination verification seam. Verification is owned by KYC/Risk
 * policy and is independent of Member/KYC status (Ticket 06); this adapter is
 * the Payments-side boundary that requests verification evidence and receives
 * only the normalized outcome plus an opaque evidence reference. The raw
 * destination account reference is never sent beyond this boundary by the
 * caller: only the opaque digest identifies it.
 */
export interface PayoutDestinationVerificationAdapter {
  verify(
    input: PayoutDestinationVerificationRequest,
  ): Promise<PayoutDestinationVerificationResult>;
}

export const PAYOUT_DESTINATION_VERIFICATION_ADAPTER = Symbol(
  "PAYOUT_DESTINATION_VERIFICATION_ADAPTER",
);

export class PayoutDestinationVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutDestinationVerificationError";
  }
}

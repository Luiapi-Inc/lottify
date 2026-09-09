import type {
  PaymentCurrency,
  PaymentProviderOutcome,
} from "./payment-provider-result";

export const DEPOSIT_STATUSES = [
  "INITIATED",
  "PENDING",
  "REVIEW_REQUIRED",
  "COMPLETED",
  "REJECTED",
] as const;

export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export interface Deposit {
  id: string;
  memberId: string;
  providerId: string;
  providerCode: string;
  methodCode: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
  status: DepositStatus;
  idempotencyScope: string;
  idempotencyKey: string;
  fingerprint: string;
  providerReferenceKey: string;
  providerTransactionId: string | null;
  requestAttemptId: string | null;
  correlationId: string;
  ledgerTransactionId: string | null;
  incomingProviderError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DEPOSIT_CORRIDOR_PROVIDER = "corridor";

export const DEPOSIT_ERROR_CODES = [
  "IDEMPOTENCY_CONFLICT",
  "NOT_FOUND",
  "INVALID",
] as const;

export type DepositErrorCode = (typeof DEPOSIT_ERROR_CODES)[number];

export class DepositError extends Error {
  readonly code: DepositErrorCode;

  constructor(code: DepositErrorCode, message: string) {
    super(message);
    this.name = "DepositError";
    this.code = code;
  }
}

export function validateDepositInitiation(input: {
  providerCode: string;
  methodCode: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
}): void {
  if (!input.providerCode.trim()) {
    throw new Error("Deposit provider code is required");
  }
  if (!input.methodCode.trim()) {
    throw new Error("Deposit payment method code is required");
  }
  if (input.amountMinor <= 0n) {
    throw new Error("Deposit amount must be a positive integer in minor units");
  }
}

/**
 * Maps a normalized provider outcome to the Deposit lifecycle status. Only an
 * APPROVED outcome can credit the Wallet; PENDING waits for a callback/status
 * query and REJECTED is a definitive denial with no posting.
 */
export function depositStatusForProviderOutcome(
  outcome: PaymentProviderOutcome,
): DepositStatus {
  switch (outcome) {
    case "APPROVED":
      return "COMPLETED";
    case "REJECTED":
      return "REJECTED";
    case "PENDING":
      return "PENDING";
  }
}

export function depositIsOpenForResolution(status: DepositStatus): boolean {
  return status === "PENDING" || status === "REVIEW_REQUIRED" || status === "INITIATED";
}
import { createHash } from "node:crypto";
import type { PaymentCurrency } from "./payment-provider-result";

export const PAYOUT_DESTINATION_TYPES = ["BANK_ACCOUNT"] as const;

export type PayoutDestinationType = (typeof PAYOUT_DESTINATION_TYPES)[number];

export const PAYOUT_DESTINATION_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;

export type PayoutDestinationStatus = (typeof PAYOUT_DESTINATION_STATUSES)[number];

export interface PayoutDestination {
  id: string;
  memberId: string;
  type: PayoutDestinationType;
  bankCode: string;
  accountNumberMasked: string;
  accountDigest: string;
  accountHolderName: string;
  currency: PaymentCurrency;
  status: PayoutDestinationStatus;
  verificationEvidenceRef: string | null;
  verifiedAt: Date | null;
  disabledAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const PAYOUT_DESTINATION_ERROR_CODES = [
  "INVALID",
  "NOT_FOUND",
  "DUPLICATE",
  "SHARED_DESTINATION_BLOCKED",
  "STATE_CONFLICT",
  "VERSION_CONFLICT",
] as const;

export type PayoutDestinationErrorCode = (typeof PAYOUT_DESTINATION_ERROR_CODES)[number];

export class PayoutDestinationError extends Error {
  readonly code: PayoutDestinationErrorCode;

  constructor(code: PayoutDestinationErrorCode, message: string) {
    super(message);
    this.name = "PayoutDestinationError";
    this.code = code;
  }
}

const ACCOUNT_NUMBER_PATTERN = /^\d{6,34}$/;

/**
 * Normalizes the destination account reference before it is validated, hashed
 * and masked. The raw reference is never persisted or returned.
 */
export function normalizeAccountNumber(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function validatePayoutDestinationInput(input: {
  type: PayoutDestinationType;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  currency: PaymentCurrency;
}): void {
  if (!PAYOUT_DESTINATION_TYPES.includes(input.type)) {
    throw new PayoutDestinationError("INVALID", "Unsupported Payout Destination type");
  }
  if (!input.bankCode.trim()) {
    throw new PayoutDestinationError("INVALID", "Payout Destination bank code is required");
  }
  if (!input.accountHolderName.trim()) {
    throw new PayoutDestinationError("INVALID", "Payout Destination account holder name is required");
  }
  if (!ACCOUNT_NUMBER_PATTERN.test(normalizeAccountNumber(input.accountNumber))) {
    throw new PayoutDestinationError(
      "INVALID",
      "Payout Destination account number must be 6 to 34 digits",
    );
  }
}

/** Member-facing display value; never the full account reference. */
export function maskAccountNumber(accountNumber: string): string {
  const normalized = normalizeAccountNumber(accountNumber);
  if (normalized.length <= 4) return "*".repeat(normalized.length);
  return `${"*".repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}

/**
 * Opaque digest of the destination account reference. Used for duplicate and
 * cross-Member sharing detection without retaining the raw account number.
 */
export function payoutDestinationDigest(input: {
  type: PayoutDestinationType;
  bankCode: string;
  accountNumber: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        type: input.type,
        bankCode: input.bankCode.trim().toUpperCase(),
        accountNumber: normalizeAccountNumber(input.accountNumber),
      }),
      "utf8",
    )
    .digest("hex");
}

/**
 * A Payout Destination is usable for a Withdrawal only while it is verified and
 * not disabled. Verification is independent of Member/KYC status and is
 * rechecked before payout (Ticket 06).
 */
export function payoutDestinationIsUsable(destination: PayoutDestination): boolean {
  return destination.status === "VERIFIED" && destination.disabledAt === null;
}

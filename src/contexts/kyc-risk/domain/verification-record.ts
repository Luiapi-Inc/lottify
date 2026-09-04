export const VERIFICATION_TYPES = [
  "KYC",
  "PHONE",
  "DEVICE",
  "PAYOUT_DESTINATION",
] as const;

export type VerificationType = (typeof VERIFICATION_TYPES)[number];

export interface VerificationRecord {
  type: VerificationType;
  verifiedAt: Date;
  source: string;
  evidenceRefs: readonly string[];
  expiresAt: Date | null;
  reverificationPolicyRef: string | null;
}

export interface CreateVerificationRecordInput {
  type: VerificationType;
  verifiedAt: Date;
  source: string;
  evidenceRefs?: readonly string[];
  expiresAt?: Date | null;
  reverificationPolicyRef?: string | null;
}

export function createVerificationRecord(
  input: CreateVerificationRecordInput,
): VerificationRecord {
  if (
    input.expiresAt !== undefined &&
    input.expiresAt !== null &&
    input.expiresAt.getTime() <= input.verifiedAt.getTime()
  ) {
    throw new Error("Verification expiry must be after verification time");
  }

  return {
    type: input.type,
    verifiedAt: new Date(input.verifiedAt),
    source: input.source,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    expiresAt:
      input.expiresAt === undefined || input.expiresAt === null
        ? null
        : new Date(input.expiresAt),
    reverificationPolicyRef: input.reverificationPolicyRef ?? null,
  };
}

export function isVerificationFresh(
  verification: VerificationRecord,
  at: Date,
): boolean {
  return (
    verification.verifiedAt.getTime() <= at.getTime() &&
    (verification.expiresAt === null ||
      at.getTime() < verification.expiresAt.getTime())
  );
}

export function getFreshVerificationsByType(
  type: VerificationType,
  verifications: readonly VerificationRecord[],
  at: Date,
): VerificationRecord[] {
  return verifications.filter(
    (verification) =>
      verification.type === type && isVerificationFresh(verification, at),
  );
}

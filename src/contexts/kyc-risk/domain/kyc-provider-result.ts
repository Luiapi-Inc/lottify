export const KYC_PROVIDER_OUTCOMES = [
  "VERIFIED",
  "REJECTED",
  "REVIEW_REQUIRED",
  "MORE_INFO_REQUIRED",
] as const;

export type KycProviderOutcome = (typeof KYC_PROVIDER_OUTCOMES)[number];

export interface NormalizedKycProviderResult {
  outcome: KycProviderOutcome;
  evidenceRefs: readonly string[];
}

export interface CreateNormalizedKycProviderResultInput {
  outcome: string;
  evidenceRefs?: readonly string[];
}

export function isKycProviderOutcome(
  outcome: string,
): outcome is KycProviderOutcome {
  return (KYC_PROVIDER_OUTCOMES as readonly string[]).includes(outcome);
}

export function createNormalizedKycProviderResult(
  input: CreateNormalizedKycProviderResultInput,
): NormalizedKycProviderResult {
  if (!isKycProviderOutcome(input.outcome)) {
    throw new Error(
      "KYC provider outcome must be normalized to a canonical Lottify outcome",
    );
  }

  return {
    outcome: input.outcome,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
  };
}

export type KycVerificationCaseProviderState = KycProviderOutcome;

export function kycVerificationCaseStateForProviderOutcome(
  outcome: KycProviderOutcome,
): KycVerificationCaseProviderState {
  return outcome;
}

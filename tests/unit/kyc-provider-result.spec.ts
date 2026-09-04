import { describe, expect, it } from "vitest";
import {
  createNormalizedKycProviderResult,
  isKycProviderOutcome,
  KYC_PROVIDER_OUTCOMES,
  kycVerificationCaseStateForProviderOutcome,
} from "../../src/contexts/kyc-risk/domain/kyc-provider-result";

describe("KYC provider result normalization", () => {
  it("uses only the locked Lottify canonical outcomes", () => {
    expect(KYC_PROVIDER_OUTCOMES).toEqual([
      "VERIFIED",
      "REJECTED",
      "REVIEW_REQUIRED",
      "MORE_INFO_REQUIRED",
    ]);
  });

  it("accepts canonical outcomes with normalized evidence references", () => {
    const evidenceRefs = ["evidence:document-1", "evidence:selfie-1"];

    const result = createNormalizedKycProviderResult({
      outcome: "VERIFIED",
      evidenceRefs,
    });

    evidenceRefs.push("provider:raw-payload");

    expect(result).toEqual({
      outcome: "VERIFIED",
      evidenceRefs: ["evidence:document-1", "evidence:selfie-1"],
    });
  });

  it("rejects vendor-specific statuses at the domain boundary", () => {
    expect(isKycProviderOutcome("approved")).toBe(false);
    expect(() =>
      createNormalizedKycProviderResult({
        outcome: "approved",
        evidenceRefs: ["provider-case:123"],
      }),
    ).toThrow("KYC provider outcome must be normalized");
  });

  it.each(KYC_PROVIDER_OUTCOMES)(
    "maps canonical provider outcome %s to the matching KYC case state",
    (outcome) => {
      expect(kycVerificationCaseStateForProviderOutcome(outcome)).toBe(outcome);
    },
  );
});

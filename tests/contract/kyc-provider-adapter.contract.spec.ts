import { describe, expect, it } from "vitest";
import {
  KYC_PROVIDER_FAILURE_CATEGORIES,
  KYC_PROVIDER_FAILURE_RETRYABILITY,
  KycProviderAdapterError,
} from "../../src/contexts/kyc-risk/application/kyc-provider.adapter";
import { DeterministicKycProviderFake } from "../support/deterministic-kyc-provider.fake";

describe("KYC provider adapter contract", () => {
  it("locks the canonical provider failure taxonomy", () => {
    expect(KYC_PROVIDER_FAILURE_CATEGORIES).toEqual([
      "TRANSIENT",
      "DEFINITIVE_FAILURE",
      "BUSINESS_REJECTION",
      "AMBIGUOUS_OUTCOME",
      "INTEGRATION_CONTRACT_ERROR",
    ]);
    expect(KYC_PROVIDER_FAILURE_RETRYABILITY).toEqual({
      TRANSIENT: true,
      DEFINITIVE_FAILURE: false,
      BUSINESS_REJECTION: false,
      AMBIGUOUS_OUTCOME: false,
      INTEGRATION_CONTRACT_ERROR: false,
    });
  });

  it("normalizes provider start and status lookup without vendor status leakage", async () => {
    const provider = new DeterministicKycProviderFake({
      "verification-case-1": {
        outcome: "REVIEW_REQUIRED",
        evidenceRefs: ["evidence:provider-case-1"],
      },
    });

    const started = await provider.startVerification({
      verificationCaseId: "verification-case-1",
      providerId: "kyc-provider-a",
      providerReferenceKey: "provider-ref-1",
      requestAttemptId: "attempt-1",
      correlationId: "correlation-1",
    });

    const status = await provider.getVerificationStatus({
      verificationCaseId: "verification-case-1",
      providerId: "kyc-provider-a",
      providerTransactionId: started.identity.providerTransactionId,
      providerReferenceKey: "provider-ref-1",
      requestAttemptId: "status-attempt-1",
      correlationId: "correlation-1",
    });

    expect(started.result).toEqual({
      outcome: "REVIEW_REQUIRED",
      evidenceRefs: ["evidence:provider-case-1"],
    });
    expect(status.result).toEqual(started.result);
    expect(status.identity).toMatchObject({
      verificationCaseId: "verification-case-1",
      providerId: "kyc-provider-a",
      providerReferenceKey: "provider-ref-1",
      providerTransactionId: started.identity.providerTransactionId,
      requestAttemptId: "status-attempt-1",
      correlationId: "correlation-1",
    });
  });

  it("reuses the logical provider reference across transport attempts", async () => {
    const provider = new DeterministicKycProviderFake({
      "verification-case-1": { outcome: "VERIFIED" },
    });

    const first = await provider.startVerification({
      verificationCaseId: "verification-case-1",
      providerId: "kyc-provider-a",
      providerReferenceKey: "provider-ref-1",
      requestAttemptId: "attempt-1",
      correlationId: "correlation-1",
    });
    const retry = await provider.startVerification({
      verificationCaseId: "verification-case-1",
      providerId: "kyc-provider-a",
      providerReferenceKey: "provider-ref-1",
      requestAttemptId: "attempt-2",
      correlationId: "correlation-1",
    });

    expect(retry.identity.providerReferenceKey).toBe(first.identity.providerReferenceKey);
    expect(retry.identity.providerTransactionId).toBe(
      first.identity.providerTransactionId,
    );
    expect(retry.identity.requestAttemptId).toBe("attempt-2");
  });

  it("rejects provider reference reuse for a different business operation", async () => {
    const provider = new DeterministicKycProviderFake({
      "verification-case-1": { outcome: "VERIFIED" },
      "verification-case-2": { outcome: "REJECTED" },
    });

    await provider.startVerification({
      verificationCaseId: "verification-case-1",
      providerId: "kyc-provider-a",
      providerReferenceKey: "provider-ref-1",
      requestAttemptId: "attempt-1",
      correlationId: "correlation-1",
    });

    await expect(
      provider.startVerification({
        verificationCaseId: "verification-case-2",
        providerId: "kyc-provider-a",
        providerReferenceKey: "provider-ref-1",
        requestAttemptId: "attempt-2",
        correlationId: "correlation-2",
      }),
    ).rejects.toMatchObject({
      failure: {
        category: "INTEGRATION_CONTRACT_ERROR",
        retryable: false,
      },
    });
  });

  it("requires webhook authenticity and makes duplicate delivery explicit", async () => {
    const provider = new DeterministicKycProviderFake({
      "verification-case-1": { outcome: "MORE_INFO_REQUIRED" },
    });
    const started = await provider.startVerification({
      verificationCaseId: "verification-case-1",
      providerId: "kyc-provider-a",
      providerReferenceKey: "provider-ref-1",
      requestAttemptId: "attempt-1",
      correlationId: "correlation-1",
    });
    const rawBody = JSON.stringify({
      eventId: "event-1",
      providerTransactionId: started.identity.providerTransactionId,
      outcome: "VERIFIED",
      evidenceRefs: ["evidence:webhook-1"],
    });

    await expect(
      provider.verifyAndNormalizeWebhook({
        providerId: "kyc-provider-a",
        rawBody,
        headers: { "x-deterministic-kyc-timestamp-valid": "true" },
        receivedAt: new Date("2026-09-05T00:00:00.000Z"),
        correlationId: "correlation-webhook-1",
      }),
    ).rejects.toBeInstanceOf(KycProviderAdapterError);

    const first = await provider.verifyAndNormalizeWebhook({
      providerId: "kyc-provider-a",
      rawBody,
      headers: {
        "x-deterministic-kyc-signature": "valid",
        "x-deterministic-kyc-timestamp-valid": "true",
      },
      receivedAt: new Date("2026-09-05T00:00:01.000Z"),
      correlationId: "correlation-webhook-1",
    });
    const duplicate = await provider.verifyAndNormalizeWebhook({
      providerId: "kyc-provider-a",
      rawBody,
      headers: {
        "x-deterministic-kyc-signature": "valid",
        "x-deterministic-kyc-timestamp-valid": "true",
      },
      receivedAt: new Date("2026-09-05T00:00:02.000Z"),
      correlationId: "correlation-webhook-1",
    });

    expect(first).toMatchObject({
      providerEventIdentity: "event-1",
      validation: {
        authenticity: "VERIFIED",
        timestampTolerance: "VERIFIED",
        delivery: "NEW",
      },
      result: { outcome: "VERIFIED" },
    });
    expect(duplicate).toEqual({
      ...first,
      validation: { ...first.validation, delivery: "DUPLICATE" },
    });

    const status = await provider.getVerificationStatus({
      verificationCaseId: "verification-case-1",
      providerId: "kyc-provider-a",
      providerTransactionId: started.identity.providerTransactionId,
      providerReferenceKey: "provider-ref-1",
      requestAttemptId: "status-attempt-2",
      correlationId: "correlation-1",
    });
    expect(status.result.outcome).toBe("VERIFIED");
  });

  it("recovers an ambiguous start by known provider reference before retry", async () => {
    const provider = new DeterministicKycProviderFake({
      "verification-case-ambiguous": {
        outcome: "VERIFIED",
        startFailure: {
          category: "AMBIGUOUS_OUTCOME",
          retryable: false,
          evidenceRefs: ["evidence:timeout-after-send"],
        },
      },
    });

    await expect(
      provider.startVerification({
        verificationCaseId: "verification-case-ambiguous",
        providerId: "kyc-provider-a",
        providerReferenceKey: "provider-ref-ambiguous",
        requestAttemptId: "attempt-ambiguous-1",
        correlationId: "correlation-ambiguous-1",
      }),
    ).rejects.toMatchObject({
      failure: {
        category: "AMBIGUOUS_OUTCOME",
        retryable: false,
        evidenceRefs: ["evidence:timeout-after-send"],
      },
    });

    await expect(
      provider.startVerification({
        verificationCaseId: "verification-case-ambiguous",
        providerId: "kyc-provider-a",
        providerReferenceKey: "provider-ref-ambiguous",
        requestAttemptId: "attempt-ambiguous-2",
        correlationId: "correlation-ambiguous-1",
      }),
    ).rejects.toMatchObject({
      failure: { category: "AMBIGUOUS_OUTCOME", retryable: false },
    });

    const recovered = await provider.getVerificationStatus({
      verificationCaseId: "verification-case-ambiguous",
      providerId: "kyc-provider-a",
      providerReferenceKey: "provider-ref-ambiguous",
      requestAttemptId: "status-attempt-ambiguous-1",
      correlationId: "correlation-ambiguous-1",
    });
    expect(recovered.result.outcome).toBe("VERIFIED");

    const safeReplay = await provider.startVerification({
      verificationCaseId: "verification-case-ambiguous",
      providerId: "kyc-provider-a",
      providerReferenceKey: "provider-ref-ambiguous",
      requestAttemptId: "attempt-ambiguous-3",
      correlationId: "correlation-ambiguous-1",
    });
    expect(safeReplay.identity.providerTransactionId).toBe(
      recovered.identity.providerTransactionId,
    );
  });
});

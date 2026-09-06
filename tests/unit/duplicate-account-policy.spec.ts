import { describe, expect, it } from "vitest";
import {
  createDuplicateAccountManualResolutionEvidence,
  resolveDuplicateAccountDecision,
  type DuplicateAccountSignalResult,
  type DuplicateAccountSignalResults,
} from "../../src/contexts/kyc-risk/domain/duplicate-account-policy";

const EVALUATED_AT = new Date("2026-09-06T10:45:00.000Z");

function signal(
  outcome: DuplicateAccountSignalResult["outcome"] = "ALLOW",
  reasonCodes: readonly string[] = [],
  evidenceRefs: readonly string[] = [],
): DuplicateAccountSignalResult {
  return { outcome, reasonCodes, evidenceRefs };
}

function signals(
  overrides: Partial<DuplicateAccountSignalResults> = {},
): DuplicateAccountSignalResults {
  return {
    PHONE: signal(),
    KYC_IDENTITY: signal(),
    PAYOUT_DESTINATION: signal(),
    DEVICE: signal(),
    IP_NETWORK: signal(),
    BEHAVIOR: signal(),
    ...overrides,
  };
}

function resolve(policySignals: DuplicateAccountSignalResults) {
  return resolveDuplicateAccountDecision({
    policyVersion: "duplicate-account:v1",
    evaluatedAt: EVALUATED_AT,
    signals: policySignals,
  });
}

describe("duplicate-account policy", () => {
  it("allows when every weighted signal allows", () => {
    const decision = resolve(signals());

    expect(decision).toEqual({
      outcome: "ALLOW",
      reasonCodes: [],
      policyVersion: "duplicate-account:v1",
      evidenceRefs: [],
      evaluatedAt: EVALUATED_AT,
    });
  });

  it("requires review when a signal requires review", () => {
    const decision = resolve(
      signals({
        PHONE: signal(
          "REVIEW_REQUIRED",
          ["PHONE_MATCH_REVIEW"],
          ["risk-signal:phone-1"],
        ),
      }),
    );

    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.reasonCodes).toEqual(["PHONE_MATCH_REVIEW"]);
    expect(decision.evidenceRefs).toEqual(["risk-signal:phone-1"]);
  });

  it("allows an authoritative strong-match signal to block", () => {
    const decision = resolve(
      signals({
        KYC_IDENTITY: signal(
          "BLOCK",
          ["STRONG_KYC_IDENTITY_MATCH"],
          ["verification-case:kyc-1"],
        ),
        DEVICE: signal("REVIEW_REQUIRED", ["SHARED_DEVICE"]),
      }),
    );

    expect(decision.outcome).toBe("BLOCK");
    expect(decision.reasonCodes).toEqual(["STRONG_KYC_IDENTITY_MATCH"]);
    expect(decision.evidenceRefs).toEqual(["verification-case:kyc-1"]);
  });

  it("never hard-blocks from device and IP/network signals alone", () => {
    const decision = resolve(
      signals({
        DEVICE: signal(
          "BLOCK",
          ["DEVICE_MATCH"],
          ["risk-signal:device-1"],
        ),
        IP_NETWORK: signal(
          "BLOCK",
          ["NETWORK_MATCH"],
          ["risk-signal:network-1"],
        ),
      }),
    );

    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.reasonCodes).toEqual(["DEVICE_MATCH", "NETWORK_MATCH"]);
    expect(decision.evidenceRefs).toEqual([
      "risk-signal:device-1",
      "risk-signal:network-1",
    ]);
  });

  it("requires reason and audit evidence for manual resolution", () => {
    expect(() =>
      createDuplicateAccountManualResolutionEvidence({
        reason: "",
        auditEvidenceRef: "audit:risk-review-1",
      }),
    ).toThrow("requires a reason");

    expect(() =>
      createDuplicateAccountManualResolutionEvidence({
        reason: "Reviewed identity evidence",
        auditEvidenceRef: "",
      }),
    ).toThrow("requires audit evidence");

    expect(
      createDuplicateAccountManualResolutionEvidence({
        reason: "Reviewed identity evidence",
        auditEvidenceRef: "audit:risk-review-1",
      }),
    ).toEqual({
      reason: "Reviewed identity evidence",
      auditEvidenceRef: "audit:risk-review-1",
    });
  });
});

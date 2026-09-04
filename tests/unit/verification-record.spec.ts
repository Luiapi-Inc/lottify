import { describe, expect, it } from "vitest";
import {
  createVerificationRecord,
  getFreshVerificationsByType,
  isVerificationFresh,
} from "../../src/contexts/kyc-risk/domain/verification-record";

const VERIFIED_AT = new Date("2026-09-04T04:00:00.000Z");
const EXPIRES_AT = new Date("2026-09-05T04:00:00.000Z");

describe("verification record freshness", () => {
  it("preserves verification type, provenance, evidence, and reverification policy reference", () => {
    const verification = createVerificationRecord({
      type: "KYC",
      verifiedAt: VERIFIED_AT,
      source: "kyc-provider",
      evidenceRefs: ["evidence:document-1", "evidence:selfie-1"],
      expiresAt: EXPIRES_AT,
      reverificationPolicyRef: "verification-policy:v2",
    });

    expect(verification).toEqual({
      type: "KYC",
      verifiedAt: VERIFIED_AT,
      source: "kyc-provider",
      evidenceRefs: ["evidence:document-1", "evidence:selfie-1"],
      expiresAt: EXPIRES_AT,
      reverificationPolicyRef: "verification-policy:v2",
    });
  });

  it("allows independently non-expiring verification types", () => {
    const verification = createVerificationRecord({
      type: "PHONE",
      verifiedAt: VERIFIED_AT,
      source: "otp-possession-proof",
      evidenceRefs: ["otp-challenge:1"],
    });

    expect(verification.expiresAt).toBeNull();
    expect(verification.reverificationPolicyRef).toBeNull();
    expect(
      isVerificationFresh(
        verification,
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("treats explicit expiry as an exclusive freshness boundary", () => {
    const verification = createVerificationRecord({
      type: "PAYOUT_DESTINATION",
      verifiedAt: VERIFIED_AT,
      source: "payments-verification",
      expiresAt: EXPIRES_AT,
    });

    expect(
      isVerificationFresh(
        verification,
        new Date("2026-09-05T03:59:59.999Z"),
      ),
    ).toBe(true);
    expect(isVerificationFresh(verification, EXPIRES_AT)).toBe(false);
  });

  it("keeps freshness independent across verification types", () => {
    const verifications = [
      createVerificationRecord({
        type: "KYC",
        verifiedAt: VERIFIED_AT,
        source: "kyc-provider",
        expiresAt: new Date("2026-09-04T05:00:00.000Z"),
      }),
      createVerificationRecord({
        type: "PHONE",
        verifiedAt: VERIFIED_AT,
        source: "otp-possession-proof",
      }),
      createVerificationRecord({
        type: "DEVICE",
        verifiedAt: VERIFIED_AT,
        source: "device-policy",
        expiresAt: new Date("2026-09-04T04:15:00.000Z"),
      }),
    ];
    const at = new Date("2026-09-04T04:30:00.000Z");

    expect(getFreshVerificationsByType("KYC", verifications, at)).toHaveLength(1);
    expect(getFreshVerificationsByType("PHONE", verifications, at)).toHaveLength(1);
    expect(getFreshVerificationsByType("DEVICE", verifications, at)).toHaveLength(0);
  });

  it("rejects an expiry that is not after verifiedAt", () => {
    expect(() =>
      createVerificationRecord({
        type: "KYC",
        verifiedAt: VERIFIED_AT,
        source: "kyc-provider",
        expiresAt: VERIFIED_AT,
      }),
    ).toThrow("Verification expiry must be after verification time");
  });
});

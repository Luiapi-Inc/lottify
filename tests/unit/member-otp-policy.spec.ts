import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  PhoneValidationError,
  toSmsProviderMsisdn,
} from "../../src/contexts/identity-access/domain/identity-phone";
import {
  buildMemberOtpPolicy,
  decideOtpRequest,
  decideOtpVerify,
  hashOtpCode,
  isMemberOtpPurpose,
  isMemberOtpSelfServicePurpose,
  MEMBER_OTP_SELF_SERVICE_PURPOSES,
} from "../../src/contexts/identity-access/domain/identity-otp-policy";

describe("member phone normalization", () => {
  it("canonicalizes the phone as the local Thai Member login identity", () => {
    // Operator decision 2026-09-17: `0XXXXXXXXX`, no country code anywhere.
    expect(normalizePhone("0812345678")).toBe("0812345678");
    expect(normalizePhone("081-234-5678")).toBe("0812345678");
    expect(normalizePhone("08 1 234 5678")).toBe("0812345678");
    // International spellings are converted on input, never stored.
    expect(normalizePhone("+66812345678")).toBe("0812345678");
    expect(normalizePhone("66812345678")).toBe("0812345678");
    expect(normalizePhone("(+66)81-234-5678")).toBe("0812345678");
  });

  it("rejects empty, non-Thai and malformed phones", () => {
    expect(() => normalizePhone("")).toThrow(PhoneValidationError);
    expect(() => normalizePhone("   ")).toThrow(PhoneValidationError);
    expect(() => normalizePhone("not-a-phone")).toThrow(PhoneValidationError);
    expect(() => normalizePhone("+14155550123")).toThrow(PhoneValidationError);
    expect(() => normalizePhone("071234567")).toThrow(PhoneValidationError);
    expect(() => normalizePhone("0123456789")).toThrow(PhoneValidationError);
  });

  it("converts to the provider spelling only for the SMS request", () => {
    expect(toSmsProviderMsisdn("0812345678")).toBe("66812345678");
    expect(() => toSmsProviderMsisdn("+66812345678")).toThrow(PhoneValidationError);
  });
});

describe("member OTP purpose", () => {
  it("recognizes the scoped purposes and rejects unknown values", () => {
    expect(isMemberOtpPurpose("REGISTER")).toBe(true);
    expect(isMemberOtpPurpose("PASSWORD_ENROLL")).toBe(true);
    expect(isMemberOtpPurpose("REAUTH")).toBe(true);
    expect(isMemberOtpPurpose("RECOVERY")).toBe(true);
    // CR #141: OTP is no longer a Member login channel, so LOGIN must not be a
    // supported purpose any more.
    expect(isMemberOtpPurpose("LOGIN")).toBe(false);
    expect(isMemberOtpPurpose("PASSWORD_RESET")).toBe(false);
    expect(isMemberOtpPurpose("")).toBe(false);
  });

  it("only exposes non-authenticating purposes to the public OTP channel", () => {
    expect(MEMBER_OTP_SELF_SERVICE_PURPOSES).toEqual(["REGISTER", "PASSWORD_ENROLL"]);
    expect(isMemberOtpSelfServicePurpose("REGISTER")).toBe(true);
    expect(isMemberOtpSelfServicePurpose("PASSWORD_ENROLL")).toBe(true);
    expect(isMemberOtpSelfServicePurpose("LOGIN")).toBe(false);
    expect(isMemberOtpSelfServicePurpose("RECOVERY")).toBe(false);
    expect(isMemberOtpSelfServicePurpose("REAUTH")).toBe(false);
  });

  it("applies the same configured controls to the RECOVERY purpose", () => {
    const policy = buildMemberOtpPolicy("RECOVERY", {
      codeLength: 6,
      ttlSeconds: 300,
      maxAttempts: 3,
      resendCooldownSeconds: 60,
      requestWindowSeconds: 900,
      requestMaxPerWindow: 5,
    });
    expect(policy).toMatchObject({
      purpose: "RECOVERY",
      codeLength: 6,
      ttlSeconds: 300,
      maxAttempts: 3,
      resendCooldownSeconds: 60,
      requestWindowSeconds: 900,
      requestMaxPerWindow: 5,
      policyVersion: "member-otp-v1",
    });
  });
});

describe("member OTP policy binding", () => {
  it("binds the configured control values without allowing a bad purpose", () => {
    const policy = buildMemberOtpPolicy("PASSWORD_ENROLL", {
      codeLength: 6,
      ttlSeconds: 300,
      maxAttempts: 10,
      resendCooldownSeconds: 60,
      requestWindowSeconds: 900,
      requestMaxPerWindow: 5,
    });
    expect(policy.purpose).toBe("PASSWORD_ENROLL");
    expect(policy.policyVersion).toBe("member-otp-v1");
    expect(policy.requestMaxPerWindow).toBe(5);
  });
});

describe("member OTP request gate (anti-enumeration + rate limit)", () => {
  const policy = buildMemberOtpPolicy("PASSWORD_ENROLL", {
    codeLength: 6,
    ttlSeconds: 300,
    maxAttempts: 10,
    resendCooldownSeconds: 60,
    requestWindowSeconds: 900,
    requestMaxPerWindow: 5,
  });
  const now = new Date("2026-09-09T00:00:00.000Z");

  it("issues when the request window is not full", () => {
    const decision = decideOtpRequest("PASSWORD_ENROLL", {
      phone: "0812345678",
      purpose: "PASSWORD_ENROLL",
      now,
      recentRequestCountInWindow: 3,
      windowStartsAt: new Date(now.getTime() - 60_000),
      latestCooldownUntil: null,
    }, policy);
    expect(decision).toEqual({ action: "issue", policy });
  });

  it("rate limits when the window is full regardless of account state", () => {
    const decision = decideOtpRequest("PASSWORD_ENROLL", {
      phone: "0812345678",
      purpose: "PASSWORD_ENROLL",
      now,
      recentRequestCountInWindow: 5,
      windowStartsAt: new Date(now.getTime() - 60_000),
      latestCooldownUntil: null,
    }, policy);
    if (decision.action === "rate_limited") {
      expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    } else {
      throw new Error("expected rate_limited decision");
    }
  });

  it("denies a resend before the documented cooldown elapses", () => {
    const cooldownUntil = new Date(now.getTime() + 45_000);
    const decision = decideOtpRequest("PASSWORD_ENROLL", {
      phone: "0812345678",
      purpose: "PASSWORD_ENROLL",
      now,
      recentRequestCountInWindow: 1,
      windowStartsAt: new Date(now.getTime() - 60_000),
      latestCooldownUntil: cooldownUntil,
    }, policy);
    if (decision.action === "cooldown_active") {
      expect(decision.retryAfterSeconds).toBe(45);
    } else {
      throw new Error("expected cooldown_active decision");
    }
  });

  it("issues again once the resend cooldown has elapsed", () => {
    const decision = decideOtpRequest("PASSWORD_ENROLL", {
      phone: "0812345678",
      purpose: "PASSWORD_ENROLL",
      now,
      recentRequestCountInWindow: 1,
      windowStartsAt: new Date(now.getTime() - 60_000),
      latestCooldownUntil: new Date(now.getTime() - 1_000),
    }, policy);
    expect(decision.action).toBe("issue");
  });
});

describe("member OTP verify gate", () => {
  const policy = buildMemberOtpPolicy("PASSWORD_ENROLL", {
    codeLength: 6,
    ttlSeconds: 300,
    maxAttempts: 3,
    resendCooldownSeconds: 60,
    requestWindowSeconds: 900,
    requestMaxPerWindow: 5,
  });
  const now = new Date("2026-09-09T00:00:00.000Z");
  const correct = "123456";
  const wrong = "000000";

  it("accepts a matching, unexpired code", () => {
    const decision = decideOtpVerify({
      purpose: "PASSWORD_ENROLL",
      policy,
      challenge: {
        codeHash: hashOtpCode(correct),
        attemptsUsed: 0,
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: null,
      },
      submittedHash: hashOtpCode(correct),
      now,
    });
    expect(decision).toEqual({ outcome: "success" });
  });

  it("rejects an expired, exhausted, consumed, or wrong challenge without enumerating a Member", () => {
    const base = {
      purpose: "PASSWORD_ENROLL" as const,
      policy,
      submittedHash: hashOtpCode(wrong),
      now,
    };
    expect(
      decideOtpVerify({
        ...base,
        challenge: {
          codeHash: hashOtpCode(correct),
          attemptsUsed: 0,
          expiresAt: new Date(now.getTime() - 1),
          consumedAt: null,
        },
      }),
    ).toEqual({ outcome: "expired" });
    expect(
      decideOtpVerify({
        ...base,
        challenge: {
          codeHash: hashOtpCode(correct),
          attemptsUsed: 3,
          expiresAt: new Date(now.getTime() + 60_000),
          consumedAt: null,
        },
      }),
    ).toEqual({ outcome: "attempts_exhausted" });
    expect(
      decideOtpVerify({
        ...base,
        challenge: {
          codeHash: hashOtpCode(correct),
          attemptsUsed: 0,
          expiresAt: new Date(now.getTime() + 60_000),
          consumedAt: new Date(),
        },
      }),
    ).toEqual({ outcome: "invalid_code" });
    expect(decideOtpVerify({ ...base, challenge: null })).toEqual({
      outcome: "not_found",
    });
  });
});

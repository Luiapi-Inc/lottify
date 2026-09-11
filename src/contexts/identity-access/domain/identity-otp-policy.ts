import { randomInt } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";

export const MEMBER_OTP_PURPOSES = ["LOGIN", "REGISTER", "REAUTH", "RECOVERY"] as const;
export type MemberOtpPurpose = (typeof MEMBER_OTP_PURPOSES)[number];

export function isMemberOtpPurpose(value: string): value is MemberOtpPurpose {
  return (MEMBER_OTP_PURPOSES as readonly string[]).includes(value);
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function generateOtpCode(length: number): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(randomInt(min, max + 1)).padStart(length, "0");
}

export function newOtpDeliveryId(): string {
  return randomBytes(16).toString("hex");
}

// Member OTP policy implements the Ticket 06 purpose/attempt/cooldown/rate
// controls. Ticket 13 separately locks the release baselines; the current
// implementation bindings must be checked against those baselines before
// acceptance rather than treating an environment default as the requirement.
export interface MemberOtpPolicy {
  purpose: MemberOtpPurpose;
  codeLength: number;
  ttlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  requestWindowSeconds: number;
  requestMaxPerWindow: number;
  policyVersion: string;
}

export interface MemberOtpPolicyBindings {
  codeLength: number;
  ttlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  requestWindowSeconds: number;
  requestMaxPerWindow: number;
}

export function buildMemberOtpPolicy(
  purpose: MemberOtpPurpose,
  bindings: MemberOtpPolicyBindings,
): MemberOtpPolicy {
  if (!isMemberOtpPurpose(purpose)) {
    throw new Error("Unknown Member OTP purpose");
  }
  return {
    purpose,
    ...bindings,
    policyVersion: "member-otp-v1",
  };
}

export interface RequestOtpFacts {
  phone: string;
  purpose: MemberOtpPurpose;
  now: Date;
  recentRequestCountInWindow: number;
  windowStartsAt: Date;
  latestCooldownUntil: Date | null;
}

export type OtpRequestDecision =
  | { action: "issue"; policy: MemberOtpPolicy }
  | { action: "rate_limited"; retryAfterSeconds: number }
  | { action: "cooldown_active"; retryAfterSeconds: number };

// Anti-enumeration + rate-limit gate applied before issuing a new challenge.
// The request is rejected when the rolling window is full so that callers
// cannot infer account state and cannot spam OTP issuance, and while a resend
// cooldown from the most recent challenge is still active.
export function decideOtpRequest(
  purpose: MemberOtpPurpose,
  facts: RequestOtpFacts,
  policy: MemberOtpPolicy,
): OtpRequestDecision {
  if (
    facts.latestCooldownUntil &&
    facts.now.getTime() < facts.latestCooldownUntil.getTime()
  ) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((facts.latestCooldownUntil.getTime() - facts.now.getTime()) / 1_000),
    );
    return { action: "cooldown_active", retryAfterSeconds };
  }
  if (facts.recentRequestCountInWindow >= policy.requestMaxPerWindow) {
    const nowMs = facts.now.getTime();
    const elapsedMs = nowMs - facts.windowStartsAt.getTime();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((policy.requestWindowSeconds * 1_000 - elapsedMs) / 1_000),
    );
    return { action: "rate_limited", retryAfterSeconds };
  }
  return { action: "issue", policy };
}

export interface OtpVerifyDecisionInput {
  purpose: MemberOtpPurpose;
  policy: MemberOtpPolicy;
  challenge: {
    codeHash: string;
    attemptsUsed: number;
    expiresAt: Date;
    consumedAt: Date | null;
  } | null;
  submittedHash: string;
  now: Date;
}

export type OtpVerifyDecision =
  | { outcome: "success" }
  | { outcome: "expired" }
  | { outcome: "attempts_exhausted" }
  | { outcome: "invalid_code" }
  | { outcome: "not_found" };

// Server-authoritative OTP verify gate. Old/invalid codes never reveal whether
// a Member exists; only success distinguishes a live challenge.
export function decideOtpVerify(input: OtpVerifyDecisionInput): OtpVerifyDecision {
  if (!input.challenge) return { outcome: "not_found" };
  if (input.challenge.consumedAt) return { outcome: "invalid_code" };
  if (input.now.getTime() >= input.challenge.expiresAt.getTime()) {
    return { outcome: "expired" };
  }
  if (input.challenge.attemptsUsed >= input.policy.maxAttempts) {
    return { outcome: "attempts_exhausted" };
  }
  if (input.submittedHash !== input.challenge.codeHash) {
    return { outcome: "invalid_code" };
  }
  return { outcome: "success" };
}

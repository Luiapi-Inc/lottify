import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getEnvironment } from "../../../platform/config/env";
import { SessionService } from "./session.service";
import {
  MEMBER_AUTH_REPOSITORY,
  type MemberAuthRepository,
  type MemberRecord,
} from "../domain/identity-auth.repository";
import { normalizePhone, PhoneValidationError } from "../domain/identity-phone";
import {
  buildMemberOtpPolicy,
  decideOtpRequest,
  decideOtpVerify,
  generateOtpCode,
  hashOtpCode,
  isMemberOtpSelfServicePurpose,
  type MemberOtpPolicy,
  type MemberOtpPurpose,
  type MemberOtpSelfServicePurpose,
} from "../domain/identity-otp-policy";
import { memberPasswordViolation } from "../domain/identity-password-policy";
import { burnPasswordHashCost, hashPassword, verifyPassword } from "../domain/password-hash";
import type { MemberOtpChallengeRecord } from "../domain/identity-auth.repository";
import { MEMBER_OTP_DELIVERY_PORT, type MemberOtpDeliveryPort } from "./member-otp-delivery.port";

export interface MemberAuthenticatedContext {
  memberId: string;
  sessionId: string;
  deviceId: string | null;
}

export interface RequestMemberOtpResult<Purpose extends MemberOtpPurpose = MemberOtpPurpose> {
  purpose: Purpose;
  deliveredTo: string;
  retryAfterSeconds: number | null;
}

/** Result of a REGISTER verify: the account exists and is now authenticated. */
export interface RegisterMemberResult {
  purpose: "REGISTER";
  accessToken: string;
  refreshToken: string;
  memberId: string;
  accountCreated: boolean;
  deviceId: string | null;
}

/**
 * Result of a PASSWORD_ENROLL verify: the Member has a credential now, but no
 * session is issued. CR #141 removes OTP as a login channel, so proving phone
 * possession may set a credential and must not authenticate on its own.
 */
export interface EnrollMemberPasswordResult {
  purpose: "PASSWORD_ENROLL";
  memberId: string;
  passwordSet: true;
  passwordUpdatedAt: Date;
}

export type VerifyMemberOtpResult = RegisterMemberResult | EnrollMemberPasswordResult;

export interface MemberLoginResult {
  accessToken: string;
  refreshToken: string;
  memberId: string;
  deviceId: string | null;
}

export interface ResetMemberPasswordResult {
  purpose: "RECOVERY";
  memberId: string;
  passwordReset: true;
  passwordUpdatedAt: Date;
}

export interface VerifyRecoveryOtpResult {
  purpose: "RECOVERY";
  verified: true;
  evidenceRef: string;
}

export interface MemberSessionView {
  sessionId: string;
  deviceId: string | null;
  expiresAt: Date;
}

@Injectable()
export class MemberAuthService {
  constructor(
    @Inject(MEMBER_AUTH_REPOSITORY) private readonly members: MemberAuthRepository,
    @Inject(MEMBER_OTP_DELIVERY_PORT) private readonly delivery: MemberOtpDeliveryPort,
    private readonly sessions: SessionService,
  ) {}

  // Purpose-scoped OTP request. CR #141 removed `LOGIN`: OTP is no longer a
  // login channel, so only purposes that prove phone possession for a
  // non-authenticating action are accepted here (REGISTER, PASSWORD_ENROLL).
  // The endpoint does not reveal whether the phone is registered: issuance and
  // validation are identical for every accepted purpose so request-time account
  // enumeration is not possible.
  async requestOtp(
    purposeRaw: string,
    phoneRaw: string,
  ): Promise<RequestMemberOtpResult<MemberOtpSelfServicePurpose>> {
    if (!isMemberOtpSelfServicePurpose(purposeRaw)) {
      throw new UnauthorizedException({
        code: "OTP_PURPOSE_INVALID",
        message: "OTP purpose is not supported",
        details: {},
      });
    }
    return this.requestOtpForPurpose(purposeRaw, phoneRaw);
  }

  requestRecoveryOtp(phoneRaw: string): Promise<RequestMemberOtpResult<"RECOVERY">> {
    return this.requestOtpForPurpose("RECOVERY", phoneRaw);
  }

  private async requestOtpForPurpose<Purpose extends MemberOtpPurpose>(
    purpose: Purpose,
    phoneRaw: string,
  ): Promise<RequestMemberOtpResult<Purpose>> {
    const env = getEnvironment();
    const phone = parsePhone(phoneRaw);
    const now = new Date();
    const policy = memberOtpPolicyFor(purpose, env);

    const windowStart = new Date(
      now.getTime() - policy.requestWindowSeconds * 1_000,
    );
    const windowFact = await this.members.countOtpRequestsInWindow({
      phone,
      purpose,
      windowStart,
    });
    const decision = decideOtpRequest(
      purpose,
      { phone, purpose, now, ...windowFact },
      policy,
    );
    if (decision.action === "cooldown_active") {
      throw new ConflictException({
        code: "OTP_COOLDOWN",
        message: "Please wait before requesting another code",
        details: { retryAfterSeconds: decision.retryAfterSeconds },
      });
    }
    if (decision.action === "rate_limited") {
      throw new ConflictException({
        code: "OTP_RATE_LIMITED",
        message: "Too many OTP requests. Please try again later.",
        details: { retryAfterSeconds: decision.retryAfterSeconds },
      });
    }

    // A successful OTP request never returns the code to the caller.
    const code = generateOtpCode(policy.codeLength);
    const challenge = await this.members.createOtpChallenge({
      phone,
      purpose,
      memberId: null,
      codeHash: hashOtpCode(code),
      expiresAt: new Date(now.getTime() + policy.ttlSeconds * 1_000),
      cooldownUntil: new Date(
        now.getTime() + policy.resendCooldownSeconds * 1_000,
      ),
    });
    await this.delivery.deliver({ phone, purpose, code });

    return { purpose, deliveredTo: phone, retryAfterSeconds: null };
  }

  /**
   * Purpose-scoped OTP verify.
   *
   *  - `REGISTER` creates the Member with the supplied password — the phone is
   *    the login identity, so the account is created and authenticated in one
   *    step. A REGISTER for a phone that already has a Member is rejected: it
   *    must never authenticate an existing account, because that is exactly the
   *    OTP-as-login channel CR #141 removes.
   *  - `PASSWORD_ENROLL` sets/replaces the credential of an existing Member
   *    (legacy Members created before CR #141 have no credential) and
   *    deliberately issues no session.
   */
  async verifyOtp(
    purposeRaw: string,
    phoneRaw: string,
    code: string,
    password: string,
    deviceName?: string,
  ): Promise<VerifyMemberOtpResult> {
    if (purposeRaw !== "REGISTER" && purposeRaw !== "PASSWORD_ENROLL") {
      throw new UnauthorizedException({
        code: "OTP_PURPOSE_INVALID",
        message: "OTP purpose is not supported",
        details: {},
      });
    }
    const purpose = purposeRaw;
    assertMemberPassword(password);
    const { phone, challenge, verifiedAt: now } = await this.verifyChallenge(
      purpose,
      phoneRaw,
      code,
    );
    const passwordHash = await hashPassword(password);

    if (purpose === "PASSWORD_ENROLL") {
      const member = await this.members.findByPhone(phone);
      if (!member) {
        throw new ConflictException({
          code: "MEMBER_NOT_REGISTERED",
          message: "No Member is registered for this phone",
          details: {},
        });
      }
      await this.claimChallenge(challenge, member.id, now);
      const updated = await this.members.setMemberPassword({
        memberId: member.id,
        passwordHash,
        updatedAt: now,
      });
      if (!updated) throw new NotFoundException("Member not found");
      return {
        purpose: "PASSWORD_ENROLL",
        memberId: updated.id,
        passwordSet: true,
        passwordUpdatedAt: updated.passwordUpdatedAt ?? now,
      };
    }

    if (await this.members.findByPhone(phone)) {
      throw new ConflictException({
        code: "MEMBER_ALREADY_REGISTERED",
        message: "A Member already exists for this phone; log in or enroll a password",
        details: {},
      });
    }
    const member = await this.members.createMember({
      phone,
      passwordHash,
      passwordUpdatedAt: now,
    });
    // Under a concurrent REGISTER the unique phone resolves to the winning
    // Member. This caller must neither overwrite that credential nor
    // authenticate as it, so a lost race is reported instead of accepted.
    if (member.passwordHash !== passwordHash) {
      throw new ConflictException({
        code: "MEMBER_ALREADY_REGISTERED",
        message: "A Member already exists for this phone; log in or enroll a password",
        details: {},
      });
    }
    await this.claimChallenge(challenge, member.id, now);
    await this.members.recordLoginSuccess(member.id, now);

    const device = await this.members.upsertDevice({
      memberId: member.id,
      deviceId: randomUUID(),
      name: deviceName?.trim() || null,
    });
    const issued = await this.sessions.issue(member.id, device.id);
    return {
      purpose: "REGISTER",
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      memberId: member.id,
      accountCreated: true,
      deviceId: device.id,
    };
  }

  /**
   * Phone + password login (CR #141). The credential is verified with the
   * shared constant-time verifier, unknown phones burn the same KDF cost so
   * response timing does not disclose registration state, and repeated failures
   * lock the credential for a bounded window instead of allowing an unbounded
   * password oracle.
   */
  async login(input: {
    phone: string;
    password: string;
    deviceName?: string;
  }): Promise<MemberLoginResult> {
    const env = getEnvironment();
    const phone = parsePhone(input.phone);
    const now = new Date();
    const member = await this.members.findByPhone(phone);

    if (!member) {
      await burnPasswordHashCost(input.password);
      throw memberCredentialsInvalid();
    }
    if (member.lockedUntil && member.lockedUntil.getTime() > now.getTime()) {
      // Lock state is disclosed as an actionable retry window rather than a
      // misleading "wrong password": the endpoint already distinguishes the
      // no-credential case for the same phone, so this adds no new
      // account-existence signal.
      throw new UnauthorizedException({
        code: "MEMBER_LOGIN_LOCKED",
        message: "Too many failed login attempts. Try again later.",
        details: {
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((member.lockedUntil.getTime() - now.getTime()) / 1_000),
          ),
        },
      });
    }
    if (!member.passwordHash) {
      // Every pre-CR Member lands here. The Member is routed to one-time
      // enrollment instead of being locked out of the platform.
      throw new ConflictException({
        code: "PASSWORD_ENROLLMENT_REQUIRED",
        message: "This account has no password yet; enroll one with an OTP",
        details: {},
      });
    }

    const passwordValid = await verifyPassword(member.passwordHash, input.password);
    if (!passwordValid) {
      await this.recordLoginFailure(member, env, now);
      throw memberCredentialsInvalid();
    }
    if (member.status !== "ACTIVE") {
      throw new UnauthorizedException({
        code: "ACCOUNT_DISABLED",
        message: "This Member account is not active",
        details: {},
      });
    }

    await this.members.recordLoginSuccess(member.id, now);
    const device = await this.members.upsertDevice({
      memberId: member.id,
      deviceId: randomUUID(),
      name: input.deviceName?.trim() || null,
    });
    const issued = await this.sessions.issue(member.id, device.id);
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      memberId: member.id,
      deviceId: device.id,
    };
  }

  /**
   * Forgot-password reset (CR #141 keeps `recovery/otp/*` as the reset
   * channel). The RECOVERY challenge is possession evidence only; the reset
   * completes here with a new credential. A successful reset revokes every
   * existing session, because a credential reset is also the recovery path for
   * a suspected compromise.
   */
  async resetMemberPassword(input: {
    phone: string;
    code: string;
    password: string;
  }): Promise<ResetMemberPasswordResult> {
    assertMemberPassword(input.password);
    const { phone, challenge, verifiedAt: now } = await this.verifyChallenge(
      "RECOVERY",
      input.phone,
      input.code,
    );
    const member = await this.members.findByPhone(phone);
    if (!member) {
      throw new ConflictException({
        code: "MEMBER_NOT_REGISTERED",
        message: "No Member is registered for this phone",
        details: {},
      });
    }
    if (!member.passwordHash) {
      throw new ConflictException({
        code: "PASSWORD_ENROLLMENT_REQUIRED",
        message: "This account has no password yet; enroll one with an OTP",
        details: {},
      });
    }
    await this.claimChallenge(challenge, member.id, now);
    const updated = await this.members.setMemberPassword({
      memberId: member.id,
      passwordHash: await hashPassword(input.password),
      updatedAt: now,
    });
    if (!updated) throw new NotFoundException("Member not found");
    await this.sessions.revokeAllForMember(member.id);
    return {
      purpose: "RECOVERY",
      memberId: updated.id,
      passwordReset: true,
      passwordUpdatedAt: updated.passwordUpdatedAt ?? now,
    };
  }

  async verifyRecoveryOtp(
    phoneRaw: string,
    code: string,
  ): Promise<VerifyRecoveryOtpResult> {
    const { challenge, verifiedAt } = await this.verifyChallenge(
      "RECOVERY",
      phoneRaw,
      code,
    );
    await this.claimChallenge(challenge, null, verifiedAt);
    return {
      purpose: "RECOVERY",
      verified: true,
      evidenceRef: `otp-challenge:${challenge.id}`,
    };
  }

  private async recordLoginFailure(
    member: MemberRecord,
    env: ReturnType<typeof getEnvironment>,
    now: Date,
  ): Promise<void> {
    const attempts = member.failedLoginAttempts + 1;
    const locked = attempts >= env.MEMBER_LOGIN_MAX_ATTEMPTS;
    await this.members.recordLoginFailure({
      memberId: member.id,
      // A locked credential starts a fresh count so the lock cannot be extended
      // indefinitely by continued guessing.
      failedLoginAttempts: locked ? 0 : attempts,
      lockedUntil: locked
        ? new Date(now.getTime() + env.MEMBER_LOGIN_LOCKOUT_SECONDS * 1_000)
        : null,
    });
  }

  // A verified challenge is single-use: only the caller that atomically wins
  // the claim proceeds; a concurrent replay of the same code is denied.
  private async claimChallenge(
    challenge: MemberOtpChallengeRecord,
    memberId: string | null,
    consumedAt: Date,
  ): Promise<void> {
    const claimed = await this.members.consumeChallenge(
      challenge.id,
      memberId,
      consumedAt,
    );
    if (!claimed) {
      throw new UnauthorizedException({
        code: "OTP_ALREADY_USED",
        message: "This OTP has already been used",
        details: {},
      });
    }
  }

  private async verifyChallenge(
    purpose: MemberOtpPurpose,
    phoneRaw: string,
    code: string,
  ): Promise<{
    phone: string;
    challenge: MemberOtpChallengeRecord;
    verifiedAt: Date;
  }> {
    const env = getEnvironment();
    const phone = parsePhone(phoneRaw);
    const policy = memberOtpPolicyFor(purpose, env);
    const now = new Date();
    const challenge = await this.members.findLatestActiveChallenge({
      phone,
      purpose,
    });
    const decision = decideOtpVerify({
      purpose,
      policy,
      challenge: challenge
        ? {
            codeHash: challenge.codeHash,
            attemptsUsed: challenge.attemptsUsed,
            expiresAt: challenge.expiresAt,
            consumedAt: challenge.consumedAt,
          }
        : null,
      submittedHash: hashOtpCode(code.trim()),
      now,
    });

    if (decision.outcome !== "success") {
      if (challenge && decision.outcome === "invalid_code") {
        await this.members.recordChallengeAttempt(
          challenge.id,
          challenge.attemptsUsed + 1,
        );
      }
      throw new UnauthorizedException({
        code: otpFailureCode(decision.outcome),
        message: "OTP verification failed",
        details: {},
      });
    }
    if (!challenge) {
      throw new UnauthorizedException({
        code: "OTP_NOT_FOUND",
        message: "OTP verification failed",
        details: {},
      });
    }
    return { phone, challenge, verifiedAt: now };
  }

  async refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    return this.sessions.refresh(refreshToken);
  }

  async logout(refreshToken: string | undefined): Promise<{ revoked: true }> {
    if (refreshToken) {
      const session = await this.sessions.findSessionForRefreshToken(refreshToken);
      if (session) {
        await this.sessions.revoke(session.memberId, session.sessionId);
      }
    }
    return { revoked: true };
  }

  async revokeAll(memberId: string): Promise<{ revoked: true }> {
    await this.sessions.revokeAllForMember(memberId);
    return { revoked: true };
  }

  async listSessions(memberId: string): Promise<MemberSessionView[]> {
    return this.sessions.listForMember(memberId);
  }

  async revokeSession(memberId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(memberId, sessionId);
  }

  async revokeDevice(memberId: string, deviceId: string): Promise<void> {
    await this.sessions.revokeByDevice(memberId, deviceId);
  }

  async listDevices(memberId: string): Promise<
    Array<{ deviceId: string; name: string | null; createdAt: Date; lastUsedAt: Date | null }>
  > {
    const devices = await this.members.listDevicesForMember(memberId);
    return devices.map((device) => ({
      deviceId: device.id,
      name: device.name,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
    }));
  }

  async me(memberId: string): Promise<{
    memberId: string;
    phone: string;
    status: string;
    passwordEnrolled: boolean;
  }> {
    const member = await this.members.findById(memberId);
    if (!member) throw new NotFoundException("Member not found");
    // `passwordEnrolled` is the only credential fact the API exposes: whether
    // the Member still has to complete enrollment. The encoded hash never
    // leaves this service.
    return {
      memberId: member.id,
      phone: member.phone,
      status: member.status,
      passwordEnrolled: member.passwordHash !== null,
    };
  }
}

function parsePhone(raw: string): string {
  try {
    return normalizePhone(raw);
  } catch (error) {
    if (error instanceof PhoneValidationError) {
      throw new UnauthorizedException({
        code: "PHONE_INVALID",
        message: "A valid phone number is required",
        details: {},
      });
    }
    throw error;
  }
}

/**
 * Server-authoritative credential policy check. The submitted password is never
 * echoed back: only the violation class is reported.
 */
function assertMemberPassword(password: string): void {
  const violation = memberPasswordViolation(password);
  if (violation) {
    throw new BadRequestException({
      code: "MEMBER_PASSWORD_REJECTED",
      message: "The supplied password does not satisfy the Member password policy",
      details: { violation },
    });
  }
}

function memberCredentialsInvalid(): UnauthorizedException {
  return new UnauthorizedException({
    code: "MEMBER_CREDENTIALS_INVALID",
    message: "Invalid phone or password",
    details: {},
  });
}

function memberOtpPolicyFor(
  purpose: MemberOtpPurpose,
  env: ReturnType<typeof getEnvironment>,
): MemberOtpPolicy {
  return buildMemberOtpPolicy(purpose, {
    codeLength: env.MEMBER_OTP_CODE_LENGTH,
    ttlSeconds: env.MEMBER_OTP_TTL_SECONDS,
    maxAttempts: env.MEMBER_OTP_MAX_ATTEMPTS,
    resendCooldownSeconds: env.MEMBER_OTP_RESEND_COOLDOWN_SECONDS,
    requestWindowSeconds: env.MEMBER_OTP_REQUEST_WINDOW_SECONDS,
    requestMaxPerWindow: env.MEMBER_OTP_REQUEST_MAX_PER_WINDOW,
  });
}

function otpFailureCode(outcome: string): string {
  switch (outcome) {
    case "expired":
      return "OTP_EXPIRED";
    case "attempts_exhausted":
      return "OTP_ATTEMPTS_EXHAUSTED";
    case "not_found":
      return "OTP_NOT_FOUND";
    default:
      return "OTP_INVALID";
  }
}

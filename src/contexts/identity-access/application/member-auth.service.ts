import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getEnvironment } from "../../../platform/config/env";
import { SessionService } from "./session.service";
import { MEMBER_AUTH_REPOSITORY, type MemberAuthRepository } from "../domain/identity-auth.repository";
import { normalizePhone, PhoneValidationError } from "../domain/identity-phone";
import {
  buildMemberOtpPolicy,
  decideOtpRequest,
  decideOtpVerify,
  generateOtpCode,
  hashOtpCode,
  isMemberOtpPurpose,
  type MemberOtpPolicy,
  type MemberOtpPurpose,
} from "../domain/identity-otp-policy";
import { MEMBER_OTP_DELIVERY_PORT, type MemberOtpDeliveryPort } from "./member-otp-delivery.port";

export interface MemberAuthenticatedContext {
  memberId: string;
  sessionId: string;
  deviceId: string | null;
}

export interface RequestMemberOtpResult {
  purpose: MemberOtpPurpose;
  deliveredTo: string;
  retryAfterSeconds: number | null;
}

export interface VerifyMemberOtpResult {
  accessToken: string;
  refreshToken: string;
  memberId: string;
  accountCreated: boolean;
  deviceId: string | null;
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

  // Purpose-scoped OTP request. The endpoint does not reveal whether the phone
  // is registered: issuance and validation are identical for LOGIN and REGISTER
  // so request-time account enumeration is not possible.
  async requestOtp(
    purposeRaw: string,
    phoneRaw: string,
  ): Promise<RequestMemberOtpResult> {
    const env = getEnvironment();
    if (!isMemberOtpPurpose(purposeRaw) || purposeRaw === "REAUTH") {
      throw new UnauthorizedException({
        code: "OTP_PURPOSE_INVALID",
        message: "OTP purpose is not supported",
        details: {},
      });
    }
    const purpose = purposeRaw as MemberOtpPurpose;
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

  // Purpose-scoped OTP verify. A successful verify issues a short-lived access
  // token plus a rotating refresh session (server-enforced). REGISTER creates
  // the Member on first verified use; phone is the login identity so a REGISTER
  // on an already-active phone authenticates rather than creating a duplicate.
  async verifyOtp(
    purposeRaw: string,
    phoneRaw: string,
    code: string,
    deviceName?: string,
  ): Promise<VerifyMemberOtpResult> {
    const env = getEnvironment();
    if (!isMemberOtpPurpose(purposeRaw) || purposeRaw === "REAUTH") {
      throw new UnauthorizedException({
        code: "OTP_PURPOSE_INVALID",
        message: "OTP purpose is not supported",
        details: {},
      });
    }
    const purpose = purposeRaw as MemberOtpPurpose;
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
      if (challenge && decision.outcome !== "expired") {
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

    const existing = await this.members.findByPhone(phone);
    let member = existing;
    let accountCreated = false;
    if (purpose === "REGISTER") {
      if (!member) {
        member = await this.members.createMember({ phone });
        // Under a concurrent REGISTER the unique phone resolves to an existing
        // Member; the caller still authenticates rather than being double-counted.
        accountCreated = true;
      }
    } else if (!member) {
      // LOGIN on a phone with no account: a verified OTP proves possession, so
      // it is safe to route the Member to registration (no account is created).
      throw new UnauthorizedException({
        code: "MEMBER_NOT_REGISTERED",
        message: "No Member is registered for this phone",
        details: {},
      });
    }
    if (member.status !== "ACTIVE") {
      throw new UnauthorizedException({
        code: "ACCOUNT_DISABLED",
        message: "This Member account is not active",
        details: {},
      });
    }

    if (!challenge) {
      // Unreachable when the verify decision succeeded, but keep the data
      // access safe against concurrent deletion of the challenge.
      throw new UnauthorizedException({
        code: "OTP_NOT_FOUND",
        message: "OTP verification failed",
        details: {},
      });
    }
    // A verified challenge is single-use: only the caller that atomically wins
    // the claim proceeds; a concurrent replay of the same code is denied.
    const claimed = await this.members.consumeChallenge(challenge.id, member.id, now);
    if (!claimed) {
      throw new UnauthorizedException({
        code: "OTP_ALREADY_USED",
        message: "This OTP has already been used",
        details: {},
      });
    }
    await this.members.recordMemberLogin(member.id, now);

    const device = await this.members.upsertDevice({
      memberId: member.id,
      deviceId: randomUUID(),
      name: deviceName?.trim() || null,
    });

    const issued = await this.sessions.issue(member.id, device.id);
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      memberId: member.id,
      accountCreated,
      deviceId: device.id,
    };
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
  }> {
    const member = await this.members.findById(memberId);
    if (!member) throw new NotFoundException("Member not found");
    return {
      memberId: member.id,
      phone: member.phone,
      status: member.status,
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

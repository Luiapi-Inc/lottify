import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { MemberAuthService } from "../../src/contexts/identity-access/application/member-auth.service";
import type { MemberOtpDeliveryPort } from "../../src/contexts/identity-access/application/member-otp-delivery.port";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import type {
  MemberAuthRepository,
  MemberDeviceRecord,
  MemberOtpChallengeRecord,
  MemberRecord,
  OtpRequestWindowFact,
} from "../../src/contexts/identity-access/domain/identity-auth.repository";
import { hashRefreshToken } from "../../src/contexts/identity-access/application/session.service";
import type { AuthSessionRecord, SessionRepository } from "../../src/contexts/identity-access/domain/session.repository";
import { resetEnvironmentForTests } from "../../src/platform/config/env";

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://user:***@localhost:5432/lottify";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.JWT_ACCESS_SECRET = "01234567890123456789012345678901";
  resetEnvironmentForTests();
});

class FakeDelivery implements MemberOtpDeliveryPort {
  codes = new Map<string, string>();
  async deliver(input: { phone: string; purpose: string; code: string }): Promise<void> {
    this.codes.set(`${input.purpose}:${input.phone}`, input.code);
  }
  lastCode(phone: string, purpose: string): string | undefined {
    return this.codes.get(`${purpose}:${phone}`);
  }
}

class InMemoryMemberRepository implements MemberAuthRepository {
  members = new Map<string, MemberRecord>();
  challenges = new Map<string, MemberOtpChallengeRecord>();
  devices = new Map<string, MemberDeviceRecord>();

  async findByPhone(phone: string): Promise<MemberRecord | null> {
    for (const m of this.members.values()) if (m.phone === phone) return m;
    return null;
  }
  async findById(id: string): Promise<MemberRecord | null> {
    return this.members.get(id) ?? null;
  }
  async createMember(input: { phone: string }): Promise<MemberRecord> {
    const member: MemberRecord = {
      id: randomUUID(),
      phone: input.phone,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.members.set(member.id, member);
    return member;
  }
  async countOtpRequestsInWindow(): Promise<OtpRequestWindowFact> {
    return { recentRequestCountInWindow: 0, windowStartsAt: new Date(), latestCooldownUntil: null };
  }
  async createOtpChallenge(input: {
    phone: string;
    purpose: MemberOtpChallengeRecord["purpose"] & string;
    memberId: string | null;
    codeHash: string;
    expiresAt: Date;
    cooldownUntil: Date;
  }): Promise<MemberOtpChallengeRecord> {
    const record: MemberOtpChallengeRecord = {
      id: randomUUID(),
      phone: input.phone,
      purpose: input.purpose,
      memberId: input.memberId,
      codeHash: input.codeHash,
      attemptsUsed: 0,
      expiresAt: input.expiresAt,
      cooldownUntil: input.cooldownUntil,
      consumedAt: null,
      createdAt: new Date(),
    };
    this.challenges.set(record.id, record);
    return record;
  }
  async findLatestActiveChallenge(input: {
    phone: string;
    purpose: string;
  }): Promise<MemberOtpChallengeRecord | null> {
    let latest: MemberOtpChallengeRecord | null = null;
    for (const c of this.challenges.values()) {
      if (c.phone === input.phone && c.purpose === input.purpose && !c.consumedAt) {
        if (!latest || c.createdAt > latest.createdAt) latest = c;
      }
    }
    return latest;
  }
  async findChallengeById(id: string): Promise<MemberOtpChallengeRecord | null> {
    return this.challenges.get(id) ?? null;
  }
  async recordChallengeAttempt(id: string, attemptsUsed: number): Promise<void> {
    const c = this.challenges.get(id);
    if (c) this.challenges.set(id, { ...c, attemptsUsed });
  }
  async consumeChallenge(id: string, memberId: string, consumedAt: Date): Promise<boolean> {
    const c = this.challenges.get(id);
    if (c && !c.consumedAt) {
      this.challenges.set(id, { ...c, consumedAt, memberId });
      return true;
    }
    return false;
  }
  async recordMemberLogin(id: string): Promise<void> {}
  async upsertDevice(input: {
    memberId: string;
    deviceId: string;
    name: string | null;
  }): Promise<MemberDeviceRecord> {
    const existing = this.devices.get(input.deviceId);
    const device: MemberDeviceRecord = existing ?? {
      id: input.deviceId,
      memberId: input.memberId,
      name: input.name,
      createdAt: new Date(),
      lastUsedAt: null,
    };
    device.memberId = input.memberId;
    device.name = input.name;
    device.lastUsedAt = new Date();
    this.devices.set(device.id, device);
    return device;
  }
  async touchDevice(): Promise<void> {}
  async listDevicesForMember(memberId: string): Promise<MemberDeviceRecord[]> {
    return [...this.devices.values()].filter((d) => d.memberId === memberId);
  }
}

class InMemorySessionRepo implements SessionRepository {
  records = new Map<string, AuthSessionRecord>();
  async create(input: {
    memberId: string;
    deviceId?: string;
    familyId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<AuthSessionRecord> {
    const record: AuthSessionRecord = {
      id: randomUUID(),
      memberId: input.memberId,
      deviceId: input.deviceId ?? null,
      familyId: input.familyId,
      refreshTokenHash: input.refreshTokenHash,
      replacedById: null,
      version: 1,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.records.set(record.id, record);
    return record;
  }
  async findById(id: string): Promise<AuthSessionRecord | null> {
    return this.records.get(id) ?? null;
  }
  async findByRefreshHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    for (const r of this.records.values()) if (r.refreshTokenHash === refreshTokenHash) return r;
    return null;
  }
  async listActiveForMember(memberId: string): Promise<AuthSessionRecord[]> {
    return [...this.records.values()].filter(
      (r) => r.memberId === memberId && !r.revokedAt && r.expiresAt > new Date(),
    );
  }
  async rotate(input: {
    id: string;
    expectedHash: string;
    nextId: string;
    newHash: string;
    newExpiresAt: Date;
  }): Promise<AuthSessionRecord | null> {
    const r = this.records.get(input.id);
    if (!r || r.refreshTokenHash !== input.expectedHash || r.revokedAt || r.expiresAt <= new Date()) return null;
    r.revokedAt = new Date();
    r.replacedById = input.nextId;
    const next: AuthSessionRecord = {
      id: input.nextId,
      memberId: r.memberId,
      deviceId: r.deviceId,
      familyId: r.familyId,
      refreshTokenHash: input.newHash,
      replacedById: null,
      version: 1,
      expiresAt: input.newExpiresAt,
      revokedAt: null,
    };
    this.records.set(next.id, next);
    return next;
  }
  async revokeFamily(familyId: string): Promise<void> {
    for (const r of this.records.values()) {
      if (r.familyId === familyId && !r.revokedAt) r.revokedAt = new Date();
    }
  }
  async revokeByDevice(memberId: string, deviceId: string): Promise<void> {
    for (const r of this.records.values()) {
      if (r.memberId === memberId && r.deviceId === deviceId && !r.revokedAt) r.revokedAt = new Date();
    }
  }
  async revokeAllForMember(memberId: string): Promise<void> {
    for (const r of this.records.values()) {
      if (r.memberId === memberId && !r.revokedAt) r.revokedAt = new Date();
    }
  }
}

function harness() {
  const members = new InMemoryMemberRepository();
  const sessionsRepo = new InMemorySessionRepo();
  const delivery = new FakeDelivery();
  const sessions = new SessionService(sessionsRepo, new JwtService());
  const auth = new MemberAuthService(members, delivery, sessions);
  return { members, sessionsRepo, delivery, sessions, auth };
}

const PHONE = "+66812345678";

describe("MemberAuthService registration and login", () => {
  it("registers a Member on first REGISTER verify and issues an access+refresh session", async () => {
    const { auth, delivery } = harness();
    await auth.requestOtp("REGISTER", PHONE);
    const code = delivery.lastCode(PHONE, "REGISTER");
    expect(code).toBeTruthy();
    const result = await auth.verifyOtp("REGISTER", PHONE, code!, "My Phone");
    expect(result.accountCreated).toBe(true);
    expect(result.memberId).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.deviceId).toBeTruthy();
  });

  it("does not reveal registration state at OTP request time (anti-enumeration)", async () => {
    const { auth, delivery } = harness();
    const unknownPhone = "+66999999999";
    await auth.requestOtp("LOGIN", unknownPhone);
    await auth.requestOtp("LOGIN", PHONE);
    expect(delivery.lastCode(unknownPhone, "LOGIN")).toBeTruthy();
    expect(delivery.lastCode(PHONE, "LOGIN")).toBeTruthy();
  });

  it("logs in an existing Member and authenticates a REGISTER on an active phone without duplicate", async () => {
    const { auth, delivery } = harness();
    await auth.requestOtp("REGISTER", PHONE);
    const code = delivery.lastCode(PHONE, "REGISTER");
    const first = await auth.verifyOtp("REGISTER", PHONE, code!, "Phone A");
    expect(first.accountCreated).toBe(true);

    await auth.requestOtp("REGISTER", PHONE);
    const secondCode = delivery.lastCode(PHONE, "REGISTER");
    const second = await auth.verifyOtp("REGISTER", PHONE, secondCode!, "Phone B");
    expect(second.accountCreated).toBe(false);
    expect(second.memberId).toBe(first.memberId);
  });

  it("rejects LOGIN for a phone with no registered account", async () => {
    const { auth, delivery } = harness();
    await auth.requestOtp("LOGIN", PHONE);
    const code = delivery.lastCode(PHONE, "LOGIN");
    await expect(auth.verifyOtp("LOGIN", PHONE, code!, "Phone")).rejects.toThrow();
  });
});

describe("MemberAuthService refresh rotation", () => {
  it("issues a session whose refresh token rotates and rejects reuse", async () => {
    const { auth, delivery, sessionsRepo, sessions } = harness();
    await auth.requestOtp("REGISTER", PHONE);
    const code = delivery.lastCode(PHONE, "REGISTER");
    const issued = await auth.verifyOtp("REGISTER", PHONE, code!, "Phone");
    expect(sessionsRepo.records.size).toBe(1);

    const rotated = await auth.refresh(issued.refreshToken);
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);

    // Reuse of the rotated-away token is a reuse signal: the whole family is
    // revoked server-side, so even the freshly-rotated access token stops working.
    await expect(auth.refresh(issued.refreshToken)).rejects.toThrow();
    await expect(sessions.authenticateAccess(rotated.accessToken)).rejects.toThrow();
  });

  it("revokes a single session scoped to the owning Member", async () => {
    const { auth, delivery, sessionsRepo } = harness();
    await auth.requestOtp("REGISTER", PHONE);
    const code = delivery.lastCode(PHONE, "REGISTER");
    const issued = await auth.verifyOtp("REGISTER", PHONE, code!, "Phone");
    const list = await auth.listSessions(issued.memberId);
    expect(list.length).toBe(1);
    await auth.revokeSession(issued.memberId, list[0]!.sessionId);
    await expect(auth.refresh(issued.refreshToken)).rejects.toThrow();
    expect(sessionsRepo.records.size).toBe(1);
  });
});

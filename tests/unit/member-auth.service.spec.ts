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
import type { AuthSessionRecord, SessionRepository } from "../../src/contexts/identity-access/domain/session.repository";
import {
  getEnvironment,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";

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
  async createMember(input: {
    phone: string;
    passwordHash?: string | null;
    passwordUpdatedAt?: Date | null;
  }): Promise<MemberRecord> {
    // Mirrors the Prisma repository: the unique phone resolves to the existing
    // Member instead of creating a duplicate.
    const existing = await this.findByPhone(input.phone);
    if (existing) return existing;
    const member: MemberRecord = {
      id: randomUUID(),
      phone: input.phone,
      status: "ACTIVE",
      passwordHash: input.passwordHash ?? null,
      passwordUpdatedAt: input.passwordUpdatedAt ?? null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.members.set(member.id, member);
    return member;
  }
  async setMemberPassword(input: {
    memberId: string;
    passwordHash: string;
    updatedAt: Date;
  }): Promise<MemberRecord | null> {
    const member = this.members.get(input.memberId);
    if (!member) return null;
    const updated: MemberRecord = {
      ...member,
      passwordHash: input.passwordHash,
      passwordUpdatedAt: input.updatedAt,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    this.members.set(updated.id, updated);
    return updated;
  }
  async recordLoginFailure(input: {
    memberId: string;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  }): Promise<void> {
    const member = this.members.get(input.memberId);
    if (!member) return;
    this.members.set(member.id, {
      ...member,
      failedLoginAttempts: input.failedLoginAttempts,
      lockedUntil: input.lockedUntil,
    });
  }
  async recordLoginSuccess(memberId: string): Promise<void> {
    const member = this.members.get(memberId);
    if (!member) return;
    this.members.set(memberId, { ...member, failedLoginAttempts: 0, lockedUntil: null });
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
  async consumeChallenge(id: string, memberId: string | null, consumedAt: Date): Promise<boolean> {
    const c = this.challenges.get(id);
    if (c && !c.consumedAt) {
      this.challenges.set(id, { ...c, consumedAt, memberId });
      return true;
    }
    return false;
  }
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

const PHONE = "0812345678";
const UNKNOWN_PHONE = "0999999999";
const PASSWORD = "correct-horse-battery";
const OTHER_PASSWORD = "another-strong-passphrase";

function legacyMember(phone = PHONE): MemberRecord {
  // Exactly how every pre-CR #141 Member looks: the row exists, no credential.
  return {
    id: randomUUID(),
    phone,
    status: "ACTIVE",
    passwordHash: null,
    passwordUpdatedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function register(
  auth: MemberAuthService,
  delivery: FakeDelivery,
  phone = PHONE,
) {
  await auth.requestOtp("REGISTER", phone);
  const code = delivery.lastCode(phone, "REGISTER")!;
  const result = await auth.verifyOtp("REGISTER", phone, code, PASSWORD, "My Phone");
  if (result.purpose !== "REGISTER") throw new Error("expected a REGISTER result");
  return result;
}

describe("MemberAuthService registration (CR #141)", () => {
  it("registers a Member with a password and issues an access+refresh session", async () => {
    const { auth, delivery, members } = harness();
    const result = await register(auth, delivery);

    expect(result.accountCreated).toBe(true);
    expect(result.memberId).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.deviceId).toBeTruthy();

    const stored = members.members.get(result.memberId)!;
    expect(stored.passwordHash).toMatch(/^scrypt-v1\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(stored.passwordUpdatedAt).toBeInstanceOf(Date);
  });

  it("no longer accepts OTP as a login channel (LOGIN purpose retired)", async () => {
    const { auth, delivery } = harness();
    await expect(auth.requestOtp("LOGIN", PHONE)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_PURPOSE_INVALID" }),
    });
    await expect(
      auth.verifyOtp("LOGIN", PHONE, "123456", PASSWORD, "Phone"),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_PURPOSE_INVALID" }),
    });
    expect(delivery.lastCode(PHONE, "LOGIN")).toBeUndefined();
  });

  it("does not authenticate an existing account through REGISTER", async () => {
    const { auth, delivery, sessionsRepo } = harness();
    await register(auth, delivery);
    const sessionsAfterRegister = sessionsRepo.records.size;

    await auth.requestOtp("REGISTER", PHONE);
    const code = delivery.lastCode(PHONE, "REGISTER")!;
    await expect(
      auth.verifyOtp("REGISTER", PHONE, code, OTHER_PASSWORD, "Phone B"),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "MEMBER_ALREADY_REGISTERED" }),
    });
    expect(sessionsRepo.records.size).toBe(sessionsAfterRegister);
  });

  it("rejects a password that violates the server-side policy", async () => {
    const { auth, delivery } = harness();
    await auth.requestOtp("REGISTER", PHONE);
    const code = delivery.lastCode(PHONE, "REGISTER")!;
    await expect(
      auth.verifyOtp("REGISTER", PHONE, code, "short", "Phone"),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "MEMBER_PASSWORD_REJECTED",
        details: { violation: "TOO_SHORT" },
      }),
    });
  });

  it("does not reveal registration state at OTP request time (anti-enumeration)", async () => {
    const { auth, delivery } = harness();
    await auth.requestOtp("PASSWORD_ENROLL", UNKNOWN_PHONE);
    await auth.requestOtp("PASSWORD_ENROLL", PHONE);
    expect(delivery.lastCode(UNKNOWN_PHONE, "PASSWORD_ENROLL")).toBeTruthy();
    expect(delivery.lastCode(PHONE, "PASSWORD_ENROLL")).toBeTruthy();
  });
});

describe("MemberAuthService password login (CR #141)", () => {
  it("logs in with phone + password and authenticates the issued access token", async () => {
    const { auth, delivery, sessions } = harness();
    const registered = await register(auth, delivery);

    const login = await auth.login({ phone: PHONE, password: PASSWORD, deviceName: "Phone" });
    expect(login.memberId).toBe(registered.memberId);
    expect(login.deviceId).toBeTruthy();
    const context = await sessions.authenticateAccess(login.accessToken);
    expect(context.memberId).toBe(registered.memberId);
  });

  it("rejects a wrong password without issuing a session", async () => {
    const { auth, delivery, sessionsRepo } = harness();
    await register(auth, delivery);
    const sessionsAfterRegister = sessionsRepo.records.size;

    await expect(
      auth.login({ phone: PHONE, password: OTHER_PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "MEMBER_CREDENTIALS_INVALID" }),
    });
    expect(sessionsRepo.records.size).toBe(sessionsAfterRegister);
  });

  it("rejects an unknown phone with the same generic code as a wrong password", async () => {
    const { auth } = harness();
    await expect(
      auth.login({ phone: UNKNOWN_PHONE, password: PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "MEMBER_CREDENTIALS_INVALID" }),
    });
  });

  it("routes an existing Member without a credential to enrollment instead of denying them", async () => {
    const { auth, members } = harness();
    const legacy = legacyMember();
    members.members.set(legacy.id, legacy);

    await expect(auth.login({ phone: PHONE, password: PASSWORD })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PASSWORD_ENROLLMENT_REQUIRED" }),
    });
    expect(members.members.get(legacy.id)!.passwordHash).toBeNull();
  });

  it("locks the credential after the configured number of failures and clears it on success", async () => {
    const { auth, delivery, members } = harness();
    const registered = await register(auth, delivery);
    const maxAttempts = getEnvironment().MEMBER_LOGIN_MAX_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await expect(
        auth.login({ phone: PHONE, password: OTHER_PASSWORD }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "MEMBER_CREDENTIALS_INVALID" }),
      });
    }

    const locked = members.members.get(registered.memberId)!;
    expect(locked.lockedUntil).toBeInstanceOf(Date);
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Even the correct credential is refused while the lock stands, and the
    // refusal is reported as a retry window rather than as "wrong password".
    await expect(auth.login({ phone: PHONE, password: PASSWORD })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "MEMBER_LOGIN_LOCKED",
        details: { retryAfterSeconds: expect.any(Number) },
      }),
    });

    // Once the lock expires the correct credential succeeds and resets state.
    members.members.set(registered.memberId, {
      ...members.members.get(registered.memberId)!,
      lockedUntil: new Date(Date.now() - 1_000),
    });
    await expect(auth.login({ phone: PHONE, password: PASSWORD })).resolves.toMatchObject({
      memberId: registered.memberId,
    });
    const cleared = members.members.get(registered.memberId)!;
    expect(cleared.failedLoginAttempts).toBe(0);
    expect(cleared.lockedUntil).toBeNull();
  });

  it("refuses a disabled Member even with the correct password", async () => {
    const { auth, delivery, members } = harness();
    const registered = await register(auth, delivery);
    members.members.set(registered.memberId, {
      ...members.members.get(registered.memberId)!,
      status: "DISABLED",
    });
    await expect(auth.login({ phone: PHONE, password: PASSWORD })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "ACCOUNT_DISABLED" }),
    });
  });
});

describe("MemberAuthService password enrollment (CR #141)", () => {
  it("sets a credential for a legacy Member without issuing a session", async () => {
    const { auth, members, delivery, sessionsRepo } = harness();
    const legacy = legacyMember();
    members.members.set(legacy.id, legacy);

    await auth.requestOtp("PASSWORD_ENROLL", PHONE);
    const code = delivery.lastCode(PHONE, "PASSWORD_ENROLL")!;
    const result = await auth.verifyOtp("PASSWORD_ENROLL", PHONE, code, PASSWORD);

    expect(result).toMatchObject({
      purpose: "PASSWORD_ENROLL",
      memberId: legacy.id,
      passwordSet: true,
    });
    expect("accessToken" in result).toBe(false);
    expect(sessionsRepo.records.size).toBe(0);
    expect(members.members.get(legacy.id)!.passwordHash).toMatch(/^scrypt-v1\$/);

    // The enrolled credential is immediately usable for password login.
    await expect(
      auth.login({ phone: PHONE, password: PASSWORD, deviceName: "Phone" }),
    ).resolves.toMatchObject({ memberId: legacy.id });
  });

  it("rejects enrollment for a phone with no Member account", async () => {
    const { auth, delivery } = harness();
    await auth.requestOtp("PASSWORD_ENROLL", UNKNOWN_PHONE);
    const code = delivery.lastCode(UNKNOWN_PHONE, "PASSWORD_ENROLL")!;
    await expect(
      auth.verifyOtp("PASSWORD_ENROLL", UNKNOWN_PHONE, code, PASSWORD),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "MEMBER_NOT_REGISTERED" }),
    });
  });
});

describe("MemberAuthService password reset (CR #141)", () => {
  it("resets a forgotten password with RECOVERY evidence and revokes existing sessions", async () => {
    const { auth, delivery, sessionsRepo, members } = harness();
    const registered = await register(auth, delivery);
    expect(sessionsRepo.records.size).toBe(1);

    await auth.requestRecoveryOtp(PHONE);
    const code = delivery.lastCode(PHONE, "RECOVERY")!;
    const result = await auth.resetMemberPassword({
      phone: PHONE,
      code,
      password: OTHER_PASSWORD,
    });
    expect(result).toMatchObject({
      purpose: "RECOVERY",
      memberId: registered.memberId,
      passwordReset: true,
    });

    // Every session established with the replaced credential is gone.
    expect([...sessionsRepo.records.values()].every((r) => r.revokedAt !== null)).toBe(true);
    expect(members.members.get(registered.memberId)!.passwordHash).toMatch(/^scrypt-v1\$/);

    await expect(auth.login({ phone: PHONE, password: PASSWORD })).rejects.toThrow();
    await expect(
      auth.login({ phone: PHONE, password: OTHER_PASSWORD, deviceName: "Phone" }),
    ).resolves.toMatchObject({ memberId: registered.memberId });

    // The single-use RECOVERY challenge cannot be replayed for a second reset.
    await expect(
      auth.resetMemberPassword({ phone: PHONE, code, password: PASSWORD }),
    ).rejects.toThrow();
  });

  it("requires enrollment instead of a reset for a Member without a credential", async () => {
    const { auth, delivery, members } = harness();
    const legacy = legacyMember();
    members.members.set(legacy.id, legacy);

    await auth.requestRecoveryOtp(PHONE);
    const code = delivery.lastCode(PHONE, "RECOVERY")!;
    await expect(
      auth.resetMemberPassword({ phone: PHONE, code, password: PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PASSWORD_ENROLLMENT_REQUIRED" }),
    });
  });
});

describe("MemberAuthService recovery possession evidence", () => {
  it("verifies RECOVERY OTP once without creating a Member, device, or session", async () => {
    const { auth, delivery, members, sessionsRepo } = harness();
    await expect(auth.requestRecoveryOtp(PHONE)).resolves.toMatchObject({
      purpose: "RECOVERY",
      retryAfterSeconds: null,
    });
    const code = delivery.lastCode(PHONE, "RECOVERY");
    expect(code).toBeTruthy();

    const result = await auth.verifyRecoveryOtp(PHONE, code!);
    expect(result).toMatchObject({ purpose: "RECOVERY", verified: true });
    expect(result.evidenceRef).toMatch(/^otp-challenge:/);
    expect(members.members.size).toBe(0);
    expect(members.devices.size).toBe(0);
    expect(sessionsRepo.records.size).toBe(0);

    await expect(auth.verifyRecoveryOtp(PHONE, code!)).rejects.toThrow();
    expect(members.members.size).toBe(0);
    expect(sessionsRepo.records.size).toBe(0);
  });
});

describe("MemberAuthService refresh rotation", () => {
  it("issues a session whose refresh token rotates and rejects reuse", async () => {
    const { auth, delivery, sessionsRepo, sessions } = harness();
    const issued = await register(auth, delivery);
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
    const issued = await register(auth, delivery);
    const list = await auth.listSessions(issued.memberId);
    expect(list.length).toBe(1);
    await auth.revokeSession(issued.memberId, list[0]!.sessionId);
    await expect(auth.refresh(issued.refreshToken)).rejects.toThrow();
    expect([...sessionsRepo.records.values()].every((r) => r.revokedAt !== null)).toBe(true);
  });
});

describe("MemberAuthService identity view", () => {
  it("reports credential enrollment without ever exposing the encoded hash", async () => {
    const { auth, delivery, members } = harness();
    const registered = await register(auth, delivery);
    const view = await auth.me(registered.memberId);
    expect(view.passwordEnrolled).toBe(true);
    expect(Object.keys(view).sort()).toEqual(["memberId", "passwordEnrolled", "phone", "status"]);
    const encoded = members.members.get(registered.memberId)!.passwordHash!;
    expect(JSON.stringify(view)).not.toContain(encoded);
  });
});

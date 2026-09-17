import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalMemberOtpDelivery } from "../../src/contexts/identity-access/application/local-member-otp-delivery";
import { MemberAuthService } from "../../src/contexts/identity-access/application/member-auth.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { PrismaMemberAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-member-auth.repository";
import { PrismaSessionRepository } from "../../src/contexts/identity-access/infrastructure/prisma-session.repository";
import {
  getEnvironment,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const phonePrefix = "099"; // guaranteed-unregistered Thai mobile integration namespace

const PASSWORD = "integration-strong-passphrase";
const OTHER_PASSWORD = "second-strong-passphrase";

describe.runIf(runIntegration)("Member auth integration", () => {
  let prisma: PrismaService;
  let auth: MemberAuthService;
  let sessions: SessionService;
  let delivery: LocalMemberOtpDelivery;

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    const memberRepo = new PrismaMemberAuthRepository(prisma);
    delivery = new LocalMemberOtpDelivery();
    sessions = new SessionService(new PrismaSessionRepository(prisma), new JwtService());
    auth = new MemberAuthService(memberRepo, delivery, sessions);
  });

  afterAll(async () => {
    await prisma.memberDevice.deleteMany({
      where: { member: { phone: { startsWith: phonePrefix } } },
    });
    await prisma.memberOtpChallenge.deleteMany({
      where: { phone: { startsWith: phonePrefix } },
    });
    const members = await prisma.member.findMany({
      where: { phone: { startsWith: phonePrefix } },
      select: { id: true },
    });
    await prisma.authSession.deleteMany({
      where: { memberId: { in: members.map((m) => m.id) } },
    });
    await prisma.member.deleteMany({
      where: { phone: { startsWith: phonePrefix } },
    });
    await prisma.$disconnect();
  });

  function freshPhone(): string {
    return `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 7)}`;
  }

  /** Creates the persisted row exactly as a pre-CR #141 Member looks. */
  async function seedLegacyMember(phone: string): Promise<{ id: string }> {
    return prisma.member.create({ data: { phone }, select: { id: true } });
  }

  async function register(phone: string, password = PASSWORD) {
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;
    const result = await auth.verifyOtp("REGISTER", phone, code, password, "Integration Phone");
    if (result.purpose !== "REGISTER") throw new Error("expected a REGISTER result");
    return result;
  }

  it("registers with a password, persists only the encoded credential, and logs in with phone + password", async () => {
    const phone = freshPhone();
    const registered = await register(phone);
    expect(registered.accountCreated).toBe(true);

    const persisted = await prisma.member.findUniqueOrThrow({ where: { phone } });
    expect(persisted.status).toBe("ACTIVE");
    expect(registered.memberId).toBe(persisted.id);
    expect(persisted.passwordHash).toMatch(/^scrypt-v1\$/);
    // The plaintext credential never reaches the database.
    expect(persisted.passwordHash).not.toContain(PASSWORD);
    expect(persisted.passwordUpdatedAt).not.toBeNull();

    const login = await auth.login({ phone, password: PASSWORD, deviceName: "Integration Phone" });
    expect(login.memberId).toBe(persisted.id);
    const context = await sessions.authenticateAccess(login.accessToken);
    expect(context.memberId).toBe(persisted.id);

    // The identity view reports enrollment without exposing the hash.
    const me = await auth.me(persisted.id);
    expect(me.passwordEnrolled).toBe(true);
    expect(JSON.stringify(me)).not.toContain(persisted.passwordHash!);

    // Rotating refresh still applies to a password-established session.
    const rotated = await auth.refresh(login.refreshToken);
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
  });

  it("denies a wrong password and an unknown phone with the same generic error", async () => {
    const phone = freshPhone();
    const registered = await register(phone);
    const sessionsBefore = await prisma.authSession.count({
      where: { memberId: registered.memberId },
    });

    await expect(
      auth.login({ phone, password: OTHER_PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "MEMBER_CREDENTIALS_INVALID" }),
    });
    await expect(
      auth.login({ phone: freshPhone(), password: PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "MEMBER_CREDENTIALS_INVALID" }),
    });
    expect(
      await prisma.authSession.count({ where: { memberId: registered.memberId } }),
    ).toBe(sessionsBefore);
  });

  it("routes a pre-CR Member without a credential to enrollment instead of locking them out", async () => {
    const phone = freshPhone();
    const legacy = await seedLegacyMember(phone);
    expect(
      (await prisma.member.findUniqueOrThrow({ where: { id: legacy.id } })).passwordHash,
    ).toBeNull();

    await expect(
      auth.login({ phone, password: PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PASSWORD_ENROLLMENT_REQUIRED" }),
    });

    // Enrollment with a single OTP possession proof sets the credential and
    // deliberately does not create a session (OTP is not a login channel).
    await auth.requestOtp("PASSWORD_ENROLL", phone);
    const code = delivery.lastCode(phone, "PASSWORD_ENROLL")!;
    const enrolled = await auth.verifyOtp("PASSWORD_ENROLL", phone, code, PASSWORD);
    expect(enrolled).toMatchObject({ purpose: "PASSWORD_ENROLL", memberId: legacy.id, passwordSet: true });
    expect("accessToken" in enrolled).toBe(false);
    expect(await prisma.authSession.count({ where: { memberId: legacy.id } })).toBe(0);

    const persisted = await prisma.member.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(persisted.passwordHash).toMatch(/^scrypt-v1\$/);

    await expect(
      auth.login({ phone, password: PASSWORD, deviceName: "Legacy Phone" }),
    ).resolves.toMatchObject({ memberId: legacy.id });
  });

  it("refuses REGISTER for an existing phone instead of authenticating it", async () => {
    const phone = freshPhone();
    await register(phone);

    // Keep the test deterministic without sleeping: the resend cooldown from the
    // registration challenge is moved into the past so the second request is
    // issued rather than rejected by the cooldown limiter.
    await prisma.memberOtpChallenge.updateMany({
      where: { phone, purpose: "REGISTER" },
      data: { cooldownUntil: new Date(Date.now() - 1_000) },
    });
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;
    await expect(
      auth.verifyOtp("REGISTER", phone, code, OTHER_PASSWORD, "Second Device"),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "MEMBER_ALREADY_REGISTERED" }),
    });
  });

  it("persists failed-attempt state and blocks the credential until the lock expires", async () => {
    const phone = freshPhone();
    const registered = await register(phone);
    const maxAttempts = getEnvironment().MEMBER_LOGIN_MAX_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await expect(
        auth.login({ phone, password: OTHER_PASSWORD }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "MEMBER_CREDENTIALS_INVALID" }),
      });
    }

    const locked = await prisma.member.findUniqueOrThrow({ where: { id: registered.memberId } });
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    await expect(
      auth.login({ phone, password: PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "MEMBER_LOGIN_LOCKED" }),
    });

    // Expiring the lock restores login and clears the failure counter.
    await prisma.member.update({
      where: { id: registered.memberId },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });
    await expect(
      auth.login({ phone, password: PASSWORD, deviceName: "Integration Phone" }),
    ).resolves.toMatchObject({ memberId: registered.memberId });
    const cleared = await prisma.member.findUniqueOrThrow({ where: { id: registered.memberId } });
    expect(cleared.failedLoginAttempts).toBe(0);
    expect(cleared.lockedUntil).toBeNull();
  });

  it("resets a forgotten password with RECOVERY evidence and revokes the persisted sessions", async () => {
    const phone = freshPhone();
    const registered = await register(phone);
    expect(
      await prisma.authSession.count({
        where: { memberId: registered.memberId, revokedAt: null },
      }),
    ).toBe(1);

    await auth.requestRecoveryOtp(phone);
    const code = delivery.lastCode(phone, "RECOVERY")!;
    const reset = await auth.resetMemberPassword({ phone, code, password: OTHER_PASSWORD });
    expect(reset).toMatchObject({ purpose: "RECOVERY", memberId: registered.memberId, passwordReset: true });

    expect(
      await prisma.authSession.count({
        where: { memberId: registered.memberId, revokedAt: null },
      }),
    ).toBe(0);

    await expect(auth.login({ phone, password: PASSWORD })).rejects.toThrow();
    await expect(
      auth.login({ phone, password: OTHER_PASSWORD, deviceName: "Integration Phone" }),
    ).resolves.toMatchObject({ memberId: registered.memberId });

    // The single-use RECOVERY challenge cannot be replayed into a second reset.
    await expect(
      auth.resetMemberPassword({ phone, code, password: PASSWORD }),
    ).rejects.toThrow();
  });

  it("keeps the phone in the local Thai format in storage and in every response", async () => {
    const phone = freshPhone();
    const otp = await auth.requestOtp("REGISTER", phone);
    expect(otp.deliveredTo).toBe(phone);
    expect(phone).toMatch(/^0[2-9]\d{8}$/);

    const code = delivery.lastCode(phone, "REGISTER")!;
    const registered = await auth.verifyOtp("REGISTER", phone, code, PASSWORD, "Integration Phone");

    const persisted = await prisma.member.findUniqueOrThrow({ where: { phone } });
    expect(persisted.phone).toBe(phone);
    expect(persisted.phone.startsWith("+")).toBe(false);
    expect(persisted.phone.startsWith("66")).toBe(false);

    const me = await auth.me(registered.memberId);
    expect(me.phone).toBe(phone);

    // An international spelling is still accepted on input and is converted to
    // the stored local form rather than being stored as given.
    const login = await auth.login({
      phone: `+66${phone.slice(1)}`,
      password: PASSWORD,
      deviceName: "Integration Phone",
    });
    expect(login.memberId).toBe(registered.memberId);
  });

  it("rejects the retired LOGIN purpose for both OTP request and verify", async () => {
    const phone = freshPhone();
    await expect(auth.requestOtp("LOGIN", phone)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_PURPOSE_INVALID" }),
    });
    await expect(
      auth.verifyOtp("LOGIN", phone, "123456", PASSWORD, "Integration Phone"),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_PURPOSE_INVALID" }),
    });
  });

  it("enforces single-use OTP and rejects replay", async () => {
    const phone = freshPhone();
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;

    await auth.verifyOtp("REGISTER", phone, code, PASSWORD, "Integration Phone");
    await expect(
      auth.verifyOtp("REGISTER", phone, code, PASSWORD, "Integration Phone"),
    ).rejects.toThrow();
  });

  it("persists single-use RECOVERY possession evidence without creating authentication state", async () => {
    const phone = freshPhone();
    await auth.requestRecoveryOtp(phone);
    const code = delivery.lastCode(phone, "RECOVERY");
    expect(code).toMatch(/^\d{6}$/);

    const result = await auth.verifyRecoveryOtp(phone, code!);
    expect(result).toMatchObject({ purpose: "RECOVERY", verified: true });
    expect(result.evidenceRef).toMatch(/^otp-challenge:/);

    const challenge = await prisma.memberOtpChallenge.findFirstOrThrow({
      where: { phone, purpose: "RECOVERY" },
      orderBy: { createdAt: "desc" },
    });
    expect(challenge.consumedAt).not.toBeNull();
    expect(challenge.memberId).toBeNull();
    expect(await prisma.member.findUnique({ where: { phone } })).toBeNull();

    await expect(auth.verifyRecoveryOtp(phone, code!)).rejects.toThrow();
  });

  it("enforces the resend cooldown per purpose and keeps buckets isolated", async () => {
    const phone = freshPhone();
    await expect(auth.requestOtp("REGISTER", phone)).resolves.toMatchObject({
      purpose: "REGISTER",
      retryAfterSeconds: null,
    });
    await expect(auth.requestOtp("REGISTER", phone)).rejects.toThrow(
      "Please wait before requesting another code",
    );
    // PASSWORD_ENROLL is its own bucket, so it is not cooldown-blocked.
    await expect(auth.requestOtp("PASSWORD_ENROLL", phone)).resolves.toMatchObject({
      purpose: "PASSWORD_ENROLL",
    });
  });

  it("enforces the rolling OTP request window in persisted state", async () => {
    const phone = freshPhone();

    for (let issued = 0; issued < getEnvironment().MEMBER_OTP_REQUEST_MAX_PER_WINDOW; issued += 1) {
      await expect(auth.requestOtp("REGISTER", phone)).resolves.toMatchObject({
        purpose: "REGISTER",
        retryAfterSeconds: null,
      });

      // Keep the test deterministic without sleeping: the request-window count
      // remains authoritative in the database, while the most recent cooldown is
      // moved into the past so the next request can exercise the rolling-window
      // limiter rather than the resend-cooldown limiter.
      await prisma.memberOtpChallenge.updateMany({
        where: { phone, purpose: "REGISTER", consumedAt: null },
        data: { cooldownUntil: new Date(Date.now() - 1_000) },
      });
    }

    await expect(auth.requestOtp("REGISTER", phone)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_RATE_LIMITED" }),
    });

    const persisted = await prisma.memberOtpChallenge.count({
      where: { phone, purpose: "REGISTER" },
    });
    expect(persisted).toBe(getEnvironment().MEMBER_OTP_REQUEST_MAX_PER_WINDOW);
  });

  it("exhausts OTP verify attempts before a later correct code can enroll", async () => {
    const phone = freshPhone();
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < getEnvironment().MEMBER_OTP_MAX_ATTEMPTS; attempt += 1) {
      await expect(
        auth.verifyOtp("REGISTER", phone, wrong, PASSWORD, "Integration Phone"),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "OTP_INVALID" }),
      });
    }

    await expect(
      auth.verifyOtp("REGISTER", phone, code, PASSWORD, "Integration Phone"),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_ATTEMPTS_EXHAUSTED" }),
    });

    const challenge = await prisma.memberOtpChallenge.findFirstOrThrow({
      where: { phone, purpose: "REGISTER" },
      orderBy: { createdAt: "desc" },
    });
    expect(challenge.attemptsUsed).toBe(getEnvironment().MEMBER_OTP_MAX_ATTEMPTS);
    expect(challenge.consumedAt).toBeNull();
    expect(await prisma.member.findUnique({ where: { phone } })).toBeNull();
  });

  it("scopes device revocation to the owning Member's sessions", async () => {
    const phone = freshPhone();
    const registered = await register(phone);

    const first = await auth.login({ phone, password: PASSWORD, deviceName: "First Device" });
    // The registration session has its own device, so two logins add two more.
    const second = await auth.login({ phone, password: PASSWORD, deviceName: "Second Device" });
    expect(second.memberId).toBe(registered.memberId);

    expect((await auth.listDevices(registered.memberId)).length).toBe(3);
    expect((await auth.listSessions(registered.memberId)).length).toBe(3);

    await auth.revokeDevice(registered.memberId, first.deviceId!);
    const remaining = await auth.listSessions(registered.memberId);
    expect(remaining.length).toBe(2);
    expect(remaining.some((session) => session.deviceId === first.deviceId)).toBe(false);
    expect(remaining.some((session) => session.deviceId === second.deviceId)).toBe(true);
  });

  it("revokes the session family when a rotated-away refresh token is reused", async () => {
    const phone = freshPhone();
    await register(phone);
    const issued = await auth.login({ phone, password: PASSWORD, deviceName: "Integration Phone" });

    const rotated = await auth.refresh(issued.refreshToken);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);

    // Replaying the rotated-away token is a reuse signal: the server revokes
    // the whole family so even the freshly rotated access token stops working.
    await expect(auth.refresh(issued.refreshToken)).rejects.toThrow();
    await expect(auth.refresh(rotated.refreshToken)).rejects.toThrow();
    await expect(sessions.authenticateAccess(rotated.accessToken)).rejects.toThrow();
  });
});

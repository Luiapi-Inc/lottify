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
const phonePrefix = "+6699"; // guaranteed-unregistered Thai mobile integration namespace

describe.runIf(runIntegration)("Member auth integration", () => {
  let prisma: PrismaService;
  let auth: MemberAuthService;
  let sessions: SessionService;
  let delivery: LocalMemberOtpDelivery;

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    const env = getEnvironment();
    const memberRepo = new PrismaMemberAuthRepository(prisma);
    delivery = new LocalMemberOtpDelivery();
    sessions = new SessionService(new PrismaSessionRepository(prisma), new JwtService());
    auth = new MemberAuthService(memberRepo, delivery, sessions);
    void env;
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
    return `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 8)}`;
  }

  it("registers a Member and logs in the same phone via a rotating refresh session", async () => {
    const phone = freshPhone();
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER");
    expect(code).toMatch(/^\d{6}$/);

    const registered = await auth.verifyOtp("REGISTER", phone, code!, "Integration Phone");
    expect(registered.accountCreated).toBe(true);

    const persisted = await prisma.member.findUniqueOrThrow({ where: { phone } });
    expect(persisted.status).toBe("ACTIVE");
    expect(registered.memberId).toBe(persisted.id);

    // The issued access token authenticates as the Member and not as Admin.
    const context = await sessions.authenticateAccess(registered.accessToken);
    expect(context.memberId).toBe(persisted.id);

    // Rotating refresh: the same phone can log in again with a new OTP.
    await auth.requestOtp("LOGIN", phone);
    const loginCode = delivery.lastCode(phone, "LOGIN");
    const loggedIn = await auth.verifyOtp("LOGIN", phone, loginCode!, "Integration Phone");
    expect(loggedIn.accountCreated).toBe(false);
    expect(loggedIn.memberId).toBe(persisted.id);
  });

  it("denies LOGIN for an unregistered phone and wrong OTP codes", async () => {
    const phone = freshPhone();
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;

    const wrong = code === "000000" ? "111111" : "000000";
    await expect(auth.verifyOtp("REGISTER", phone, wrong, "Phone")).rejects.toThrow();

    // LOGIN on a phone that has not completed REGISTER is routed to registration.
    await auth.requestOtp("LOGIN", phone);
    const loginCode = delivery.lastCode(phone, "LOGIN")!;
    await expect(auth.verifyOtp("LOGIN", phone, loginCode, "Phone")).rejects.toThrow(
      "No Member is registered for this phone",
    );
  });

  it("enforces single-use OTP and rejects replay", async () => {
    const phone = freshPhone();
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;

    await auth.verifyOtp("REGISTER", phone, code, "Phone");
    await expect(auth.verifyOtp("REGISTER", phone, code, "Phone")).rejects.toThrow();
  });

  it("enforces per-purpose request rate limits server-side", async () => {
    const phone = freshPhone();
    const env = getEnvironment();
    // Keep the test bounded: drive the window counter to the configured limit.
    const limit = env.MEMBER_OTP_REQUEST_MAX_PER_WINDOW;
    const issued: string[] = [];
    for (let i = 0; i < limit; i += 1) {
      await auth.requestOtp("REGISTER", phone);
      issued.push(delivery.lastCode(phone, "REGISTER")!);
    }
    await expect(auth.requestOtp("REGISTER", phone)).rejects.toThrow(
      "Too many OTP requests",
    );
    // Purposely separate buckets for LOGIN are not exhausted.
    await expect(auth.requestOtp("LOGIN", phone)).resolves.toMatchObject({
      purpose: "LOGIN",
    });
  });

  it("scopes device revocation to the owning Member's sessions", async () => {
    const phone = freshPhone();
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;
    const first = await auth.verifyOtp("REGISTER", phone, code, "First Device");

    await auth.requestOtp("REGISTER", phone);
    const secondCode = delivery.lastCode(phone, "REGISTER")!;
    const second = await auth.verifyOtp("REGISTER", phone, secondCode, "Second Device");
    expect(second.accountCreated).toBe(false);

    expect((await auth.listDevices(first.memberId)).length).toBe(2);

    await auth.revokeDevice(first.memberId, first.deviceId!);
    const remaining = await auth.listSessions(first.memberId);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.deviceId).toBe(second.deviceId);
  });
});

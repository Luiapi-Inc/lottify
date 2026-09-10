import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalMemberOtpDelivery } from "../../src/contexts/identity-access/application/local-member-otp-delivery";
import { MemberAuthService } from "../../src/contexts/identity-access/application/member-auth.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { PrismaMemberAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-member-auth.repository";
import { PrismaSessionRepository } from "../../src/contexts/identity-access/infrastructure/prisma-session.repository";
import { PreAuthLoginCapabilityAdapter } from "../../src/platform/integration/pre-auth-login-capability.adapter";
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
    auth = new MemberAuthService(
      memberRepo,
      delivery,
      sessions,
      new PreAuthLoginCapabilityAdapter(prisma),
    );
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

  it("enforces the resend cooldown per purpose and keeps buckets isolated", async () => {
    const phone = freshPhone();
    // First request issues immediately (no prior challenge for this phone+purpose).
    await expect(auth.requestOtp("REGISTER", phone)).resolves.toMatchObject({
      purpose: "REGISTER",
      retryAfterSeconds: null,
    });
    // An immediate resend is inside the documented 60s cooldown and is denied.
    await expect(auth.requestOtp("REGISTER", phone)).rejects.toThrow(
      "Please wait before requesting another code",
    );
    // LOGIN is its own bucket, so a fresh LOGIN request is not cooldown-blocked.
    await expect(auth.requestOtp("LOGIN", phone)).resolves.toMatchObject({
      purpose: "LOGIN",
    });
  });

  it("scopes device revocation to the owning Member's sessions", async () => {
    const phone = freshPhone();
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;
    const first = await auth.verifyOtp("REGISTER", phone, code, "First Device");

    // Log in again on a second device via the separate LOGIN purpose bucket so
    // the 60s REGISTER resend cooldown does not block the second session.
    await auth.requestOtp("LOGIN", phone);
    const loginCode = delivery.lastCode(phone, "LOGIN")!;
    const second = await auth.verifyOtp("LOGIN", phone, loginCode, "Second Device");
    expect(second.accountCreated).toBe(false);
    expect(second.memberId).toBe(first.memberId);

    expect((await auth.listDevices(first.memberId)).length).toBe(2);

    await auth.revokeDevice(first.memberId, first.deviceId!);
    const remaining = await auth.listSessions(first.memberId);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.deviceId).toBe(second.deviceId);
  });

  it("revokes the session family when a rotated-away refresh token is reused", async () => {
    const phone = freshPhone();
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER")!;
    const issued = await auth.verifyOtp("REGISTER", phone, code, "Phone");

    const rotated = await auth.refresh(issued.refreshToken);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);

    // Replaying the rotated-away token is a reuse signal: the server revokes
    // the whole family so even the freshly rotated access token stops working.
    await expect(auth.refresh(issued.refreshToken)).rejects.toThrow();
    await expect(auth.refresh(rotated.refreshToken)).rejects.toThrow();
    await expect(
      sessions.authenticateAccess(rotated.accessToken),
    ).rejects.toThrow();
  });
});

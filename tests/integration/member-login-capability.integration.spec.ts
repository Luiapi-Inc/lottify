import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalMemberOtpDelivery } from "../../src/contexts/identity-access/application/local-member-otp-delivery";
import { MemberAuthService } from "../../src/contexts/identity-access/application/member-auth.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { PrismaMemberAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-member-auth.repository";
import { PrismaSessionRepository } from "../../src/contexts/identity-access/infrastructure/prisma-session.repository";
import { CapabilityRestrictionAdminService } from "../../src/contexts/member/application/capability-restriction-admin.service";
import { PreAuthLoginCapabilityAdapter } from "../../src/platform/integration/pre-auth-login-capability.adapter";
import {
  getEnvironment,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const phonePrefix = "+6693"; // pre-auth login capability integration namespace

/**
 * Pre-auth enforcement of the persisted `LOGIN_BLOCKED` capability restriction
 * (Issue 66 follow-up) against a real Postgres:
 *   - an effective `LOGIN_BLOCKED` restriction denies session establishment with
 *     a stable coded reason and issues no session,
 *   - only that restriction type gates login (a `BET_BLOCKED`, including a
 *     responsible-gaming self-exclusion, does not),
 *   - the effective period is honoured (not yet effective / expired rows do not
 *     gate) and clearing the restriction restores login,
 *   - OTP request is unchanged (the denial is not an account-enumeration tell),
 *   - a self-exclusion restriction is not removable through the normal Admin
 *     path (enforced by the merged Member-context rule).
 *
 * The OTP resend cooldown is relaxed to 1s here because this suite exercises
 * repeated logins for one phone; the cooldown itself is covered by the Member
 * auth integration suite.
 */
describe.runIf(runIntegration)("Member pre-auth login capability gate", () => {
  let prisma: PrismaService;
  let auth: MemberAuthService;
  let sessions: SessionService;
  let delivery: LocalMemberOtpDelivery;
  let restrictionAdmin: CapabilityRestrictionAdminService;
  /** Phones this suite registered, so cleanup never touches another row. */
  const createdPhones: string[] = [];

  beforeAll(async () => {
    process.env.MEMBER_OTP_RESEND_COOLDOWN_SECONDS = "1";
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    void getEnvironment();
    delivery = new LocalMemberOtpDelivery();
    sessions = new SessionService(
      new PrismaSessionRepository(prisma),
      new JwtService(),
      new PreAuthLoginCapabilityAdapter(prisma),
    );
    auth = new MemberAuthService(
      new PrismaMemberAuthRepository(prisma),
      delivery,
      sessions,
      new PreAuthLoginCapabilityAdapter(prisma),
    );
    restrictionAdmin = new CapabilityRestrictionAdminService(prisma);
  });

  afterAll(async () => {
    await prisma.memberDevice.deleteMany({
      where: { member: { phone: { in: createdPhones } } },
    });
    await prisma.memberOtpChallenge.deleteMany({
      where: { phone: { in: createdPhones } },
    });
    const members = await prisma.member.findMany({
      where: { phone: { in: createdPhones } },
      select: { id: true },
    });
    const memberIds = members.map((member) => member.id);
    await prisma.authSession.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.capabilityRestriction.deleteMany({
      where: { memberId: { in: memberIds } },
    });
    // Cleanup is scoped to the exact Members this suite created: the shared dev
    // database holds rows from other verticals (including a stale `+6693%` row
    // whose phone is not a number), so a prefix-wide delete is not safe.
    await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
    await prisma.$disconnect();
  });

  function freshPhone(): string {
    return `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 8)}`;
  }

  /** Registers a Member through the real OTP boundary and returns its id. */
  async function registerMember(phone: string): Promise<string> {
    createdPhones.push(phone);
    await auth.requestOtp("REGISTER", phone);
    const code = delivery.lastCode(phone, "REGISTER");
    const registered = await auth.verifyOtp("REGISTER", phone, code!, "Gate Phone");
    expect(registered.accountCreated).toBe(true);
    return registered.memberId;
  }

  async function seedRestriction(
    memberId: string,
    input: {
      type: string;
      source?: string;
      effectiveFrom?: Date;
      effectiveUntil?: Date | null;
      actorOrPolicyRef?: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await prisma.capabilityRestriction.create({
      data: {
        id,
        memberId,
        type: input.type,
        source: input.source ?? "admin",
        reason: "integration gate evidence",
        effectiveFrom: input.effectiveFrom ?? new Date(Date.now() - 60_000),
        effectiveUntil: input.effectiveUntil ?? null,
        actorOrPolicyRef: input.actorOrPolicyRef ?? "admin:integration-gate",
      },
    });
    return id;
  }

  /** Drops the registration session so a later count is unambiguous. */
  async function clearSessions(memberId: string): Promise<void> {
    await prisma.authSession.deleteMany({ where: { memberId } });
  }

  async function activeSessionCount(memberId: string): Promise<number> {
    return prisma.authSession.count({ where: { memberId, revokedAt: null } });
  }

  async function loginAttempt(phone: string) {
    await auth.requestOtp("LOGIN", phone);
    const code = delivery.lastCode(phone, "LOGIN");
    return auth.verifyOtp("LOGIN", phone, code!, "Gate Phone");
  }

  it("denies session establishment for an effective LOGIN_BLOCKED restriction", async () => {
    const phone = freshPhone();
    const memberId = await registerMember(phone);
    await clearSessions(memberId);
    await seedRestriction(memberId, { type: "LOGIN_BLOCKED" });

    // OTP request is unchanged for a blocked Member: the denial is not an
    // account-enumeration tell and issuance is identical to the allow path.
    await expect(auth.requestOtp("LOGIN", phone)).resolves.toMatchObject({
      purpose: "LOGIN",
      deliveredTo: phone,
      retryAfterSeconds: null,
    });
    const code = delivery.lastCode(phone, "LOGIN");

    await expect(
      auth.verifyOtp("LOGIN", phone, code!, "Blocked Phone"),
    ).rejects.toMatchObject({
      response: { code: "CAPABILITY_BLOCKED" },
    });

    expect(await activeSessionCount(memberId)).toBe(0);
    expect(await auth.listSessions(memberId)).toHaveLength(0);
  });

  it("gates login only on LOGIN_BLOCKED, never on another capability's restriction", async () => {
    const phone = freshPhone();
    const memberId = await registerMember(phone);
    await clearSessions(memberId);
    // A responsible-gaming self-exclusion is modelled as BET_BLOCKED by the
    // merged Member-context rule, so it must not gate login.
    await seedRestriction(memberId, {
      type: "BET_BLOCKED",
      source: "self-exclusion",
      actorOrPolicyRef: "self-exclusion:integration-gate",
    });
    await seedRestriction(memberId, { type: "WITHDRAWAL_BLOCKED" });
    await seedRestriction(memberId, { type: "DEPOSIT_BLOCKED" });
    await seedRestriction(memberId, { type: "PROMOTION_BLOCKED" });

    const loggedIn = await loginAttempt(phone);

    expect(loggedIn.memberId).toBe(memberId);
    expect(await activeSessionCount(memberId)).toBe(1);

    // The self-exclusion restriction itself stays protected: the normal Admin
    // clear path refuses to remove it.
    const selfExclusion = await prisma.capabilityRestriction.findFirstOrThrow({
      where: { memberId, source: "self-exclusion" },
      select: { id: true },
    });
    await expect(
      restrictionAdmin.clearRestriction({
        restrictionId: selfExclusion.id,
        actor: { adminId: randomUUID(), sessionId: randomUUID(), role: "ADMIN" },
        reason: "integration attempt",
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "SELF_EXCLUSION_NOT_REMOVABLE",
      details: { restrictionId: selfExclusion.id },
    });
    expect(
      await prisma.capabilityRestriction.count({ where: { id: selfExclusion.id } }),
    ).toBe(1);
  });

  it("honours the effective period: a future or expired LOGIN_BLOCKED never gates", async () => {
    const phone = freshPhone();
    const memberId = await registerMember(phone);
    await clearSessions(memberId);
    await seedRestriction(memberId, {
      type: "LOGIN_BLOCKED",
      effectiveFrom: new Date(Date.now() + 60 * 60 * 1_000),
      actorOrPolicyRef: "admin:integration-gate-future",
    });
    await seedRestriction(memberId, {
      type: "LOGIN_BLOCKED",
      effectiveFrom: new Date(Date.now() - 2 * 60 * 60 * 1_000),
      effectiveUntil: new Date(Date.now() - 60 * 60 * 1_000),
      actorOrPolicyRef: "admin:integration-gate-expired",
    });

    const loggedIn = await loginAttempt(phone);

    expect(loggedIn.memberId).toBe(memberId);
    expect(await activeSessionCount(memberId)).toBe(1);
  });

  it("restores login once the LOGIN_BLOCKED restriction is cleared", async () => {
    const phone = freshPhone();
    const memberId = await registerMember(phone);
    await clearSessions(memberId);
    const restrictionId = await seedRestriction(memberId, { type: "LOGIN_BLOCKED" });

    await auth.requestOtp("LOGIN", phone);
    const blockedCode = delivery.lastCode(phone, "LOGIN");
    await expect(
      auth.verifyOtp("LOGIN", phone, blockedCode!, "Blocked Phone"),
    ).rejects.toMatchObject({
      response: { code: "CAPABILITY_BLOCKED" },
    });
    expect(await activeSessionCount(memberId)).toBe(0);

    await prisma.capabilityRestriction.delete({ where: { id: restrictionId } });
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const loggedIn = await loginAttempt(phone);

    expect(loggedIn.memberId).toBe(memberId);
    expect(await activeSessionCount(memberId)).toBe(1);
  });

  it("denies refresh rotation and access-token use for an in-flight session once LOGIN_BLOCKED is applied", async () => {
    const phone = freshPhone();
    const memberId = await registerMember(phone);
    await clearSessions(memberId);
    // Establish a live session while no restriction is effective.
    await auth.requestOtp("LOGIN", phone);
    const code = delivery.lastCode(phone, "LOGIN");
    const established = await auth.verifyOtp("LOGIN", phone, code!, "Gate Phone");
    expect(established.memberId).toBe(memberId);
    expect(await activeSessionCount(memberId)).toBe(1);

    // The access token is usable before the restriction is applied.
    await expect(
      sessions.authenticateAccess(established.accessToken),
    ).resolves.toMatchObject({ memberId, sessionId: expect.any(String) });

    await seedRestriction(memberId, { type: "LOGIN_BLOCKED" });

    // Both the refresh rotation and the already-issued access token are now
    // denied with the same stable coded reason as the pre-auth boundary.
    await expect(auth.refresh(established.refreshToken)).rejects.toMatchObject({
      response: { code: "CAPABILITY_BLOCKED" },
    });
    await expect(
      sessions.authenticateAccess(established.accessToken),
    ).rejects.toMatchObject({
      response: { code: "CAPABILITY_BLOCKED" },
    });
    // The session row survives (not destructively revoked); only its use is
    // denied while the restriction is effective.
    expect(await activeSessionCount(memberId)).toBe(1);
  });

  it("restores the same in-flight session once the LOGIN_BLOCKED restriction is cleared", async () => {
    const phone = freshPhone();
    const memberId = await registerMember(phone);
    await clearSessions(memberId);
    await auth.requestOtp("LOGIN", phone);
    const code = delivery.lastCode(phone, "LOGIN");
    const established = await auth.verifyOtp("LOGIN", phone, code!, "Gate Phone");
    const restrictionId = await seedRestriction(memberId, {
      type: "LOGIN_BLOCKED",
    });

    await expect(auth.refresh(established.refreshToken)).rejects.toMatchObject({
      response: { code: "CAPABILITY_BLOCKED" },
    });

    await prisma.capabilityRestriction.delete({ where: { id: restrictionId } });

    // The very same session resumes working without a new login: no token
    // rotation was consumed while the restriction was effective, so the
    // original refresh credential still advances the family lineage. Rotation
    // re-issues a fresh access token bound to the advancing session.
    const resumed = await auth.refresh(established.refreshToken);
    expect(resumed.accessToken).toBeTruthy();
    await expect(
      sessions.authenticateAccess(resumed.accessToken),
    ).resolves.toMatchObject({ memberId });
  });

  it("does not gate an in-flight session with a non-LOGIN restriction", async () => {
    const phone = freshPhone();
    const memberId = await registerMember(phone);
    await auth.requestOtp("LOGIN", phone);
    const code = delivery.lastCode(phone, "LOGIN");
    const established = await auth.verifyOtp("LOGIN", phone, code!, "Gate Phone");
    await seedRestriction(memberId, { type: "BET_BLOCKED" });

    await expect(
      sessions.authenticateAccess(established.accessToken),
    ).resolves.toMatchObject({ memberId });
    await expect(
      auth.refresh(established.refreshToken),
    ).resolves.toMatchObject({ accessToken: expect.any(String) });
  });
});

import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import { generateTotpCode, generateTotpSecret } from "../../src/contexts/identity-access/domain/totp";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import {
  getAdminMfaEncryptionKey,
  getEnvironment,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "admin-auth-integration+";

describe.runIf(runIntegration)("Admin auth integration", () => {
  let prisma: PrismaService;
  let auth: AdminAuthService;

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    auth = new AdminAuthService(
      new PrismaAdminAuthRepository(prisma),
      new JwtService(),
    );
  });

  afterAll(async () => {
    await prisma.adminReauthEvidence.deleteMany({
      where: { adminUser: { email: { startsWith: emailPrefix } } },
    });
    await prisma.adminAuthSession.deleteMany({
      where: { adminUser: { email: { startsWith: emailPrefix } } },
    });
    await prisma.adminUser.deleteMany({
      where: { email: { startsWith: emailPrefix } },
    });
    await prisma.$disconnect();
  });

  it("enrolls mandatory TOTP before any authenticated Admin session can exist", async () => {
    const account = await createAdmin(false);
    const first = await auth.login(account.email, account.password);
    expect(first.status).toBe("MFA_SETUP_REQUIRED");
    if (first.status !== "MFA_SETUP_REQUIRED") return;

    await expect(auth.authenticateAccess(first.setupToken)).rejects.toThrow();
    const setup = await auth.setupMfa(first.setupToken);
    const code = generateTotpCode(setup.secret);
    await expect(
      auth.confirmMfa(first.setupToken, setup.secret, code),
    ).resolves.toEqual({ enabled: true });

    const persisted = await prisma.adminUser.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(persisted.mfaEnabled).toBe(true);
    expect(persisted.mfaSecretEncrypted).toBeTruthy();
    expect(persisted.mfaSecretEncrypted).not.toContain(setup.secret);

    const second = await auth.login(account.email, account.password);
    expect(second.status).toBe("MFA_REQUIRED");
  });

  it("rejects Member/pre-MFA tokens and revokes the refresh family on replay", async () => {
    const account = await createAdmin(true);
    const login = await auth.login(account.email, account.password);
    expect(login.status).toBe("MFA_REQUIRED");
    if (login.status !== "MFA_REQUIRED") return;

    await expect(auth.authenticateAccess(login.challengeToken)).rejects.toThrow();

    const memberToken = await new JwtService().signAsync(
      { sub: randomUUID(), sid: randomUUID() },
      {
        secret: getEnvironment().JWT_ACCESS_SECRET,
        expiresIn: getEnvironment().JWT_ACCESS_TTL_SECONDS,
      },
    );
    await expect(auth.authenticateAccess(memberToken)).rejects.toThrow();

    const issued = await auth.verifyMfa(
      login.challengeToken,
      generateTotpCode(account.secret),
      "127.0.0.1",
      "integration-test",
    );
    const context = await auth.authenticateAccess(issued.accessToken);
    expect(context).toMatchObject({
      adminId: account.id,
      role: "ADMIN",
      capabilities: [
        "accounting-period.read",
        "accounting-period.create-custom",
        "accounting-period.submit",
        "accounting-period.approve",
        "accounting-period.cancel",
        "accounting-period.close",
        "lottery-configuration.read",
        "lottery-configuration.create",
        "lottery-configuration.submit",
        "lottery-configuration.approve",
        "lottery-draw.read",
        "lottery-draw.manage",
        "result.read",
        "result.manage",
        "settlement.read",
        "settlement.manage",
        "withdrawal.read",
        "withdrawal.review",
        "withdrawal.payout",
      ],
    });

    const rotated = await auth.refresh(issued.refreshToken);
    await expect(auth.authenticateAccess(rotated.accessToken)).resolves.toMatchObject({
      adminId: account.id,
    });

    await expect(auth.refresh(issued.refreshToken)).rejects.toThrow();
    await expect(auth.authenticateAccess(rotated.accessToken)).rejects.toThrow();
  });

  it("stores fresh-MFA evidence per Admin session and action class", async () => {
    const account = await createAdmin(true);
    const tokens = await issueSession(account);
    const context = await auth.authenticateAccess(tokens.accessToken);

    await expect(
      auth.requireFreshMfa(context, "accounting-period.close"),
    ).rejects.toThrow("Fresh MFA verification required");

    const evidence = await auth.reauthenticate(
      context,
      "accounting-period.close",
      generateTotpCode(account.secret),
    );
    expect(evidence.expiresAt.getTime()).toBeGreaterThan(evidence.verifiedAt.getTime());
    const firstStored = await auth.requireFreshMfa(context, "accounting-period.close");
    expect(firstStored).toMatchObject({
      adminUserId: context.adminId,
      sessionId: context.sessionId,
      actionClass: "accounting-period.close",
    });
    await auth.reauthenticate(
      context,
      "accounting-period.close",
      generateTotpCode(account.secret),
    );
    const secondStored = await auth.requireFreshMfa(context, "accounting-period.close");
    expect(secondStored.id).not.toBe(firstStored.id);
    await expect(
      auth.requireFreshMfa(context, "result.confirm"),
    ).rejects.toThrow("Fresh MFA verification required");
  });

  it("re-evaluates the persisted Admin principal and rejects disabled accounts", async () => {
    const account = await createAdmin(true);
    const tokens = await issueSession(account);
    await expect(auth.authenticateAccess(tokens.accessToken)).resolves.toMatchObject({
      adminId: account.id,
    });

    await prisma.adminUser.update({
      where: { id: account.id },
      data: { status: "DISABLED" },
    });

    await expect(auth.authenticateAccess(tokens.accessToken)).rejects.toThrow(
      "Admin account unavailable",
    );
  });

  it("keeps AUDITOR authority read-only in the current capability slice", async () => {
    const account = await createAdmin(true, "AUDITOR");
    const tokens = await issueSession(account);
    const context = await auth.authenticateAccess(tokens.accessToken);

    expect(context.role).toBe("AUDITOR");
    expect(context.capabilities).toEqual([
      "accounting-period.read",
      "lottery-configuration.read",
      "lottery-draw.read",
      "result.read",
      "settlement.read",
      "withdrawal.read",
    ]);
  });

  async function createAdmin(
    mfaEnabled: boolean,
    role: "SUPER_ADMIN" | "ADMIN" | "AUDITOR" = "ADMIN",
  ) {
    const id = randomUUID();
    const email = `${emailPrefix}${id}@example.com`;
    const password = "Admin integration password 123!";
    const secret = generateTotpSecret();
    await prisma.adminUser.create({
      data: {
        id,
        email,
        name: "Integration Admin",
        passwordHash: await hashAdminPassword(password),
        role,
        status: "ACTIVE",
        mfaEnabled,
        ...(mfaEnabled
          ? {
              mfaSecretEncrypted: encryptAdminSecret(
                secret,
                getAdminMfaEncryptionKey(),
              ),
            }
          : {}),
      },
    });
    return { id, email, password, secret };
  }

  async function issueSession(account: {
    email: string;
    password: string;
    secret: string;
  }) {
    const login = await auth.login(account.email, account.password);
    if (login.status !== "MFA_REQUIRED") {
      throw new Error("Expected MFA challenge for integration Admin");
    }
    return auth.verifyMfa(
      login.challengeToken,
      generateTotpCode(account.secret),
      "127.0.0.1",
      "integration-test",
    );
  }
});

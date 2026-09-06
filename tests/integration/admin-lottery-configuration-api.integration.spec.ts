import "reflect-metadata";
import { Module } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AdminLotteryConfigurationController } from "../../apps/api/src/admin-lottery-configuration.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import type { AdminRole } from "../../src/contexts/identity-access/domain/admin-auth.repository";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import { generateTotpCode, generateTotpSecret } from "../../src/contexts/identity-access/domain/totp";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import { LotteryConfigurationService } from "../../src/contexts/lottery/application/lottery-configuration.service";
import { getAdminMfaEncryptionKey, resetEnvironmentForTests } from "../../src/platform/config/env";
import { IdempotencyService } from "../../src/platform/idempotency/idempotency.service";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "lottery-config-api-integration+";

describe.runIf(runIntegration)("Admin Lottery Configuration API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: AdminAuthService;
  let baseUrl: string;
  const adminIds: string[] = [];
  const betTypeIds: string[] = [];

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    adminAuth = new AdminAuthService(new PrismaAdminAuthRepository(prisma), new JwtService());
    const configuration = new LotteryConfigurationService(prisma);
    const idempotency = new IdempotencyService(prisma);

    @Module({
      controllers: [AdminLotteryConfigurationController],
      providers: [
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: LotteryConfigurationService, useValue: configuration },
        { provide: IdempotencyService, useValue: idempotency },
        { provide: Reflector, useValue: new Reflector() },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"');
    await prisma.auditRecord.deleteMany({ where: { actorAdminId: { in: adminIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { scope: { startsWith: "admin:" } } });
    await prisma.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
    await prisma.adminAuthSession.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.adminReauthEvidence.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.$executeRawUnsafe('ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"');
    await app.close();
    await prisma.$disconnect();
  });

  it("enforces Admin authentication and read capability", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/admin/lottery/products`);
    expect(unauthenticated.status).toBe(401);

    const auditor = await createAdminSession("AUDITOR");
    const readable = await fetch(`${baseUrl}/api/v1/admin/lottery/products`, {
      headers: { Authorization: `Bearer ${auditor.accessToken}` },
    });
    expect(readable.status).toBe(200);
    const readableBody = await readable.json();
    expect(readableBody).toMatchObject({ items: expect.any(Array) });
    expect(readableBody.nextCursor === null || typeof readableBody.nextCursor === "string").toBe(true);

    const denied = await fetch(`${baseUrl}/api/v1/admin/lottery/bet-types`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auditor.accessToken}`,
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ code: `DENIED_${randomUUID().slice(0, 8)}` }),
    });
    expect(denied.status).toBe(403);
  });

  it("returns the same result for an idempotent create and conflicts on payload reuse", async () => {
    const admin = await createAdminSession("ADMIN");
    const key = randomUUID();
    const code = `HTTP_${randomUUID().slice(0, 8)}`;
    const first = await createBetType(admin.accessToken, key, code);
    expect(first.response.status).toBe(201);
    betTypeIds.push(first.body.id);

    const retry = await createBetType(admin.accessToken, key, code);
    expect(retry.response.status).toBe(201);
    expect(retry.body).toEqual(first.body);

    const conflict = await createBetType(admin.accessToken, key, `${code}_CHANGED`);
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  async function createAdminSession(role: AdminRole): Promise<{ accessToken: string }> {
    const id = randomUUID();
    const password = "Lottery configuration integration password 123!";
    const secret = generateTotpSecret();
    await prisma.adminUser.create({
      data: {
        id,
        email: `${emailPrefix}${role.toLowerCase()}-${id}@example.com`,
        name: `Lottery Configuration ${role}`,
        passwordHash: await hashAdminPassword(password),
        role,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecretEncrypted: encryptAdminSecret(secret, getAdminMfaEncryptionKey()),
      },
    });
    adminIds.push(id);
    const login = await adminAuth.login(`${emailPrefix}${role.toLowerCase()}-${id}@example.com`, password);
    if (login.status !== "MFA_REQUIRED") throw new Error("Expected MFA challenge");
    const tokens = await adminAuth.verifyMfa(
      login.challengeToken,
      generateTotpCode(secret),
      "127.0.0.1",
      "admin-lottery-configuration-api-integration",
    );
    return { accessToken: tokens.accessToken };
  }

  async function createBetType(accessToken: string, key: string, code: string): Promise<{ response: Response; body: any }> {
    const response = await fetch(`${baseUrl}/api/v1/admin/lottery/bet-types`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({ code }),
    });
    return { response, body: await response.json() };
  }
});

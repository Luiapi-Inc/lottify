import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminAccountingPeriodController } from "../../apps/api/src/admin-accounting-period.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import {
  generateTotpCode,
  generateTotpSecret,
} from "../../src/contexts/identity-access/domain/totp";
import {
  getAdminMfaEncryptionKey,
  getEnvironment,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";
import { AccountingPeriodService } from "../../src/contexts/wallet-ledger/application/accounting-period.service";
import { PrismaAccountingPeriodRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-accounting-period.repository";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "accounting-period-api-integration+";

describe.runIf(runIntegration)("Admin Accounting Period API contract", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: AdminAuthService;
  let baseUrl: string;
  let accessToken: string;

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    adminAuth = new AdminAuthService(
      new PrismaAdminAuthRepository(prisma),
      new JwtService(),
    );
    const accountingPeriods = new AccountingPeriodService(
      new PrismaAccountingPeriodRepository(prisma),
    );
    const reflector = new Reflector();

    @Module({
      controllers: [AdminAccountingPeriodController],
      providers: [
        { provide: AccountingPeriodService, useValue: accountingPeriods },
        { provide: AdminAuthGuard, useValue: new AdminAuthGuard(adminAuth) },
        {
          provide: AdminCapabilityGuard,
          useValue: new AdminCapabilityGuard(reflector),
        },
      ],
    })
    class AdminAccountingPeriodContractTestModule {}

    app = await NestFactory.create(AdminAccountingPeriodContractTestModule, {
      logger: false,
    });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    const password = "Accounting period integration password 123!";
    const secret = generateTotpSecret();
    const email = `${emailPrefix}${randomUUID()}@example.com`;
    await prisma.adminUser.create({
      data: {
        email,
        name: "Accounting Period Auditor",
        passwordHash: await hashAdminPassword(password),
        role: "AUDITOR",
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecretEncrypted: encryptAdminSecret(
          secret,
          getAdminMfaEncryptionKey(),
        ),
      },
    });

    const login = await adminAuth.login(email, password);
    if (login.status !== "MFA_REQUIRED") {
      throw new Error("Expected mandatory MFA challenge for Admin API integration");
    }
    const tokens = await adminAuth.verifyMfa(
      login.challengeToken,
      generateTotpCode(secret),
      "127.0.0.1",
      "admin-accounting-period-api-integration",
    );
    accessToken = tokens.accessToken;
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
    await app.close();
    await prisma.$disconnect();
  });

  it("rejects unauthenticated and Member-token requests", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/admin/accounting-periods`);
    expect(unauthenticated.status).toBe(401);

    const memberToken = await new JwtService().signAsync(
      { sub: randomUUID(), sid: randomUUID() },
      {
        secret: getEnvironment().JWT_ACCESS_SECRET,
        expiresIn: getEnvironment().JWT_ACCESS_TTL_SECONDS,
      },
    );
    const memberRequest = await fetch(`${baseUrl}/api/v1/admin/accounting-periods`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(memberRequest.status).toBe(401);
  });

  it("allows AUDITOR read access and exposes only the authoritative read model", async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/accounting-periods`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(response.status).toBe(200);
    const periods = (await response.json()) as Array<Record<string, unknown>>;
    expect(periods.length).toBeGreaterThan(0);
    expect(periods[0]).toEqual({
      id: expect.any(String),
      mode: expect.stringMatching(/^(AUTOMATIC_WEEKLY|CUSTOM)$/),
      generationKind: expect.stringMatching(/^(NOMINAL_WEEK|DERIVED_FRAGMENT|CUSTOM)$/),
      effectiveStart: expect.any(String),
      effectiveEnd: expect.any(String),
      accountingTimezone: "Asia/Bangkok",
      state: expect.any(String),
      version: expect.any(Number),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      allowedActions: [],
    });
    expect(periods[0]).not.toHaveProperty("financialTransactions");
  });

  it("returns one period by opaque identity and returns 404 for an unknown identity", async () => {
    const listResponse = await fetch(`${baseUrl}/api/v1/admin/accounting-periods`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const periods = (await listResponse.json()) as Array<{ id: string }>;
    const selected = periods[0];
    if (!selected) throw new Error("Expected seeded Accounting Period");

    const detailResponse = await fetch(
      `${baseUrl}/api/v1/admin/accounting-periods/${encodeURIComponent(selected.id)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({ id: selected.id });

    const missingResponse = await fetch(
      `${baseUrl}/api/v1/admin/accounting-periods/not-a-real-period`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(missingResponse.status).toBe(404);
  });

  it("publishes read-only OpenAPI operations with Admin Bearer security", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    const collection = document.paths["/api/v1/admin/accounting-periods"];
    const detail = document.paths["/api/v1/admin/accounting-periods/{id}"];

    expect(collection?.get?.security).toEqual([{ bearer: [] }]);
    expect(detail?.get?.security).toEqual([{ bearer: [] }]);
    expect(detail?.get?.parameters).toEqual([
      expect.objectContaining({ name: "id", in: "path", required: true }),
    ]);
    expect(collection?.post).toBeUndefined();
    expect(collection?.patch).toBeUndefined();
    expect(collection?.delete).toBeUndefined();
    expect(detail?.post).toBeUndefined();
    expect(detail?.patch).toBeUndefined();
    expect(detail?.delete).toBeUndefined();
  });
});

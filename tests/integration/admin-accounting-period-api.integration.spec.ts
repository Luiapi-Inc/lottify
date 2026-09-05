import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiModule } from "../../apps/api/src/app.module";
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
    app = await NestFactory.create(ApiModule, { logger: false });
    await app.init();
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    adminAuth = app.get(AdminAuthService);

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

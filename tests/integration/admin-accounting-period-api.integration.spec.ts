import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminAccountingPeriodController } from "../../apps/api/src/admin-accounting-period.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import type { AdminRole } from "../../src/contexts/identity-access/domain/admin-auth.repository";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import {
  generateTotpCode,
  generateTotpSecret,
} from "../../src/contexts/identity-access/domain/totp";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import { AccountingPeriodService } from "../../src/contexts/wallet-ledger/application/accounting-period.service";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { PrismaAccountingPeriodRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-accounting-period.repository";
import {
  getAdminMfaEncryptionKey,
  getEnvironment,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";
import { IdempotencyService } from "../../src/platform/idempotency/idempotency.service";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "accounting-period-api-integration+";

interface ApiErrorBody {
  code: string;
  message: string;
  details: Record<string, unknown>;
  correlationId: string;
}

describe.runIf(runIntegration)("Admin Accounting Period API contract", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: AdminAuthService;
  let baseUrl: string;
  let auditorToken: string;
  let adminToken: string;
  let superAdminToken: string;
  let fixturePeriodId: string;
  const adminIds: string[] = [];

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    adminAuth = new AdminAuthService(
      new PrismaAdminAuthRepository(prisma),
      new JwtService(),
    );
    const accountingPeriods = new AccountingPeriodService(
      new PrismaAccountingPeriodRepository(
        prisma,
        new DatabaseAccountingPeriodTransactionClock(),
      ),
    );
    const idempotency = new IdempotencyService(prisma);
    const reflector = new Reflector();

    @Module({
      controllers: [AdminAccountingPeriodController],
      providers: [
        { provide: AccountingPeriodService, useValue: accountingPeriods },
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: IdempotencyService, useValue: idempotency },
        { provide: Reflector, useValue: reflector },
        AdminAuthGuard,
        AdminCapabilityGuard,
      ],
    })
    class AdminAccountingPeriodContractTestModule {}

    app = await NestFactory.create(AdminAccountingPeriodContractTestModule, {
      logger: false,
    });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    fixturePeriodId = randomUUID();
    await prisma.accountingPeriod.create({
      data: {
        id: fixturePeriodId,
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2099-01-04T17:00:00.000Z"),
        effectiveEnd: new Date("2099-01-11T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });

    auditorToken = (await createAdminSession("AUDITOR")).accessToken;
    adminToken = (await createAdminSession("ADMIN")).accessToken;
    superAdminToken = (await createAdminSession("SUPER_ADMIN")).accessToken;
  });

  afterAll(async () => {
    if (adminIds.length > 0) {
      await prisma.accountingPeriod.deleteMany({
        where: { createdByAdminId: { in: adminIds } },
      });
      await prisma.idempotencyRecord.deleteMany({
        where: {
          OR: adminIds.map((adminId) => ({ scope: { startsWith: `admin:${adminId}:` } })),
        },
      });
    }
    await prisma.accountingPeriod.deleteMany({ where: { id: fixturePeriodId } });
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

  it("rejects unauthenticated and Member-token requests with the Admin auth boundary", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/admin/accounting-periods`);
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      details: {},
      correlationId: expect.any(String),
    });

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
    await expect(memberRequest.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("keeps AUDITOR read-only and exposes the authoritative read model", async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/accounting-periods`, {
      headers: authHeaders(auditorToken),
    });
    expect(response.status).toBe(200);
    const periods = (await response.json()) as Array<Record<string, unknown>>;
    const fixture = periods.find((period) => period.id === fixturePeriodId);
    expect(fixture).toEqual({
      id: fixturePeriodId,
      mode: "AUTOMATIC_WEEKLY",
      generationKind: "NOMINAL_WEEK",
      effectiveStart: "2099-01-04T17:00:00.000Z",
      effectiveEnd: "2099-01-11T17:00:00.000Z",
      accountingTimezone: "Asia/Bangkok",
      state: "SCHEDULED",
      version: 1,
      reason: null,
      createdByAdminId: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      allowedActions: [],
    });
    expect(fixture).not.toHaveProperty("financialTransactions");

    const denied = await fetch(`${baseUrl}/api/v1/admin/accounting-periods/create-custom`, {
      method: "POST",
      headers: {
        ...authHeaders(auditorToken),
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        startDate: "2099-01-05",
        endDate: "2099-01-12",
        reason: "Auditor must remain read-only",
      }),
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      code: "ACCESS_DENIED",
      details: { required: ["accounting-period.create-custom"] },
      correlationId: expect.any(String),
    });
  });

  it("creates an exact-range DRAFT without changing effective coverage and replays idempotently", async () => {
    const beforeCoverage = await effectiveCoverageSnapshot();
    const key = randomUUID();
    const payload = {
      startDate: "2099-01-05",
      endDate: "2099-01-12",
      reason: "Exact-range governed override proposal",
    };

    const first = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      key,
      payload,
    );
    expect(first.response.status).toBe(201);
    expect(first.body).toMatchObject({
      period: {
        mode: "CUSTOM",
        generationKind: "CUSTOM",
        effectiveStart: "2099-01-04T17:00:00.000Z",
        effectiveEnd: "2099-01-11T17:00:00.000Z",
        accountingTimezone: "Asia/Bangkok",
        state: "DRAFT",
        version: 1,
        reason: payload.reason,
        allowedActions: ["submit"],
      },
      replacementPreview: {
        affectedAutomaticPeriods: [
          {
            id: fixturePeriodId,
            effectiveStart: "2099-01-04T17:00:00.000Z",
            effectiveEnd: "2099-01-11T17:00:00.000Z",
            generationKind: "NOMINAL_WEEK",
          },
        ],
        residualFragments: [],
      },
    });
    const period = (first.body as { period: { id: string; createdByAdminId: string } }).period;
    expect(adminIds).toContain(period.createdByAdminId);
    expect(await effectiveCoverageSnapshot()).toEqual(beforeCoverage);

    const replay = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      key,
      payload,
    );
    expect(replay.response.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(
      await prisma.accountingPeriod.count({
        where: { id: period.id, mode: "CUSTOM", state: "DRAFT" },
      }),
    ).toBe(1);

    const changedPayload = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      key,
      { ...payload, reason: "Changed payload must conflict" },
    );
    expect(changedPayload.response.status).toBe(409);
    expect(changedPayload.body).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      details: {},
      correlationId: expect.any(String),
    });

    const auditorRead = await fetch(
      `${baseUrl}/api/v1/admin/accounting-periods/${period.id}`,
      { headers: authHeaders(auditorToken) },
    );
    expect(auditorRead.status).toBe(200);
    await expect(auditorRead.json()).resolves.toMatchObject({
      id: period.id,
      state: "DRAFT",
      allowedActions: [],
    });

    const submitKey = randomUUID();
    const submitted = await command(
      `/api/v1/admin/accounting-periods/${period.id}/submit`,
      adminToken,
      submitKey,
      { expectedVersion: 1 },
    );
    expect(submitted.response.status).toBe(200);
    expect(submitted.body).toMatchObject({
      period: {
        id: period.id,
        state: "PENDING_APPROVAL",
        version: 2,
        allowedActions: [],
      },
      replacementPreview: first.body.replacementPreview,
    });
    expect(await effectiveCoverageSnapshot()).toEqual(beforeCoverage);

    const submitReplay = await command(
      `/api/v1/admin/accounting-periods/${period.id}/submit`,
      adminToken,
      submitKey,
      { expectedVersion: 1 },
    );
    expect(submitReplay.response.status).toBe(200);
    expect(submitReplay.body).toEqual(submitted.body);

    const submitChangedPayload = await command(
      `/api/v1/admin/accounting-periods/${period.id}/submit`,
      adminToken,
      submitKey,
      { expectedVersion: 2 },
    );
    expect(submitChangedPayload.response.status).toBe(409);
    expect(submitChangedPayload.body).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      details: {},
      correlationId: expect.any(String),
    });

    const stale = await command(
      `/api/v1/admin/accounting-periods/${period.id}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    expect(stale.response.status).toBe(409);
    expect(stale.body).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { expectedVersion: 1, currentVersion: 2 },
      correlationId: expect.any(String),
    });
  });

  it("returns deterministic left/right residual fragments for a partial-week Custom DRAFT", async () => {
    const result = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      superAdminToken,
      randomUUID(),
      {
        startDate: "2099-01-07",
        endDate: "2099-01-10",
        reason: "Partial-week residual preview",
      },
    );
    expect(result.response.status).toBe(201);
    expect(result.body).toMatchObject({
      period: {
        effectiveStart: "2099-01-06T17:00:00.000Z",
        effectiveEnd: "2099-01-09T17:00:00.000Z",
        state: "DRAFT",
        allowedActions: ["submit"],
      },
      replacementPreview: {
        affectedAutomaticPeriods: [
          {
            id: fixturePeriodId,
            effectiveStart: "2099-01-04T17:00:00.000Z",
            effectiveEnd: "2099-01-11T17:00:00.000Z",
          },
        ],
        residualFragments: [
          {
            sourcePeriodId: fixturePeriodId,
            effectiveStart: "2099-01-04T17:00:00.000Z",
            effectiveEnd: "2099-01-06T17:00:00.000Z",
            generationKind: "DERIVED_FRAGMENT",
          },
          {
            sourcePeriodId: fixturePeriodId,
            effectiveStart: "2099-01-09T17:00:00.000Z",
            effectiveEnd: "2099-01-11T17:00:00.000Z",
            generationKind: "DERIVED_FRAGMENT",
          },
        ],
      },
    });
  });

  it("rejects invalid input and revalidates the future-range rule on submit", async () => {
    const missingKey = await fetch(`${baseUrl}/api/v1/admin/accounting-periods/create-custom`, {
      method: "POST",
      headers: { ...authHeaders(adminToken), "content-type": "application/json" },
      body: JSON.stringify({
        startDate: "2099-01-05",
        endDate: "2099-01-12",
        reason: "Missing key",
      }),
    });
    expect(missingKey.status).toBe(400);
    await expect(missingKey.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { header: "Idempotency-Key" },
    });

    const invalidRangeKey = randomUUID();
    const invalidRange = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      invalidRangeKey,
      { startDate: "2099-01-12", endDate: "2099-01-12", reason: "Invalid range" },
    );
    expect(invalidRange.response.status).toBe(400);
    expect(invalidRange.body).toMatchObject({ code: "VALIDATION_ERROR" });
    const invalidReplay = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      invalidRangeKey,
      { startDate: "2099-01-12", endDate: "2099-01-12", reason: "Invalid range" },
    );
    expect(invalidReplay.response.status).toBe(400);
    expect(invalidReplay.body).toEqual(invalidRange.body);

    const missingReason = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      { startDate: "2099-01-05", endDate: "2099-01-12", reason: "   " },
    );
    expect(missingReason.response.status).toBe(400);
    expect(missingReason.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "reason" },
      correlationId: expect.any(String),
    });

    const adminId = await adminIdForToken(adminToken);
    const pastDraft = await prisma.accountingPeriod.create({
      data: {
        mode: "CUSTOM",
        generationKind: "CUSTOM",
        effectiveStart: new Date("2001-01-01T17:00:00.000Z"),
        effectiveEnd: new Date("2001-01-02T17:00:00.000Z"),
        state: "DRAFT",
        reason: "Future-range revalidation fixture",
        createdByAdminId: adminId,
      },
      select: { id: true },
    });
    const rejected = await command(
      `/api/v1/admin/accounting-periods/${pastDraft.id}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_NOT_FUTURE",
      correlationId: expect.any(String),
    });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: pastDraft.id } }),
    ).resolves.toMatchObject({ state: "DRAFT", version: 1 });
  });

  it("revalidates authoritative coverage on submit and leaves a rejected proposal in DRAFT", async () => {
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2099-01-05",
        endDate: "2099-01-12",
        reason: "Coverage revalidation fixture",
      },
    );
    expect(created.response.status).toBe(201);
    const periodId = (created.body as { period: { id: string } }).period.id;

    await prisma.accountingPeriod.update({
      where: { id: fixturePeriodId },
      data: { mode: "CUSTOM", generationKind: "CUSTOM" },
    });
    try {
      const rejected = await command(
        `/api/v1/admin/accounting-periods/${periodId}/submit`,
        adminToken,
        randomUUID(),
        { expectedVersion: 1 },
      );
      expect(rejected.response.status).toBe(409);
      expect(rejected.body).toMatchObject({
        code: "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
        details: { conflictingPeriodId: fixturePeriodId },
        correlationId: expect.any(String),
      });
      await expect(
        prisma.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } }),
      ).resolves.toMatchObject({ state: "DRAFT", version: 1 });
    } finally {
      await prisma.accountingPeriod.update({
        where: { id: fixturePeriodId },
        data: { mode: "AUTOMATIC_WEEKLY", generationKind: "NOMINAL_WEEK" },
      });
    }
  });

  it("publishes explicit create-custom/submit OpenAPI operations and no generic PATCH", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    const collection = document.paths["/api/v1/admin/accounting-periods"];
    const detail = document.paths["/api/v1/admin/accounting-periods/{id}"];
    const createCustom = document.paths["/api/v1/admin/accounting-periods/create-custom"];
    const submit = document.paths["/api/v1/admin/accounting-periods/{id}/submit"];

    expect(collection?.get?.security).toEqual([{ bearer: [] }]);
    expect(detail?.get?.security).toEqual([{ bearer: [] }]);
    expect(createCustom?.post?.security).toEqual([{ bearer: [] }]);
    expect(submit?.post?.security).toEqual([{ bearer: [] }]);
    expect(createCustom?.post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
      ]),
    );
    expect(submit?.post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ]),
    );
    expect(createCustom?.post?.responses?.["409"]).toBeDefined();
    expect(submit?.post?.responses?.["409"]).toBeDefined();
    expect(collection?.post).toBeUndefined();
    expect(collection?.patch).toBeUndefined();
    expect(detail?.post).toBeUndefined();
    expect(detail?.patch).toBeUndefined();
    expect(createCustom?.patch).toBeUndefined();
    expect(submit?.patch).toBeUndefined();
  });

  async function createAdminSession(role: AdminRole): Promise<{ id: string; accessToken: string }> {
    const id = randomUUID();
    const password = "Accounting period integration password 123!";
    const secret = generateTotpSecret();
    const email = `${emailPrefix}${role.toLowerCase()}-${id}@example.com`;
    await prisma.adminUser.create({
      data: {
        id,
        email,
        name: `Accounting Period ${role}`,
        passwordHash: await hashAdminPassword(password),
        role,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecretEncrypted: encryptAdminSecret(secret, getAdminMfaEncryptionKey()),
      },
    });
    adminIds.push(id);
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
    return { id, accessToken: tokens.accessToken };
  }

  function authHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
  }

  async function command(
    path: string,
    accessToken: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<{ response: Response; body: any }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    return { response, body: await response.json() };
  }

  async function effectiveCoverageSnapshot() {
    return prisma.accountingPeriod.findMany({
      where: { state: { in: ["SCHEDULED", "OPEN", "CLOSING", "CLOSED"] } },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
      select: {
        id: true,
        mode: true,
        generationKind: true,
        effectiveStart: true,
        effectiveEnd: true,
        state: true,
        version: true,
      },
    });
  }

  async function adminIdForToken(accessToken: string): Promise<string> {
    return (await adminAuth.authenticateAccess(accessToken)).adminId;
  }
});

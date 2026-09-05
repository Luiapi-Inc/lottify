import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminAccountingPeriodController } from "../../apps/api/src/admin-accounting-period.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import {
  ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS,
  ACCOUNTING_PERIOD_CANCELLATION_ACTION_CLASS,
  AccountingPeriodApprovalService,
} from "../../apps/api/src/accounting-period-approval.service";
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
import {
  type AccountingPeriodTransactionClock,
  DatabaseAccountingPeriodTransactionClock,
} from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
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
  let adminSecret: string;
  let approverAdminToken: string;
  let approverAdminSecret: string;
  let superAdminToken: string;
  let superAdminSecret: string;
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
    const approvals = new AccountingPeriodApprovalService(prisma);
    const reflector = new Reflector();

    @Module({
      controllers: [AdminAccountingPeriodController],
      providers: [
        { provide: AccountingPeriodService, useValue: accountingPeriods },
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: AccountingPeriodApprovalService, useValue: approvals },
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
    const adminSession = await createAdminSession("ADMIN");
    adminToken = adminSession.accessToken;
    adminSecret = adminSession.secret;
    const approverSession = await createAdminSession("ADMIN");
    approverAdminToken = approverSession.accessToken;
    approverAdminSecret = approverSession.secret;
    const superAdminSession = await createAdminSession("SUPER_ADMIN");
    superAdminToken = superAdminSession.accessToken;
    superAdminSecret = superAdminSession.secret;
  });

  afterAll(async () => {
    await deleteImmutableTestEvidence();
    await prisma.financialTransaction.deleteMany({
      where: { operationType: "TEST_ACCOUNTING_PERIOD_APPROVAL_BLOCKER" },
    });
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
    await prisma.accountingPeriod.deleteMany({
      where: {
        effectiveStart: {
          gte: new Date("2199-02-03T17:00:00.000Z"),
          lt: new Date("2199-08-01T17:00:00.000Z"),
        },
      },
    });
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
      cancellationRequestedByAdminId: null,
      cancellationReason: null,
      cancellationRequestedAt: null,
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

  it("requires fresh re-auth, rejects ADMIN self-approval, and lets a different ADMIN atomically schedule the Custom period", async () => {
    const automatic = await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-02-03T17:00:00.000Z"),
        effectiveEnd: new Date("2199-02-10T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2199-02-06",
        endDate: "2199-02-09",
        reason: "Governed partial-week activation",
      },
    );
    expect(created.response.status).toBe(201);
    const periodId = (created.body as { period: { id: string } }).period.id;
    const submitted = await command(
      `/api/v1/admin/accounting-periods/${periodId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    expect(submitted.response.status).toBe(200);

    const requesterRead = await fetch(
      `${baseUrl}/api/v1/admin/accounting-periods/${periodId}`,
      { headers: authHeaders(adminToken) },
    );
    await expect(requesterRead.json()).resolves.toMatchObject({
      state: "PENDING_APPROVAL",
      allowedActions: ["cancel"],
    });

    const missingReauth = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(missingReauth.response.status).toBe(403);
    expect(missingReauth.body).toMatchObject({
      code: "REAUTH_REQUIRED",
      details: { actionClass: ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS },
      correlationId: expect.any(String),
    });
    const approverId = await adminIdForToken(approverAdminToken);
    await expect(
      prisma.auditRecord.findFirstOrThrow({
        where: {
          resourceId: periodId,
          actorAdminId: approverId,
          outcome: "REAUTH_REQUIRED",
        },
      }),
    ).resolves.toMatchObject({ reauthEvidenceId: null });

    await freshApprovalReauth(adminToken, adminSecret);
    const selfDenied = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      adminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(selfDenied.response.status).toBe(403);
    expect(selfDenied.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_SELF_APPROVAL_FORBIDDEN",
      correlationId: expect.any(String),
    });
    const requesterId = await adminIdForToken(adminToken);
    await expect(
      prisma.auditRecord.findFirstOrThrow({
        where: {
          resourceId: periodId,
          actorAdminId: requesterId,
          outcome: "ACCOUNTING_PERIOD_SELF_APPROVAL_FORBIDDEN",
        },
      }),
    ).resolves.toMatchObject({ reauthEvidenceId: expect.any(String) });

    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const staleApproval = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    expect(staleApproval.response.status).toBe(409);
    expect(staleApproval.body).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { expectedVersion: 1, currentVersion: 2 },
      correlationId: expect.any(String),
    });
    await expect(
      prisma.auditRecord.findFirstOrThrow({
        where: {
          resourceId: periodId,
          actorAdminId: approverId,
          outcome: "VERSION_CONFLICT",
        },
      }),
    ).resolves.toMatchObject({ reauthEvidenceId: expect.any(String) });

    const approvalKey = randomUUID();
    const approved = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      approvalKey,
      { expectedVersion: 2 },
    );
    expect(approved.response.status).toBe(200);
    expect(approved.body).toMatchObject({
      period: {
        id: periodId,
        state: "SCHEDULED",
        version: 3,
        allowedActions: [],
      },
      replacementPreview: {
        affectedAutomaticPeriods: [{ id: automatic.id }],
        residualFragments: [
          {
            sourcePeriodId: automatic.id,
            effectiveStart: "2199-02-03T17:00:00.000Z",
            effectiveEnd: "2199-02-05T17:00:00.000Z",
          },
          {
            sourcePeriodId: automatic.id,
            effectiveStart: "2199-02-08T17:00:00.000Z",
            effectiveEnd: "2199-02-10T17:00:00.000Z",
          },
        ],
      },
    });

    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: automatic.id } }),
    ).resolves.toMatchObject({ state: "CANCELLED", version: 2 });
    const effective = await prisma.accountingPeriod.findMany({
      where: {
        state: "SCHEDULED",
        effectiveStart: { lt: new Date("2199-02-10T17:00:00.000Z") },
        effectiveEnd: { gt: new Date("2199-02-03T17:00:00.000Z") },
      },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
      select: {
        id: true,
        mode: true,
        generationKind: true,
        effectiveStart: true,
        effectiveEnd: true,
      },
    });
    expect(effective).toEqual([
      expect.objectContaining({
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "DERIVED_FRAGMENT",
        effectiveStart: new Date("2199-02-03T17:00:00.000Z"),
        effectiveEnd: new Date("2199-02-05T17:00:00.000Z"),
      }),
      expect.objectContaining({
        id: periodId,
        mode: "CUSTOM",
        generationKind: "CUSTOM",
        effectiveStart: new Date("2199-02-05T17:00:00.000Z"),
        effectiveEnd: new Date("2199-02-08T17:00:00.000Z"),
      }),
      expect.objectContaining({
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "DERIVED_FRAGMENT",
        effectiveStart: new Date("2199-02-08T17:00:00.000Z"),
        effectiveEnd: new Date("2199-02-10T17:00:00.000Z"),
      }),
    ]);

    const evidence = await prisma.adminApprovalEvidence.findUniqueOrThrow({
      where: {
        action_resourceId: {
          action: "ACCOUNTING_PERIOD_CUSTOM_ACTIVATION",
          resourceId: periodId,
        },
      },
    });
    expect(evidence).toMatchObject({
      requesterAdminId: requesterId,
      approverAdminId: approverId,
      requestedVersion: 2,
      policyVersion: "accounting-period-custom-activation-v1",
      correlationId: expect.any(String),
    });
    expect(evidence.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    const audit = await prisma.auditRecord.findFirstOrThrow({
      where: { approvalId: evidence.id },
    });
    expect(audit).toMatchObject({
      resourceId: periodId,
      actorAdminId: approverId,
      actorRole: "ADMIN",
      outcome: "APPROVED",
      correlationId: evidence.correlationId,
    });
    await expect(
      prisma.adminApprovalEvidence.update({
        where: { id: evidence.id },
        data: { reason: "must not mutate" },
      }),
    ).rejects.toThrow("Immutable Admin evidence cannot be updated or deleted");
    await expect(
      prisma.adminApprovalEvidence.delete({ where: { id: evidence.id } }),
    ).rejects.toThrow("Immutable Admin evidence cannot be updated or deleted");
    await expect(
      prisma.auditRecord.delete({ where: { id: audit.id } }),
    ).rejects.toThrow("Immutable Admin evidence cannot be updated or deleted");

    const replay = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      approvalKey,
      { expectedVersion: 2 },
    );
    expect(replay.response.status).toBe(200);
    expect(replay.body).toEqual(approved.body);
    expect(
      await prisma.adminApprovalEvidence.count({ where: { resourceId: periodId } }),
    ).toBe(1);
  });

  it("resumes an approval from an existing IN_PROGRESS idempotency claim and commits the result once", async () => {
    const automatic = await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-05-05T17:00:00.000Z"),
        effectiveEnd: new Date("2199-05-12T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2199-05-08",
        endDate: "2199-05-10",
        reason: "Resume approval after claim-only crash window",
      },
    );
    const periodId = (created.body as { period: { id: string } }).period.id;
    await command(
      `/api/v1/admin/accounting-periods/${periodId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );

    const approverId = await adminIdForToken(approverAdminToken);
    const approvalKey = randomUUID();
    const payload = { expectedVersion: 2 };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ id: periodId, ...payload }), "utf8")
      .digest("hex");
    const scope = `admin:${approverId}:accounting-period:${periodId}:approve`;
    await prisma.idempotencyRecord.create({
      data: {
        scope,
        key: approvalKey,
        fingerprint,
        status: "IN_PROGRESS",
        expiresAt: new Date("9999-12-31T23:59:59.999Z"),
      },
    });

    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const approved = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      approvalKey,
      payload,
    );
    expect(approved.response.status).toBe(200);
    expect(approved.body).toMatchObject({
      period: { id: periodId, state: "SCHEDULED", version: 3 },
    });
    await expect(
      prisma.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope, key: approvalKey } } }),
    ).resolves.toMatchObject({ status: "COMPLETED", responseCode: 200 });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: automatic.id } }),
    ).resolves.toMatchObject({ state: "CANCELLED", version: 2 });
    expect(
      await prisma.adminApprovalEvidence.count({ where: { resourceId: periodId } }),
    ).toBe(1);

    const replay = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      approvalKey,
      payload,
    );
    expect(replay.response.status).toBe(200);
    expect(replay.body).toEqual(approved.body);
    expect(
      await prisma.adminApprovalEvidence.count({ where: { resourceId: periodId } }),
    ).toBe(1);
  });

  it("blocks approval when previously eligible Automatic coverage becomes OPEN", async () => {
    const automatic = await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-05-12T17:00:00.000Z"),
        effectiveEnd: new Date("2199-05-19T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2199-05-15",
        endDate: "2199-05-17",
        reason: "OPEN coverage must remain authoritative",
      },
    );
    const periodId = (created.body as { period: { id: string } }).period.id;
    await command(
      `/api/v1/admin/accounting-periods/${periodId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    await prisma.accountingPeriod.update({
      where: { id: automatic.id },
      data: { state: "OPEN" },
    });

    const approverId = await adminIdForToken(approverAdminToken);
    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const rejected = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
      details: { conflictingPeriodId: automatic.id, conflictingState: "OPEN" },
      correlationId: expect.any(String),
    });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } }),
    ).resolves.toMatchObject({ state: "PENDING_APPROVAL", version: 2 });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: automatic.id } }),
    ).resolves.toMatchObject({ state: "OPEN", version: 1 });
    await expect(
      prisma.auditRecord.findFirstOrThrow({
        where: {
          resourceId: periodId,
          actorAdminId: approverId,
          outcome: "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
        },
      }),
    ).resolves.toMatchObject({ reauthEvidenceId: expect.any(String) });
  });

  it("blocks approval when previously eligible Automatic coverage gains a Financial Transaction reference", async () => {
    const automatic = await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-05-19T17:00:00.000Z"),
        effectiveEnd: new Date("2199-05-26T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2199-05-22",
        endDate: "2199-05-24",
        reason: "Referenced coverage must remain authoritative",
      },
    );
    const periodId = (created.body as { period: { id: string } }).period.id;
    await command(
      `/api/v1/admin/accounting-periods/${periodId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    const postedAt = new Date("2199-05-21T00:00:00.000Z");
    await prisma.financialTransaction.create({
      data: {
        businessTransactionId: randomUUID(),
        operationType: "TEST_ACCOUNTING_PERIOD_APPROVAL_BLOCKER",
        correlationId: randomUUID(),
        idempotencyScope: `test.accounting-period-approval.${periodId}`,
        idempotencyKey: randomUUID(),
        fingerprint: "referenced-automatic-period",
        domainReferences: { accountingPeriodApprovalFixture: periodId },
        effectiveAt: postedAt,
        postedAt,
        accountingPeriodId: automatic.id,
      },
    });

    const approverId = await adminIdForToken(approverAdminToken);
    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const rejected = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
      details: { conflictingPeriodId: automatic.id },
      correlationId: expect.any(String),
    });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } }),
    ).resolves.toMatchObject({ state: "PENDING_APPROVAL", version: 2 });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: automatic.id } }),
    ).resolves.toMatchObject({ state: "SCHEDULED", version: 1 });
    await expect(
      prisma.auditRecord.findFirstOrThrow({
        where: {
          resourceId: periodId,
          actorAdminId: approverId,
          outcome: "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
        },
      }),
    ).resolves.toMatchObject({ reauthEvidenceId: expect.any(String) });
  });

  it("allows SUPER_ADMIN to self-approve Custom activation while keeping the same invariants", async () => {
    const automatic = await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-03-03T17:00:00.000Z"),
        effectiveEnd: new Date("2199-03-10T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      superAdminToken,
      randomUUID(),
      {
        startDate: "2199-03-04",
        endDate: "2199-03-11",
        reason: "SUPER_ADMIN self-approval policy fixture",
      },
    );
    const periodId = (created.body as { period: { id: string } }).period.id;
    await command(
      `/api/v1/admin/accounting-periods/${periodId}/submit`,
      superAdminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    await freshApprovalReauth(superAdminToken, superAdminSecret);
    const approved = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      superAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(approved.response.status).toBe(200);
    expect(approved.body).toMatchObject({
      period: { id: periodId, state: "SCHEDULED", version: 3 },
    });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: automatic.id } }),
    ).resolves.toMatchObject({ state: "CANCELLED" });
    const superAdminId = await adminIdForToken(superAdminToken);
    await expect(
      prisma.adminApprovalEvidence.findFirstOrThrow({ where: { resourceId: periodId } }),
    ).resolves.toMatchObject({
      requesterAdminId: superAdminId,
      approverAdminId: superAdminId,
    });
  });

  it("cancels an elapsed never-opened request instead of retroactively activating or shifting it", async () => {
    const requesterAdminId = await adminIdForToken(adminToken);
    const late = await prisma.accountingPeriod.create({
      data: {
        mode: "CUSTOM",
        generationKind: "CUSTOM",
        effectiveStart: new Date("2001-01-01T17:00:00.000Z"),
        effectiveEnd: new Date("2001-01-02T17:00:00.000Z"),
        state: "PENDING_APPROVAL",
        version: 2,
        reason: "Elapsed approval fixture",
        createdByAdminId: requesterAdminId,
      },
    });
    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const rejected = await command(
      `/api/v1/admin/accounting-periods/${late.id}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_START_ELAPSED",
      details: { state: "CANCELLED", currentVersion: 3 },
      correlationId: expect.any(String),
    });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: late.id } }),
    ).resolves.toMatchObject({
      state: "CANCELLED",
      version: 3,
      effectiveStart: new Date("2001-01-01T17:00:00.000Z"),
      effectiveEnd: new Date("2001-01-02T17:00:00.000Z"),
    });
    expect(
      await prisma.adminApprovalEvidence.count({ where: { resourceId: late.id } }),
    ).toBe(0);
    await expect(
      prisma.auditRecord.findFirstOrThrow({ where: { resourceId: late.id } }),
    ).resolves.toMatchObject({ outcome: "ELAPSED_START" });
  });

  it("serializes conflicting Custom approvals so only one schedule can commit", async () => {
    await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-03-31T17:00:00.000Z"),
        effectiveEnd: new Date("2199-04-07T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const firstCreated = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      { startDate: "2199-04-02", endDate: "2199-04-06", reason: "Race A" },
    );
    const secondCreated = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      superAdminToken,
      randomUUID(),
      { startDate: "2199-04-04", endDate: "2199-04-08", reason: "Race B" },
    );
    const firstId = (firstCreated.body as { period: { id: string } }).period.id;
    const secondId = (secondCreated.body as { period: { id: string } }).period.id;
    await command(
      `/api/v1/admin/accounting-periods/${firstId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    await command(
      `/api/v1/admin/accounting-periods/${secondId}/submit`,
      superAdminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const results = await Promise.all([
      command(
        `/api/v1/admin/accounting-periods/${firstId}/approve`,
        approverAdminToken,
        randomUUID(),
        { expectedVersion: 2 },
      ),
      command(
        `/api/v1/admin/accounting-periods/${secondId}/approve`,
        approverAdminToken,
        randomUUID(),
        { expectedVersion: 2 },
      ),
    ]);
    expect(results.map((result) => result.response.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.response.status === 409)?.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
    });
    expect(
      await prisma.accountingPeriod.count({
        where: { id: { in: [firstId, secondId] }, state: "SCHEDULED" },
      }),
    ).toBe(1);
    const effective = await prisma.accountingPeriod.findMany({
      where: {
        state: { in: ["SCHEDULED", "OPEN", "CLOSING", "CLOSED"] },
        effectiveStart: { lt: new Date("2199-04-07T17:00:00.000Z") },
        effectiveEnd: { gt: new Date("2199-03-31T17:00:00.000Z") },
      },
      orderBy: { effectiveStart: "asc" },
    });
    for (let index = 1; index < effective.length; index += 1) {
      expect(effective[index - 1]!.effectiveEnd.getTime()).toBe(
        effective[index]!.effectiveStart.getTime(),
      );
    }
  });

  it("lets only the creator cancel a DRAFT immediately and replays the result idempotently", async () => {
    const before = await effectiveCoverageSnapshot();
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2199-06-01",
        endDate: "2199-06-02",
        reason: "Draft cancellation fixture",
      },
    );
    expect(created.response.status).toBe(201);
    const periodId = (created.body as { period: { id: string } }).period.id;

    const requesterRead = await fetch(
      `${baseUrl}/api/v1/admin/accounting-periods/${periodId}`,
      { headers: authHeaders(adminToken) },
    );
    await expect(requesterRead.json()).resolves.toMatchObject({
      state: "DRAFT",
      allowedActions: expect.arrayContaining(["submit", "cancel"]),
    });
    const otherRead = await fetch(
      `${baseUrl}/api/v1/admin/accounting-periods/${periodId}`,
      { headers: authHeaders(approverAdminToken) },
    );
    await expect(otherRead.json()).resolves.toMatchObject({
      state: "DRAFT",
      allowedActions: ["submit"],
    });

    const forbidden = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 1, reason: "Not the creator" },
    );
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_CANCELLATION_FORBIDDEN",
      correlationId: expect.any(String),
    });

    const key = randomUUID();
    const cancelled = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      adminToken,
      key,
      { expectedVersion: 1, reason: "Draft no longer required" },
    );
    expect(cancelled.response.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      period: { id: periodId, state: "CANCELLED", version: 2, allowedActions: [] },
    });
    const replay = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      adminToken,
      key,
      { expectedVersion: 1, reason: "Draft no longer required" },
    );
    expect(replay.response.status).toBe(200);
    expect(replay.body).toEqual(cancelled.body);
    expect(await effectiveCoverageSnapshot()).toEqual(before);

    const requesterId = await adminIdForToken(adminToken);
    await expect(
      prisma.auditRecord.findFirstOrThrow({
        where: {
          resourceId: periodId,
          actorAdminId: requesterId,
          action: "ACCOUNTING_PERIOD_CUSTOM_CANCELLATION",
          outcome: "CANCELLED",
        },
      }),
    ).resolves.toMatchObject({
      reason: "Draft no longer required",
      reauthEvidenceId: null,
      approvalId: null,
      correlationId: expect.any(String),
    });
  });

  it("lets the creator withdraw PENDING_APPROVAL and prevents stale activation", async () => {
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2199-06-02",
        endDate: "2199-06-03",
        reason: "Pending withdrawal fixture",
      },
    );
    const periodId = (created.body as { period: { id: string } }).period.id;
    const submitted = await command(
      `/api/v1/admin/accounting-periods/${periodId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    expect(submitted.response.status).toBe(200);
    expect(submitted.body).toMatchObject({
      period: { state: "PENDING_APPROVAL", version: 2 },
    });

    const withdrawn = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      adminToken,
      randomUUID(),
      { expectedVersion: 2, reason: "Withdraw before activation" },
    );
    expect(withdrawn.response.status).toBe(200);
    expect(withdrawn.body).toMatchObject({
      period: { id: periodId, state: "CANCELLED", version: 3, allowedActions: [] },
    });

    const requesterId = await adminIdForToken(adminToken);
    await expect(
      prisma.auditRecord.findFirstOrThrow({
        where: {
          resourceId: periodId,
          actorAdminId: requesterId,
          action: "ACCOUNTING_PERIOD_CUSTOM_CANCELLATION",
          outcome: "WITHDRAWN",
        },
      }),
    ).resolves.toMatchObject({ reason: "Withdraw before activation" });

    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const staleApproval = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(staleApproval.response.status).toBe(409);
    expect(staleApproval.body).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { expectedVersion: 2, currentVersion: 3 },
    });
    expect(
      await prisma.adminApprovalEvidence.count({
        where: { action: "ACCOUNTING_PERIOD_CUSTOM_ACTIVATION", resourceId: periodId },
      }),
    ).toBe(0);
  });

  it("requires two-actor governed SCHEDULED cancellation and atomically restores a fresh nominal Automatic week", async () => {
    const originalAutomatic = await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-06-02T17:00:00.000Z"),
        effectiveEnd: new Date("2199-06-09T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2199-06-05",
        endDate: "2199-06-08",
        reason: "Scheduled cancellation restoration fixture",
      },
    );
    const periodId = (created.body as { period: { id: string } }).period.id;
    await command(
      `/api/v1/admin/accounting-periods/${periodId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const approved = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(approved.response.status).toBe(200);
    expect(approved.body).toMatchObject({
      period: { id: periodId, state: "SCHEDULED", version: 3 },
    });
    const coverageBeforeRequest = await prisma.accountingPeriod.findMany({
      where: {
        state: "SCHEDULED",
        effectiveStart: { lt: new Date("2199-06-09T17:00:00.000Z") },
        effectiveEnd: { gt: new Date("2199-06-02T17:00:00.000Z") },
      },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
    });

    const requesterAdminId = await adminIdForToken(adminToken);
    const requestKey = randomUUID();
    const requested = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      adminToken,
      requestKey,
      { expectedVersion: 3, reason: "Restore Automatic coverage" },
    );
    expect(requested.response.status).toBe(200);
    expect(requested.body).toMatchObject({
      period: {
        id: periodId,
        state: "SCHEDULED",
        version: 4,
        cancellationRequestedByAdminId: requesterAdminId,
        cancellationReason: "Restore Automatic coverage",
        cancellationRequestedAt: expect.any(String),
        allowedActions: [],
      },
    });
    const coverageAfterRequest = await prisma.accountingPeriod.findMany({
      where: {
        state: "SCHEDULED",
        effectiveStart: { lt: new Date("2199-06-09T17:00:00.000Z") },
        effectiveEnd: { gt: new Date("2199-06-02T17:00:00.000Z") },
      },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
    });
    expect(
      coverageAfterRequest.map(({ id, mode, generationKind, effectiveStart, effectiveEnd, state }) => ({
        id,
        mode,
        generationKind,
        effectiveStart,
        effectiveEnd,
        state,
      })),
    ).toEqual(
      coverageBeforeRequest.map(({ id, mode, generationKind, effectiveStart, effectiveEnd, state }) => ({
        id,
        mode,
        generationKind,
        effectiveStart,
        effectiveEnd,
        state,
      })),
    );
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } }),
    ).resolves.toMatchObject({
      state: "SCHEDULED",
      version: 4,
      cancellationRequestedByAdminId: requesterAdminId,
      cancellationReason: "Restore Automatic coverage",
      cancellationRequestedAt: expect.any(Date),
    });

    const requestReplay = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      adminToken,
      requestKey,
      { expectedVersion: 3, reason: "Restore Automatic coverage" },
    );
    expect(requestReplay.response.status).toBe(200);
    expect(requestReplay.body).toEqual(requested.body);

    const requesterRead = await fetch(
      `${baseUrl}/api/v1/admin/accounting-periods/${periodId}`,
      { headers: authHeaders(adminToken) },
    );
    await expect(requesterRead.json()).resolves.toMatchObject({
      state: "SCHEDULED",
      cancellationRequestedByAdminId: requesterAdminId,
      allowedActions: [],
    });
    const approverRead = await fetch(
      `${baseUrl}/api/v1/admin/accounting-periods/${periodId}`,
      { headers: authHeaders(approverAdminToken) },
    );
    await expect(approverRead.json()).resolves.toMatchObject({
      state: "SCHEDULED",
      cancellationRequestedByAdminId: requesterAdminId,
      cancellationReason: "Restore Automatic coverage",
      allowedActions: ["cancel"],
    });
    await expect(
      prisma.auditRecord.findFirstOrThrow({
        where: {
          resourceId: periodId,
          actorAdminId: requesterAdminId,
          action: "ACCOUNTING_PERIOD_CUSTOM_CANCELLATION",
          outcome: "REQUESTED",
        },
      }),
    ).resolves.toMatchObject({
      reason: "Restore Automatic coverage",
      reauthEvidenceId: null,
    });

    const selfApproval = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      adminToken,
      randomUUID(),
      { expectedVersion: 4, reason: "Restore Automatic coverage" },
    );
    expect(selfApproval.response.status).toBe(403);
    expect(selfApproval.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_SELF_APPROVAL_FORBIDDEN",
      details: { requesterAdminId },
    });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } }),
    ).resolves.toMatchObject({ state: "SCHEDULED", version: 4 });

    const missingApproverReauth = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 4, reason: "Restore Automatic coverage" },
    );
    expect(missingApproverReauth.response.status).toBe(403);
    expect(missingApproverReauth.body).toMatchObject({
      code: "REAUTH_REQUIRED",
      details: { actionClass: ACCOUNTING_PERIOD_CANCELLATION_ACTION_CLASS },
    });

    await freshCancellationReauth(approverAdminToken, approverAdminSecret);
    const approvalKey = randomUUID();
    const cancelled = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      approverAdminToken,
      approvalKey,
      { expectedVersion: 4, reason: "Restore Automatic coverage" },
    );
    expect(cancelled.response.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      period: { id: periodId, state: "CANCELLED", version: 5, allowedActions: [] },
    });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: originalAutomatic.id } }),
    ).resolves.toMatchObject({ state: "CANCELLED", version: 2 });

    const restored = await prisma.accountingPeriod.findMany({
      where: {
        state: "SCHEDULED",
        effectiveStart: { lt: new Date("2199-06-09T17:00:00.000Z") },
        effectiveEnd: { gt: new Date("2199-06-02T17:00:00.000Z") },
      },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
    });
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      mode: "AUTOMATIC_WEEKLY",
      generationKind: "NOMINAL_WEEK",
      effectiveStart: new Date("2199-06-02T17:00:00.000Z"),
      effectiveEnd: new Date("2199-06-09T17:00:00.000Z"),
    });
    expect(restored[0]!.id).not.toBe(originalAutomatic.id);

    const cancellationApproval = await prisma.adminApprovalEvidence.findFirstOrThrow({
      where: { action: "ACCOUNTING_PERIOD_CUSTOM_CANCELLATION", resourceId: periodId },
    });
    const cancellationApproverAdminId = await adminIdForToken(approverAdminToken);
    expect(cancellationApproval).toMatchObject({
      requesterAdminId,
      approverAdminId: cancellationApproverAdminId,
      requestedVersion: 4,
      reason: "Restore Automatic coverage",
      policyVersion: "accounting-period-custom-cancellation-v1",
      reauthEvidenceId: expect.any(String),
      correlationId: expect.any(String),
    });
    await expect(
      prisma.auditRecord.findFirstOrThrow({ where: { approvalId: cancellationApproval.id } }),
    ).resolves.toMatchObject({
      action: "ACCOUNTING_PERIOD_CUSTOM_CANCELLATION",
      outcome: "APPROVED",
      correlationId: cancellationApproval.correlationId,
    });

    const replay = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      approverAdminToken,
      approvalKey,
      { expectedVersion: 4, reason: "Restore Automatic coverage" },
    );
    expect(replay.response.status).toBe(200);
    expect(replay.body).toEqual(cancelled.body);
    expect(
      await prisma.adminApprovalEvidence.count({
        where: { action: "ACCOUNTING_PERIOD_CUSTOM_CANCELLATION", resourceId: periodId },
      }),
    ).toBe(1);
  });

  it("rejects cancellation after OPEN and for transaction-referenced SCHEDULED Custom coverage", async () => {
    const requesterAdminId = await adminIdForToken(adminToken);
    for (const fixture of [
      ["OPEN", "2199-06-10T17:00:00.000Z", "2199-06-11T17:00:00.000Z"],
      ["CLOSING", "2199-06-12T17:00:00.000Z", "2199-06-13T17:00:00.000Z"],
      ["CLOSED", "2199-06-14T17:00:00.000Z", "2199-06-15T17:00:00.000Z"],
    ] as const) {
      const period = await prisma.accountingPeriod.create({
        data: {
          mode: "CUSTOM",
          generationKind: "CUSTOM",
          effectiveStart: new Date(fixture[1]),
          effectiveEnd: new Date(fixture[2]),
          state: fixture[0],
          reason: `${fixture[0]} cancellation fixture`,
          createdByAdminId: requesterAdminId,
        },
      });
      const rejected = await command(
        `/api/v1/admin/accounting-periods/${period.id}/cancel`,
        adminToken,
        randomUUID(),
        { expectedVersion: 1, reason: "Must remain immutable" },
      );
      expect(rejected.response.status).toBe(409);
      expect(rejected.body).toMatchObject({
        code: "ACCOUNTING_PERIOD_STATE_CONFLICT",
        details: { state: fixture[0] },
      });
    }

    const referenced = await prisma.accountingPeriod.create({
      data: {
        mode: "CUSTOM",
        generationKind: "CUSTOM",
        effectiveStart: new Date("2199-06-18T17:00:00.000Z"),
        effectiveEnd: new Date("2199-06-20T17:00:00.000Z"),
        state: "SCHEDULED",
        reason: "Referenced cancellation fixture",
        createdByAdminId: requesterAdminId,
      },
    });
    const postedAt = new Date("2199-06-19T00:00:00.000Z");
    await prisma.financialTransaction.create({
      data: {
        businessTransactionId: randomUUID(),
        operationType: "TEST_ACCOUNTING_PERIOD_APPROVAL_BLOCKER",
        correlationId: randomUUID(),
        idempotencyScope: `test.accounting-period-cancellation.${referenced.id}`,
        idempotencyKey: randomUUID(),
        fingerprint: "referenced-custom-period",
        domainReferences: { accountingPeriodCancellationFixture: referenced.id },
        effectiveAt: postedAt,
        postedAt,
        accountingPeriodId: referenced.id,
      },
    });
    await freshCancellationReauth(adminToken, adminSecret);
    const rejectedReferenced = await command(
      `/api/v1/admin/accounting-periods/${referenced.id}/cancel`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1, reason: "Must not rewrite referenced coverage" },
    );
    expect(rejectedReferenced.response.status).toBe(409);
    expect(rejectedReferenced.body).toMatchObject({
      code: "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
      correlationId: expect.any(String),
    });
    await expect(
      prisma.accountingPeriod.findUniqueOrThrow({ where: { id: referenced.id } }),
    ).resolves.toMatchObject({ state: "SCHEDULED", version: 1 });
  });

  it("serializes SCHEDULED cancellation against an overlapping Custom approval", async () => {
    await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-06-23T17:00:00.000Z"),
        effectiveEnd: new Date("2199-06-30T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const first = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      { startDate: "2199-06-25", endDate: "2199-06-28", reason: "Cancellation race A" },
    );
    const second = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      superAdminToken,
      randomUUID(),
      { startDate: "2199-06-26", endDate: "2199-06-29", reason: "Cancellation race B" },
    );
    const firstId = (first.body as { period: { id: string } }).period.id;
    const secondId = (second.body as { period: { id: string } }).period.id;
    await command(
      `/api/v1/admin/accounting-periods/${firstId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    await command(
      `/api/v1/admin/accounting-periods/${secondId}/submit`,
      superAdminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const firstApproved = await command(
      `/api/v1/admin/accounting-periods/${firstId}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(firstApproved.response.status).toBe(200);

    const cancellationRequested = await command(
      `/api/v1/admin/accounting-periods/${firstId}/cancel`,
      adminToken,
      randomUUID(),
      { expectedVersion: 3, reason: "Race-safe cancellation" },
    );
    expect(cancellationRequested.response.status).toBe(200);
    expect(cancellationRequested.body).toMatchObject({
      period: { id: firstId, state: "SCHEDULED", version: 4 },
    });

    await freshCancellationReauth(superAdminToken, superAdminSecret);
    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const [cancelledFirst, approvedSecond] = await Promise.all([
      command(
        `/api/v1/admin/accounting-periods/${firstId}/cancel`,
        superAdminToken,
        randomUUID(),
        { expectedVersion: 4, reason: "Race-safe cancellation" },
      ),
      command(
        `/api/v1/admin/accounting-periods/${secondId}/approve`,
        approverAdminToken,
        randomUUID(),
        { expectedVersion: 2 },
      ),
    ]);
    expect(cancelledFirst.response.status).toBe(200);
    expect([200, 409]).toContain(approvedSecond.response.status);
    if (approvedSecond.response.status === 409) {
      expect(approvedSecond.body).toMatchObject({ code: "ACCOUNTING_PERIOD_COVERAGE_CONFLICT" });
    }

    const effective = await prisma.accountingPeriod.findMany({
      where: {
        state: { in: ["SCHEDULED", "OPEN", "CLOSING", "CLOSED"] },
        effectiveStart: { lt: new Date("2199-06-30T17:00:00.000Z") },
        effectiveEnd: { gt: new Date("2199-06-23T17:00:00.000Z") },
      },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
    });
    expect(effective[0]!.effectiveStart).toEqual(new Date("2199-06-23T17:00:00.000Z"));
    expect(effective.at(-1)!.effectiveEnd).toEqual(new Date("2199-06-30T17:00:00.000Z"));
    for (let index = 1; index < effective.length; index += 1) {
      expect(effective[index - 1]!.effectiveEnd.getTime()).toBe(
        effective[index]!.effectiveStart.getTime(),
      );
    }
  });

  it("serializes SCHEDULED cancellation restoration against Automatic generation", async () => {
    await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: new Date("2199-07-07T17:00:00.000Z"),
        effectiveEnd: new Date("2199-07-14T17:00:00.000Z"),
        state: "SCHEDULED",
      },
    });
    const created = await command(
      "/api/v1/admin/accounting-periods/create-custom",
      adminToken,
      randomUUID(),
      {
        startDate: "2199-07-09",
        endDate: "2199-07-12",
        reason: "Cancellation generation race fixture",
      },
    );
    const periodId = (created.body as { period: { id: string } }).period.id;
    await command(
      `/api/v1/admin/accounting-periods/${periodId}/submit`,
      adminToken,
      randomUUID(),
      { expectedVersion: 1 },
    );
    await freshApprovalReauth(approverAdminToken, approverAdminSecret);
    const approved = await command(
      `/api/v1/admin/accounting-periods/${periodId}/approve`,
      approverAdminToken,
      randomUUID(),
      { expectedVersion: 2 },
    );
    expect(approved.response.status).toBe(200);

    const deterministicClock: AccountingPeriodTransactionClock = {
      now: async () => new Date("2199-07-01T00:00:00.000Z"),
    };
    const generationService = new AccountingPeriodService(
      new PrismaAccountingPeriodRepository(prisma, deterministicClock),
    );
    const cancellationRequested = await command(
      `/api/v1/admin/accounting-periods/${periodId}/cancel`,
      adminToken,
      randomUUID(),
      { expectedVersion: 3, reason: "Restore while scheduler races" },
    );
    expect(cancellationRequested.response.status).toBe(200);
    expect(cancellationRequested.body).toMatchObject({
      period: { id: periodId, state: "SCHEDULED", version: 4 },
    });
    await freshCancellationReauth(approverAdminToken, approverAdminSecret);

    const [cancelResult, generationResult] = await Promise.allSettled([
      command(
        `/api/v1/admin/accounting-periods/${periodId}/cancel`,
        approverAdminToken,
        randomUUID(),
        { expectedVersion: 4, reason: "Restore while scheduler races" },
      ),
      generationService.ensureAutomaticCoverage(),
    ]);
    expect(cancelResult.status).toBe("fulfilled");
    if (cancelResult.status === "fulfilled") {
      expect(cancelResult.value.response.status).toBe(200);
    }
    expect(["fulfilled", "rejected"]).toContain(generationResult.status);

    const effective = await prisma.accountingPeriod.findMany({
      where: {
        state: { in: ["SCHEDULED", "OPEN", "CLOSING", "CLOSED"] },
        effectiveStart: { lt: new Date("2199-07-14T17:00:00.000Z") },
        effectiveEnd: { gt: new Date("2199-07-07T17:00:00.000Z") },
      },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
    });
    expect(effective[0]!.effectiveStart).toEqual(new Date("2199-07-07T17:00:00.000Z"));
    expect(effective.at(-1)!.effectiveEnd).toEqual(new Date("2199-07-14T17:00:00.000Z"));
    for (let index = 1; index < effective.length; index += 1) {
      expect(effective[index - 1]!.effectiveEnd.getTime()).toBe(
        effective[index]!.effectiveStart.getTime(),
      );
    }
    expect(
      await prisma.accountingPeriod.count({
        where: {
          state: { in: ["SCHEDULED", "OPEN", "CLOSING", "CLOSED"] },
          effectiveStart: { lt: new Date("2199-07-14T17:00:00.000Z") },
          effectiveEnd: { gt: new Date("2199-07-07T17:00:00.000Z") },
        },
      }),
    ).toBe(1);
  });

  it("publishes explicit create-custom/submit/approve/cancel OpenAPI operations and no generic PATCH", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    const collection = document.paths["/api/v1/admin/accounting-periods"];
    const detail = document.paths["/api/v1/admin/accounting-periods/{id}"];
    const createCustom = document.paths["/api/v1/admin/accounting-periods/create-custom"];
    const submit = document.paths["/api/v1/admin/accounting-periods/{id}/submit"];
    const approve = document.paths["/api/v1/admin/accounting-periods/{id}/approve"];
    const cancel = document.paths["/api/v1/admin/accounting-periods/{id}/cancel"];

    expect(collection?.get?.security).toEqual([{ bearer: [] }]);
    expect(detail?.get?.security).toEqual([{ bearer: [] }]);
    expect(createCustom?.post?.security).toEqual([{ bearer: [] }]);
    expect(submit?.post?.security).toEqual([{ bearer: [] }]);
    expect(approve?.post?.security).toEqual([{ bearer: [] }]);
    expect(cancel?.post?.security).toEqual([{ bearer: [] }]);
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
    expect(approve?.post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ]),
    );
    expect(cancel?.post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ]),
    );
    expect(createCustom?.post?.responses?.["409"]).toBeDefined();
    expect(submit?.post?.responses?.["409"]).toBeDefined();
    expect(approve?.post?.responses?.["403"]).toBeDefined();
    expect(approve?.post?.responses?.["409"]).toBeDefined();
    expect(cancel?.post?.responses?.["403"]).toBeDefined();
    expect(cancel?.post?.responses?.["409"]).toBeDefined();
    expect(collection?.post).toBeUndefined();
    expect(collection?.patch).toBeUndefined();
    expect(detail?.post).toBeUndefined();
    expect(detail?.patch).toBeUndefined();
    expect(createCustom?.patch).toBeUndefined();
    expect(submit?.patch).toBeUndefined();
    expect(approve?.patch).toBeUndefined();
    expect(cancel?.patch).toBeUndefined();
  });

  async function createAdminSession(
    role: AdminRole,
  ): Promise<{ id: string; accessToken: string; secret: string }> {
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
    return { id, accessToken: tokens.accessToken, secret };
  }

  async function freshApprovalReauth(accessToken: string, secret: string): Promise<void> {
    const context = await adminAuth.authenticateAccess(accessToken);
    await adminAuth.reauthenticate(
      context,
      ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS,
      generateTotpCode(secret),
    );
  }

  async function freshCancellationReauth(accessToken: string, secret: string): Promise<void> {
    const context = await adminAuth.authenticateAccess(accessToken);
    await adminAuth.reauthenticate(
      context,
      ACCOUNTING_PERIOD_CANCELLATION_ACTION_CLASS,
      generateTotpCode(secret),
    );
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

  async function deleteImmutableTestEvidence(): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Test-only cleanup for an ephemeral integration database. Production evidence has no delete path.
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.auditRecord.deleteMany({
        where: { actorAdminId: { in: adminIds } },
      });
      await tx.adminApprovalEvidence.deleteMany({
        where: {
          OR: [
            { requesterAdminId: { in: adminIds } },
            { approverAdminId: { in: adminIds } },
          ],
        },
      });
    });
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

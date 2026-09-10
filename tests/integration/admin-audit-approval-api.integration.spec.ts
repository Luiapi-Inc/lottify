import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AdminApprovalController } from "../../apps/api/src/admin-approval.controller";
import { AdminAuditController } from "../../apps/api/src/admin-audit.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import { generateTotpCode, generateTotpSecret } from "../../src/contexts/identity-access/domain/totp";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import { AdminApprovalInspectionService } from "../../src/contexts/admin-approval/admin-approval-inspection.service";
import { AuditInspectionService } from "../../src/contexts/audit/audit-inspection.service";
import { getAdminMfaEncryptionKey, resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "admin-audit-approval-integration+";

/** Fixed past instants so filtering/pagination are deterministic. */
const approval1CreatedAt = new Date("2024-01-01T00:00:00.000Z");
const approval1ApprovedAt = new Date("2024-01-01T00:05:00.000Z");
const approval2CreatedAt = new Date("2024-01-02T00:00:00.000Z");
const approval2ApprovedAt = new Date("2024-01-02T00:05:00.000Z");
const audit1CreatedAt = new Date("2024-01-01T00:06:00.000Z");
const audit2CreatedAt = new Date("2024-01-03T00:00:00.000Z");

const APPROVAL_ACTION = "ACCOUNTING_PERIOD_CUSTOM_ACTIVATION";
const CANCELLATION_ACTION = "ACCOUNTING_PERIOD_CUSTOM_CANCELLATION";
const CLOSE_ACTION = "ACCOUNTING_PERIOD_CLOSE";
const APPROVAL_RESOURCE_TYPE = "ACCOUNTING_PERIOD";

describe.runIf(runIntegration)("Admin Audit + Approvals read boundary", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: AdminAuthService;
  let baseUrl: string;

  const adminIds: string[] = [];
  const sessionIds: string[] = [];
  const reauthIds: string[] = [];
  const approvalIds: string[] = [];
  const auditRecordIds: string[] = [];
  const totpSecrets = new Map<string, string>();

  let accessToken = "";
  let actorAdminId = "";
  let approverAdminId = "";
  let sessionAId = "";
  let reauthAId = "";
  let seedResourceId = "";
  let approval1Id = "";
  let approval2Id = "";
  let audit1Id = "";
  let audit2Id = "";

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    adminAuth = new AdminAuthService(new PrismaAdminAuthRepository(prisma), new JwtService());

    await seedEvidence();

    @Module({
      controllers: [AdminAuditController, AdminApprovalController],
      providers: [
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: Reflector, useValue: new Reflector() },
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: AuditInspectionService, useValue: new AuditInspectionService(prisma) },
        {
          provide: AdminApprovalInspectionService,
          useValue: new AdminApprovalInspectionService(prisma),
        },
      ],
    })
    class AuditApprovalApiModule {}

    app = await NestFactory.create(AuditApprovalApiModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.$transaction(async (tx) => {
        // Test-only cleanup for an ephemeral integration database. Production evidence has no delete path.
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        if (auditRecordIds.length > 0) {
          await tx.auditRecord.deleteMany({ where: { id: { in: auditRecordIds } } });
        }
        if (approvalIds.length > 0) {
          await tx.adminApprovalEvidence.deleteMany({ where: { id: { in: approvalIds } } });
        }
      });
      if (reauthIds.length > 0) {
        await prisma.adminReauthEvidence.deleteMany({ where: { id: { in: reauthIds } } });
      }
      if (sessionIds.length > 0) {
        await prisma.adminAuthSession.deleteMany({ where: { id: { in: sessionIds } } });
      }
      await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    } finally {
      try {
        await app?.close();
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  async function createAdminUser(role: "ADMIN" | "AUDITOR"): Promise<string> {
    const id = randomUUID();
    const password = "Admin audit integration password 123!";
    const secret = generateTotpSecret();
    await prisma.adminUser.create({
      data: {
        id,
        email: `${emailPrefix}${id}@example.com`,
        name: `Admin ${role}`,
        passwordHash: await hashAdminPassword(password),
        role,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecretEncrypted: encryptAdminSecret(secret, getAdminMfaEncryptionKey()),
      },
    });
    adminIds.push(id);
    totpSecrets.set(id, secret);
    return id;
  }

  async function loginAccessToken(adminId: string): Promise<string> {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    const login = await adminAuth.login(admin.email, "Admin audit integration password 123!");
    if (login.status !== "MFA_REQUIRED") throw new Error("Expected MFA challenge");
    const secret = totpSecrets.get(adminId);
    if (!secret) throw new Error("Missing TOTP secret for admin");
    const tokens = await adminAuth.verifyMfa(
      login.challengeToken,
      generateTotpCode(secret),
      "127.0.0.1",
      "admin-audit-approval-integration",
    );
    return tokens.accessToken;
  }

  async function seedEvidence(): Promise<void> {
    actorAdminId = await createAdminUser("ADMIN");
    approverAdminId = await createAdminUser("ADMIN");
    // A single unique target resource scopes every count-sensitive assertion so
    // pre-existing audit/approval evidence from other verticals cannot leak in.
    seedResourceId = randomUUID();

    // The login session for the actor doubles as the session referenced by the
    // seeded reauth evidence and audit records.
    accessToken = await loginAccessToken(actorAdminId);
    const actorSession = await prisma.adminAuthSession.findFirstOrThrow({
      where: { adminUserId: actorAdminId },
      select: { id: true },
    });
    sessionAId = actorSession.id;
    sessionIds.push(sessionAId);

    // A separate session for the approver so audit/reauth references are realistic.
    const approverSessionId = randomUUID();
    sessionIds.push(approverSessionId);
    await prisma.adminAuthSession.create({
      data: {
        id: approverSessionId,
        adminUserId: approverAdminId,
        refreshTokenHash: randomUUID(),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        mfaVerifiedAt: new Date(),
        ipAddress: "127.0.0.1",
        userAgent: "admin-audit-approval-integration",
      },
    });

    const reauthAIdCreated = randomUUID();
    reauthIds.push(reauthAIdCreated);
    await prisma.adminReauthEvidence.create({
      data: {
        id: reauthAIdCreated,
        adminUserId: actorAdminId,
        sessionId: sessionAId,
        actionClass: "accounting-period.approve",
        verifiedAt: new Date("2024-01-01T00:04:00.000Z"),
        expiresAt: new Date("2024-01-01T00:34:00.000Z"),
      },
    });
    reauthAId = reauthAIdCreated;

    const approval1IdCreated = randomUUID();
    approvalIds.push(approval1IdCreated);
    await prisma.adminApprovalEvidence.create({
      data: {
        id: approval1IdCreated,
        action: APPROVAL_ACTION,
        resourceType: APPROVAL_RESOURCE_TYPE,
        resourceId: seedResourceId,
        requesterAdminId: actorAdminId,
        approverAdminId: approverAdminId,
        requestedVersion: 1,
        payloadHash: "a".repeat(64),
        reason: "Activate the January Custom Accounting Period",
        policyVersion: "accounting-period-custom-activation-v1",
        reauthEvidenceId: reauthAId,
        correlationId: randomUUID(),
        approvedAt: approval1ApprovedAt,
        createdAt: approval1CreatedAt,
      },
    });
    approval1Id = approval1IdCreated;

    const approval2IdCreated = randomUUID();
    approvalIds.push(approval2IdCreated);
    await prisma.adminApprovalEvidence.create({
      data: {
        id: approval2IdCreated,
        action: CLOSE_ACTION,
        resourceType: APPROVAL_RESOURCE_TYPE,
        resourceId: seedResourceId,
        requesterAdminId: approverAdminId,
        approverAdminId: actorAdminId,
        requestedVersion: 3,
        payloadHash: "b".repeat(64),
        reason: "Close the accounting period",
        policyVersion: "accounting-period-close-v1",
        reauthEvidenceId: reauthAId,
        correlationId: randomUUID(),
        approvedAt: approval2ApprovedAt,
        createdAt: approval2CreatedAt,
      },
    });
    approval2Id = approval2IdCreated;

    const audit1IdCreated = randomUUID();
    auditRecordIds.push(audit1IdCreated);
    await prisma.auditRecord.create({
      data: {
        id: audit1IdCreated,
        actorAdminId: actorAdminId,
        actorRole: "ADMIN",
        sessionId: sessionAId,
        action: APPROVAL_ACTION,
        resourceType: APPROVAL_RESOURCE_TYPE,
        resourceId: seedResourceId,
        payloadHash: "a".repeat(64),
        reason: "Activate the January Custom Accounting Period",
        reauthEvidenceId: reauthAId,
        approvalId: approval1Id,
        correlationId: randomUUID(),
        outcome: "APPROVED",
        createdAt: audit1CreatedAt,
      },
    });
    audit1Id = audit1IdCreated;

    const audit2IdCreated = randomUUID();
    auditRecordIds.push(audit2IdCreated);
    await prisma.auditRecord.create({
      data: {
        id: audit2IdCreated,
        actorAdminId: approverAdminId,
        actorRole: "ADMIN",
        sessionId: approverSessionId,
        action: CANCELLATION_ACTION,
        resourceType: APPROVAL_RESOURCE_TYPE,
        resourceId: seedResourceId,
        payloadHash: "c".repeat(64),
        reason: "Withdraw the request",
        reauthEvidenceId: null,
        approvalId: null,
        correlationId: randomUUID(),
        outcome: "WITHDRAWN",
        createdAt: audit2CreatedAt,
      },
    });
    audit2Id = audit2IdCreated;
  }

  function authenticated(): HeadersInit {
    return { Authorization: `Bearer ${accessToken}` };
  }

  async function get(path: string, headers: HeadersInit = authenticated()) {
    return fetch(`${baseUrl}${path}`, { headers });
  }

  it("denies unauthenticated Admin access to every new read surface", async () => {
    for (const path of [
      "/api/v1/admin/audit/records",
      `/api/v1/admin/audit/records/${audit1Id}`,
      "/api/v1/admin/approvals",
      `/api/v1/admin/approvals/${approval1Id}`,
    ]) {
      const response = await get(path, {});
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  it("lists and reads audit records with actor, outcome and linked reauth/approval evidence", async () => {
    const listed = await get(`/api/v1/admin/audit/records?resourceId=${seedResourceId}`);
    expect(listed.status).toBe(200);
    const page = await listed.json();
    expect(page.dataAsOf).toBeTruthy();
    expect(page.items).toHaveLength(2);

    const audit1 = page.items.find((item: { id: string }) => item.id === audit1Id);
    expect(audit1).toMatchObject({
      id: audit1Id,
      actorAdminId,
      actorRole: "ADMIN",
      action: APPROVAL_ACTION,
      resourceType: APPROVAL_RESOURCE_TYPE,
      resourceId: seedResourceId,
      outcome: "APPROVED",
      reauthEvidenceId: reauthAId,
      approvalId: approval1Id,
      payloadHash: "a".repeat(64),
      reason: "Activate the January Custom Accounting Period",
    });
    expect(audit1.createdAt).toBe(audit1CreatedAt.toISOString());
    expect(audit1.actor).toMatchObject({ id: actorAdminId, role: "ADMIN" });
    expect(audit1.reauthEvidence).toMatchObject({
      id: reauthAId,
      actionClass: "accounting-period.approve",
    });
    expect(audit1.approval).toMatchObject({
      id: approval1Id,
      action: APPROVAL_ACTION,
      resourceType: APPROVAL_RESOURCE_TYPE,
      requesterAdminId: actorAdminId,
      approverAdminId,
    });
    expect(audit1.approval.approvedAt).toBe(approval1ApprovedAt.toISOString());

    const audit2 = page.items.find((item: { id: string }) => item.id === audit2Id);
    expect(audit2).toMatchObject({
      id: audit2Id,
      actorAdminId: approverAdminId,
      action: CANCELLATION_ACTION,
      outcome: "WITHDRAWN",
      reauthEvidenceId: null,
      approvalId: null,
    });
    expect(audit2.reauthEvidence).toBeNull();
    expect(audit2.approval).toBeNull();

    const detail = await get(`/api/v1/admin/audit/records/${audit1Id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual(audit1);

    const missing = await get(`/api/v1/admin/audit/records/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");
  });

  it("filters and pages audit records deterministically", async () => {
    const byActor = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&actor=${actorAdminId}`,
    );
    expect(byActor.status).toBe(200);
    expect((await byActor.json()).items).toHaveLength(1);

    const byAction = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&action=${APPROVAL_ACTION}`,
    );
    expect((await byAction.json()).items).toHaveLength(1);

    const byOutcome = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&outcome=WITHDRAWN`,
    );
    const withdrawnPage = await byOutcome.json();
    expect(withdrawnPage.items).toHaveLength(1);
    expect(withdrawnPage.items[0].id).toBe(audit2Id);

    const rangeFiltered = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&from=2024-01-02T00:00:00.000Z&to=2024-01-04T00:00:00.000Z`,
    );
    const ranged = await rangeFiltered.json();
    expect(ranged.items).toHaveLength(1);
    expect(ranged.items[0].id).toBe(audit2Id);

    const empty = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&from=2025-01-01T00:00:00.000Z&to=2025-01-02T00:00:00.000Z`,
    );
    expect((await empty.json()).items).toHaveLength(0);

    const firstResponse = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&limit=1`,
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0].id);

    const secondResponse = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&limit=1&cursor=${first.nextCursor}`,
    );
    const second = await secondResponse.json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0].id).not.toBe(first.items[0].id);

    const invalidLimit = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&limit=0`,
    );
    expect(invalidLimit.status).toBe(400);
    expect((await invalidLimit.json()).code).toBe("VALIDATION_ERROR");

    const invertedRange = await get(
      `/api/v1/admin/audit/records?resourceId=${seedResourceId}&from=2024-01-02T00:00:00.000Z&to=2024-01-01T00:00:00.000Z`,
    );
    expect(invertedRange.status).toBe(400);
    expect((await invertedRange.json()).code).toBe("VALIDATION_ERROR");
  });

  it("lists and reads approval evidence as a queue with state, age, requester and linked audit/reauth", async () => {
    const listed = await get(`/api/v1/admin/approvals?resourceId=${seedResourceId}`);
    expect(listed.status).toBe(200);
    const page = await listed.json();
    expect(page.dataAsOf).toBeTruthy();
    expect(page.items).toHaveLength(2);

    const approval1 = page.items.find((item: { id: string }) => item.id === approval1Id);
    expect(approval1).toMatchObject({
      id: approval1Id,
      action: APPROVAL_ACTION,
      resourceType: APPROVAL_RESOURCE_TYPE,
      resourceId: seedResourceId,
      requesterAdminId: actorAdminId,
      approverAdminId,
      requestedVersion: 1,
      payloadHash: "a".repeat(64),
      reason: "Activate the January Custom Accounting Period",
      policyVersion: "accounting-period-custom-activation-v1",
      reauthEvidenceId: reauthAId,
      state: "APPROVED",
    });
    expect(approval1.createdAt).toBe(approval1CreatedAt.toISOString());
    expect(approval1.approvedAt).toBe(approval1ApprovedAt.toISOString());
    expect(approval1.ageMs).toBeGreaterThanOrEqual(0);
    expect(approval1.requester).toMatchObject({ id: actorAdminId, role: "ADMIN" });
    expect(approval1.approver).toMatchObject({ id: approverAdminId, role: "ADMIN" });
    expect(approval1.reauthEvidence).toMatchObject({
      id: reauthAId,
      actionClass: "accounting-period.approve",
    });
    expect(approval1.auditRecords).toEqual([
      expect.objectContaining({ id: audit1Id, outcome: "APPROVED" }),
    ]);

    const detail = await get(`/api/v1/admin/approvals/${approval1Id}`);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    const { ageMs: detailAgeMs, ...detailEvidence } = detailBody;
    const { ageMs: listAgeMs, ...listEvidence } = approval1;
    // Queue age is evaluated against each response's own dataAsOf instant.
    expect(detailEvidence).toEqual(listEvidence);
    expect(detailAgeMs).toBeGreaterThanOrEqual(listAgeMs);

    const missing = await get(`/api/v1/admin/approvals/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");
  });

  it("filters approval evidence by state and target deterministically", async () => {
    const byState = await get(
      `/api/v1/admin/approvals?resourceId=${seedResourceId}&state=APPROVED`,
    );
    expect(byState.status).toBe(200);
    expect((await byState.json()).items).toHaveLength(2);

    const byAction = await get(
      `/api/v1/admin/approvals?resourceId=${seedResourceId}&action=${APPROVAL_ACTION}`,
    );
    const actionPage = await byAction.json();
    expect(actionPage.items).toHaveLength(1);
    expect(actionPage.items[0].id).toBe(approval1Id);

    const byResourceType = await get(
      `/api/v1/admin/approvals?resourceId=${seedResourceId}&resourceType=${APPROVAL_RESOURCE_TYPE}`,
    );
    expect((await byResourceType.json()).items).toHaveLength(2);

    const rangeFiltered = await get(
      `/api/v1/admin/approvals?resourceId=${seedResourceId}&from=2024-01-01T00:00:00.000Z&to=2024-01-01T23:59:59.999Z`,
    );
    const ranged = await rangeFiltered.json();
    expect(ranged.items).toHaveLength(1);
    expect(ranged.items[0].id).toBe(approval1Id);

    const empty = await get(
      `/api/v1/admin/approvals?resourceId=${seedResourceId}&from=2025-01-01T00:00:00.000Z&to=2025-01-02T00:00:00.000Z`,
    );
    expect((await empty.json()).items).toHaveLength(0);

    const firstResponse = await get(
      `/api/v1/admin/approvals?resourceId=${seedResourceId}&limit=1`,
    );
    const first = await firstResponse.json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0].id);

    const secondResponse = await get(
      `/api/v1/admin/approvals?resourceId=${seedResourceId}&limit=1&cursor=${first.nextCursor}`,
    );
    const second = await secondResponse.json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0].id).not.toBe(first.items[0].id);

    const invalidState = await get(
      `/api/v1/admin/approvals?resourceId=${seedResourceId}&state=PENDING`,
    );
    expect(invalidState.status).toBe(400);
    expect((await invalidState.json()).code).toBe("VALIDATION_ERROR");
  });
});

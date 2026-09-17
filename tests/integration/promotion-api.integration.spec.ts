import "reflect-metadata";
import { Module } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  AdminPromotionController,
} from "../../apps/api/src/admin-promotion.controller";
import { MemberPromotionController } from "../../apps/api/src/member-promotion.controller";
import { MemberNotificationPreferenceController } from "../../apps/api/src/member-notification-preference.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import type { AdminRole } from "../../src/contexts/identity-access/domain/admin-auth.repository";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import { generateTotpCode, generateTotpSecret } from "../../src/contexts/identity-access/domain/totp";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { PromotionCampaignService } from "../../src/contexts/promotion/application/promotion-campaign.service";
import { PromotionEntitlementService } from "../../src/contexts/promotion/application/promotion-entitlement.service";
import { NotificationPreferenceService } from "../../src/contexts/promotion/application/notification-preference.service";
import type { PromotionMemberFactsPort } from "../../src/contexts/promotion/application/promotion-member-facts.port";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { PromotionLedgerAdapter } from "../../src/platform/integration/promotion-ledger.adapter";
import { getAdminMfaEncryptionKey, resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { validTerms } from "../support/promotion-fixtures";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "promotion-api-integration+";
const phonePrefix = "+6696";

describe.runIf(runIntegration)("Promotion API HTTP boundary", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: AdminAuthService;
  let baseUrl: string;
  let memberId: string;
  let authorMemberId: string;

  const adminIds: string[] = [];
  const campaignIds: string[] = [];
  const versionIds: string[] = [];
  const entitlementIds: string[] = [];
  const ledgerTransactionIds: string[] = [];
  const mfaSecrets = new Map<string, string>();

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    adminAuth = new AdminAuthService(new PrismaAdminAuthRepository(prisma), new JwtService());

    const ledger = new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(prisma, new DatabaseAccountingPeriodTransactionClock()),
    );
    const ledgerPort = new PromotionLedgerAdapter(ledger);
    const memberFacts: PromotionMemberFactsPort = {
      async getMemberFacts(id: string) {
        const member = await prisma.member.findUniqueOrThrow({
          where: { id },
          select: { id: true, status: true },
        });
        return { memberId: member.id, status: member.status };
      },
    };
    const campaigns = new PromotionCampaignService(prisma, memberFacts);
    const entitlements = new PromotionEntitlementService(prisma, ledgerPort, memberFacts);
    const preferences = new NotificationPreferenceService(prisma);

    // The Member surface authenticates through identity-access; this fixture
    // resolves the two test Members the same way a real session would.
    const sessions = {
      async authenticateAccess(token: string) {
        const resolved = token === "author" ? authorMemberId : memberId;
        return { memberId: resolved, sessionId: "integration-session", deviceId: null };
      },
    };

    @Module({
      controllers: [
        AdminPromotionController,
        MemberPromotionController,
        MemberNotificationPreferenceController,
      ],
      providers: [
        AdminAuthGuard,
        AdminCapabilityGuard,
        MemberAuthGuard,
        { provide: Reflector, useValue: new Reflector() },
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: SessionService, useValue: sessions },
        { provide: PromotionCampaignService, useValue: campaigns },
        { provide: PromotionEntitlementService, useValue: entitlements },
        { provide: NotificationPreferenceService, useValue: preferences },
      ],
    })
    class PromotionApiModule {}

    app = await NestFactory.create(PromotionApiModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    memberId = await createMember();
    authorMemberId = await createMember();
  });

  afterAll(async () => {
    try {
      await prisma.promotionTurnoverEntry.deleteMany({ where: { memberId: { in: [memberId, authorMemberId] } } });
      await prisma.promotionEntitlement.deleteMany({ where: { memberId: { in: [memberId, authorMemberId] } } });
      await prisma.memberNotificationPreference.deleteMany({
        where: { memberId: { in: [memberId, authorMemberId] } },
      });
      await prisma.promotionCampaignVersion.deleteMany({ where: { id: { in: versionIds } } });
      await prisma.promotionCampaign.deleteMany({ where: { id: { in: campaignIds } } });

      const transactions = await prisma.financialTransaction.findMany({
        where: { id: { in: ledgerTransactionIds } },
        select: { id: true, accountingPeriodId: true },
      });
      const ownAccountIds = (
        await prisma.ledgerPosting.findMany({
          where: { transactionId: { in: transactions.map((row) => row.id) } },
          select: { accountId: true },
          distinct: ["accountId"],
        })
      ).map((row) => row.accountId);
      await prisma.ledgerPosting.deleteMany({ where: { transactionId: { in: transactions.map((row) => row.id) } } });
      await prisma.financialTransaction.deleteMany({ where: { id: { in: transactions.map((row) => row.id) } } });
      await prisma.ledgerAccount.deleteMany({
        where: {
          OR: [{ memberId: { in: [memberId, authorMemberId] } }, { id: { in: ownAccountIds } }],
        },
      });
      // Accounting periods are auto-created and shared across suites, so only the
      // ones no transaction references any more may be removed — deleting a period
      // another suite still uses violates its foreign key.
      const periodIds = [...new Set(transactions.map((row) => row.accountingPeriodId))];
      const stillReferencedPeriodIds = new Set(
        (
          await prisma.financialTransaction.findMany({
            where: { accountingPeriodId: { in: periodIds } },
            select: { accountingPeriodId: true },
            distinct: ["accountingPeriodId"],
          })
        ).map((row) => row.accountingPeriodId),
      );
      const deletablePeriodIds = periodIds.filter((id) => !stillReferencedPeriodIds.has(id));
      if (deletablePeriodIds.length > 0) {
        await prisma.accountingPeriod.deleteMany({ where: { id: { in: deletablePeriodIds } } });
      }

      await prisma.idempotencyRecord.deleteMany({
        where: { OR: [...adminIds.map((id) => ({ scope: { startsWith: `admin:${id}:promotion:` } })), { scope: { startsWith: "PROMOTION_CLAIM:" } }] },
      });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "admin_approval_evidence" DISABLE TRIGGER "admin_approval_evidence_immutable"');
        await tx.auditRecord.deleteMany({ where: { resourceId: { in: versionIds } } });
        await tx.adminApprovalEvidence.deleteMany({ where: { resourceId: { in: versionIds } } });
        await tx.$executeRawUnsafe('ALTER TABLE "admin_approval_evidence" ENABLE TRIGGER "admin_approval_evidence_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"');
      });
      await prisma.adminReauthEvidence.deleteMany({ where: { adminUserId: { in: adminIds } } });
      await prisma.adminAuthSession.deleteMany({ where: { adminUserId: { in: adminIds } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
      await prisma.member.deleteMany({ where: { id: { in: [memberId, authorMemberId] } } });
    } finally {
      try {
        await app?.close();
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  async function createMember(): Promise<string> {
    const phone = `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 8)}`;
    const member = await prisma.member.create({ data: { phone } });
    return member.id;
  }

  async function createAdminSession(role: AdminRole): Promise<{ id: string; accessToken: string }> {
    const id = randomUUID();
    const password = "Promotion API integration password 123!";
    const secret = generateTotpSecret();
    const email = `${emailPrefix}${role.toLowerCase()}-${id}@example.com`;
    await prisma.adminUser.create({
      data: {
        id,
        email,
        name: `Promotion ${role}`,
        passwordHash: await hashAdminPassword(password),
        role,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecretEncrypted: encryptAdminSecret(secret, getAdminMfaEncryptionKey()),
      },
    });
    adminIds.push(id);
    const login = await adminAuth.login(email, password);
    if (login.status !== "MFA_REQUIRED") throw new Error("Expected MFA challenge");
    const tokens = await adminAuth.verifyMfa(
      login.challengeToken,
      generateTotpCode(secret),
      "127.0.0.1",
      "promotion-api-integration",
    );
    mfaSecrets.set(tokens.accessToken, secret);
    return { id, accessToken: tokens.accessToken };
  }

  async function reauth(accessToken: string): Promise<void> {
    const context = await adminAuth.authenticateAccess(accessToken);
    await adminAuth.reauthenticate(
      context,
      "promotion-campaign.publish",
      generateTotpCode(mfaSecrets.get(accessToken)!),
    );
  }

  const authHeaders = (accessToken: string, key?: string) => ({
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    ...(key ? { "Idempotency-Key": key } : {}),
  });

  const termsPayload = () => JSON.parse(JSON.stringify(validTerms(), (_key, value) => value)) as Record<
    string,
    unknown
  >;

  let maker: { id: string; accessToken: string };
  let checker: { id: string; accessToken: string };
  let versionId = "";
  let campaignCode = "";

  it("rejects unauthenticated Admin access and denies a missing capability", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/admin/promotions`);
    expect(unauthenticated.status).toBe(401);

    const auditor = await createAdminSession("AUDITOR");
    const created = await fetch(`${baseUrl}/api/v1/admin/promotions`, {
      method: "POST",
      headers: authHeaders(auditor.accessToken, randomUUID()),
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(403);
    expect((await created.json()).code).toBe("ACCESS_DENIED");

    const readable = await fetch(`${baseUrl}/api/v1/admin/promotions`, {
      headers: { Authorization: `Bearer ${auditor.accessToken}` },
    });
    expect(readable.status).toBe(200);
  });

  it("requires an Idempotency-Key and replays the same command exactly once", async () => {
    maker = await createAdminSession("ADMIN");
    campaignCode = `HTTP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const payload = {
      campaignCode,
      version: 1,
      terms: termsPayload(),
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      reason: "http fixture",
    };

    const missingKey = await fetch(`${baseUrl}/api/v1/admin/promotions`, {
      method: "POST",
      headers: authHeaders(maker.accessToken),
      body: JSON.stringify(payload),
    });
    expect(missingKey.status).toBe(400);
    expect((await missingKey.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const key = randomUUID();
    const first = await fetch(`${baseUrl}/api/v1/admin/promotions`, {
      method: "POST",
      headers: authHeaders(maker.accessToken, key),
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created.state).toBe("DRAFT");
    expect(created.revision).toBe(1);
    versionId = created.id;
    campaignIds.push(created.campaignId);
    versionIds.push(created.id);

    const replay = await fetch(`${baseUrl}/api/v1/admin/promotions`, {
      method: "POST",
      headers: authHeaders(maker.accessToken, key),
      body: JSON.stringify(payload),
    });
    expect((await replay.json()).id).toBe(created.id);

    const conflicting = await fetch(`${baseUrl}/api/v1/admin/promotions`, {
      method: "POST",
      headers: authHeaders(maker.accessToken, key),
      body: JSON.stringify({ ...payload, version: 2 }),
    });
    expect(conflicting.status).toBe(409);
    expect((await conflicting.json()).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("validates with optimistic concurrency and refuses to publish without fresh MFA", async () => {
    const stale = await fetch(`${baseUrl}/api/v1/admin/promotions/${versionId}/validate`, {
      method: "POST",
      headers: authHeaders(maker.accessToken, randomUUID()),
      body: JSON.stringify({ expectedVersion: 99 }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("VERSION_CONFLICT");

    const validated = await fetch(`${baseUrl}/api/v1/admin/promotions/${versionId}/validate`, {
      method: "POST",
      headers: authHeaders(maker.accessToken, randomUUID()),
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    expect(validated.status).toBe(200);
    expect((await validated.json()).state).toBe("VALIDATED");

    checker = await createAdminSession("ADMIN");
    const noMfa = await fetch(`${baseUrl}/api/v1/admin/promotions/${versionId}/approve`, {
      method: "POST",
      headers: authHeaders(checker.accessToken, randomUUID()),
      body: JSON.stringify({ expectedVersion: 2, reason: "http publish" }),
    });
    expect(noMfa.status).toBe(403);
  });

  it("previews eligibility and publishes with approval evidence", async () => {
    const preview = await fetch(`${baseUrl}/api/v1/admin/promotions/${versionId}/preview`, {
      method: "POST",
      headers: authHeaders(checker.accessToken),
      body: JSON.stringify({ memberId }),
    });
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.eligible).toBe(true);
    expect(previewBody.entitlementPreview.turnoverTargetMinor).toBe("150000");

    await reauth(checker.accessToken);
    const approved = await fetch(`${baseUrl}/api/v1/admin/promotions/${versionId}/approve`, {
      method: "POST",
      headers: authHeaders(checker.accessToken, randomUUID()),
      body: JSON.stringify({ expectedVersion: 2, reason: "http publish" }),
    });
    expect(approved.status).toBe(200);
    const published = await approved.json();
    expect(published.state).toBe("PUBLISHED");
    expect(published.publishedAt).toBeTruthy();

    const approvals = await prisma.adminApprovalEvidence.findMany({ where: { resourceId: versionId } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.approverAdminId).toBe(checker.id);
    expect(approvals[0]!.requesterAdminId).toBe(maker.id);

    // Maker-checker: the creator cannot approve their own version.
    const selfApproval = await fetch(`${baseUrl}/api/v1/admin/promotions/${versionId}/approve`, {
      method: "POST",
      headers: authHeaders(maker.accessToken, randomUUID()),
      body: JSON.stringify({ expectedVersion: 3 }),
    });
    expect(selfApproval.status).toBe(403);
  });

  it("serves the Member promotion surface over HTTP", async () => {
    const discovery = await fetch(`${baseUrl}/api/v1/member/promotions`, {
      headers: { Authorization: "Bearer member" },
    });
    expect(discovery.status).toBe(200);
    const discoveryBody = await discovery.json();
    const item = discoveryBody.items.find(
      (entry: { campaignVersionId: string }) => entry.campaignVersionId === versionId,
    );
    expect(item).toMatchObject({
      campaignCode,
      eligible: true,
      rewardAmountMinor: "50000",
      turnoverTargetMinor: "150000",
    });

    const noKey = await fetch(`${baseUrl}/api/v1/member/promotions/entitlements`, {
      method: "POST",
      headers: { Authorization: "Bearer member", "content-type": "application/json" },
      body: JSON.stringify({ campaignVersionId: versionId }),
    });
    expect(noKey.status).toBe(400);
    expect((await noKey.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const claimed = await fetch(`${baseUrl}/api/v1/member/promotions/entitlements`, {
      method: "POST",
      headers: {
        Authorization: "Bearer member",
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ campaignVersionId: versionId }),
    });
    expect(claimed.status).toBe(201);
    const entitlement = await claimed.json();
    entitlementIds.push(entitlement.id);
    ledgerTransactionIds.push(entitlement.grantLedgerTransactionId);
    expect(entitlement).toMatchObject({
      state: "ACTIVE",
      rewardMinor: "50000",
      turnoverTargetMinor: "150000",
      allowedActions: ["RELEASE_PENDING", "EXPIRED", "REVOKED"],
    });
    expect(entitlement.turnover.releaseReached).toBe(false);

    const read = await fetch(`${baseUrl}/api/v1/member/promotions/entitlements/${entitlement.id}`, {
      headers: { Authorization: "Bearer member" },
    });
    expect(read.status).toBe(200);
    expect((await read.json()).id).toBe(entitlement.id);

    // Another Member can never read this Entitlement.
    const foreign = await fetch(`${baseUrl}/api/v1/member/promotions/entitlements/${entitlement.id}`, {
      headers: { Authorization: "Bearer author" },
    });
    expect(foreign.status).toBe(404);

    const list = await fetch(`${baseUrl}/api/v1/member/promotions/entitlements`, {
      headers: { Authorization: "Bearer member" },
    });
    expect(list.status).toBe(200);
    const page = await list.json();
    expect(page.items.map((entry: { id: string }) => entry.id)).toContain(entitlement.id);

    const discoveryAfterClaim = await discoveryAgain();
    expect(
      discoveryAfterClaim.items.find(
        (entry: { campaignVersionId: string }) => entry.campaignVersionId === versionId,
      ).ineligibilityReasons,
    ).toEqual(["CAMPAIGN_VERSION_ALREADY_GRANTED"]);

    async function discoveryAgain() {
      const response = await fetch(`${baseUrl}/api/v1/member/promotions`, {
        headers: { Authorization: "Bearer member" },
      });
      return response.json();
    }
  });

  it("serves Member notification preferences and rejects a mandatory opt-out", async () => {
    const initial = await fetch(`${baseUrl}/api/v1/member/notification-preferences`, {
      headers: { Authorization: "Bearer member" },
    });
    expect(initial.status).toBe(200);
    expect((await initial.json()).items).toHaveLength(12);

    const updated = await fetch(`${baseUrl}/api/v1/member/notification-preferences`, {
      method: "PUT",
      headers: { Authorization: "Bearer member", "content-type": "application/json" },
      body: JSON.stringify({ preferences: [{ topic: "PROMOTIONAL", channel: "SMS", enabled: false }] }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json();
    expect(
      updatedBody.items.find(
        (item: { topic: string; channel: string }) => item.topic === "PROMOTIONAL" && item.channel === "SMS",
      ),
    ).toMatchObject({ enabled: false, version: 1 });

    const mandatory = await fetch(`${baseUrl}/api/v1/member/notification-preferences`, {
      method: "PUT",
      headers: { Authorization: "Bearer member", "content-type": "application/json" },
      body: JSON.stringify({ preferences: [{ topic: "SECURITY", channel: "SMS", enabled: false }] }),
    });
    expect(mandatory.status).toBe(400);
    expect((await mandatory.json()).code).toBe("NOTIFICATION_PREFERENCE_MANDATORY");

    const invalid = await fetch(`${baseUrl}/api/v1/member/notification-preferences`, {
      method: "PUT",
      headers: { Authorization: "Bearer member", "content-type": "application/json" },
      body: JSON.stringify({ preferences: [] }),
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe("VALIDATION_ERROR");
  });

  it("keeps the durable Idempotency-Key fingerprint canonical for Promotion commands", async () => {
    const records = await prisma.idempotencyRecord.findMany({
      where: { OR: adminIds.map((id) => ({ scope: { startsWith: `admin:${id}:promotion:` } })) },
      orderBy: { createdAt: "asc" },
    });
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(record.status).toBe("COMPLETED");
      expect(record.responseBody).not.toBeNull();
      expect(createHash("sha256").update(record.scope).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

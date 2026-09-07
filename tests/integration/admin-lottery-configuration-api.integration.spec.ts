import "reflect-metadata";
import { Module } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
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
  const versionIds: string[] = [];

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
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"');
        await tx.auditRecord.deleteMany({ where: { actorAdminId: { in: adminIds } } });
        await tx.idempotencyRecord.deleteMany({
          where: { OR: adminIds.map((id) => ({ scope: { startsWith: `admin:${id}:lottery:` } })) },
        });
        await tx.lotteryBetTypeVersion.deleteMany({ where: { id: { in: versionIds } } });
        await tx.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
        await tx.adminAuthSession.deleteMany({ where: { adminUserId: { in: adminIds } } });
        await tx.adminReauthEvidence.deleteMany({ where: { adminUserId: { in: adminIds } } });
        await tx.adminUser.deleteMany({ where: { id: { in: adminIds } } });
        await tx.$executeRawUnsafe('ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"');
      });
    } finally {
      try {
        await app?.close();
      } finally {
        await prisma.$disconnect();
      }
    }
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

  it("creates a version with minor-unit amounts and replays it", async () => {
    const admin = await createAdminSession("ADMIN");
    const identity = await createBetType(admin.accessToken, randomUUID(), `AMOUNT_${randomUUID()}`);
    expect(identity.response.status).toBe(201);
    betTypeIds.push(identity.body.id);
    const key = randomUUID();
    const payload = { version: 1, canonicalNumberFormat: "00", validationPattern: "^[0-9]{2}$", defaultPayout: { amountMinor: 9000 }, minStakeMinor: "100", maxStakeMinor: "100000", limitPolicyRef: "limit-v1", restrictionPolicyRef: "restriction-v1", settlementRuleVersionRef: "settlement-v1", effectiveFrom: "2099-01-01T00:00:00.000Z" };
    const send = () => fetch(`${baseUrl}/api/v1/admin/lottery/bet-types/${identity.body.id}/versions`, { method: "POST", headers: { Authorization: `Bearer ${admin.accessToken}`, "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(payload) });
    const first = await send();
    expect(first.status).toBe(201);
    const body = await first.json();
    versionIds.push(body.id);
    expect(await (await send()).json()).toEqual(body);
  });

  it("replays pre-canonicalization completed submit records and preserves conflicts and reconciliation", async () => {
    const token = await createAdminSession("ADMIN");
    const actor = await adminAuth.authenticateAccess(token.accessToken);
    const service = new LotteryConfigurationService(prisma);
    const identity = await service.createBetType({ code: `LEGACY_${randomUUID()}`, actor });
    betTypeIds.push(identity.id);
    const version = await service.createBetTypeVersion({
      betTypeId: identity.id, version: 1, canonicalNumberFormat: "00", validationPattern: "^[0-9]{2}$",
      defaultPayout: { amountMinor: 9000 }, minStakeMinor: 100n, maxStakeMinor: 100000n,
      limitPolicyRef: "limit-v1", restrictionPolicyRef: "restriction-v1", settlementRuleVersionRef: "settlement-v1",
      effectiveFrom: new Date("2099-01-01T00:00:00Z"), actor,
    });
    versionIds.push(version.id);
    const original = await service.submit({ kind: "BET_TYPE", id: version.id, expectedRevision: 1, actor });
    const responseBody = JSON.parse(JSON.stringify(original));
    const scope = `admin:${actor.adminId}:lottery:BET_TYPE:${version.id}:submit`;
    // Exact fingerprint algorithm and property order from the pre-upgrade controller.
    const fingerprint = createHash("sha256").update(JSON.stringify({ kind: "BET_TYPE", id: version.id, expectedVersion: 1 })).digest("hex");
    const key = randomUUID();
    await prisma.idempotencyRecord.create({ data: {
      scope, key, fingerprint, status: "COMPLETED", responseCode: 200, responseBody,
      expiresAt: new Date("2199-01-01T00:00:00Z"),
    } });
    const send = (requestKey: string, expectedVersion = 1) => fetch(`${baseUrl}/api/v1/admin/lottery/bet-type-versions/${version.id}/submit`, {
      method: "POST", headers: { Authorization: `Bearer ${token.accessToken}`, "content-type": "application/json", "Idempotency-Key": requestKey },
      body: JSON.stringify({ expectedVersion }),
    });
    const replay = await send(key);
    expect(replay.status).toBe(201); // Nest's existing command HTTP status is unchanged.
    expect(await replay.json()).toEqual(responseBody);
    const conflict = await send(key, 2);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const incompleteKey = randomUUID();
    await prisma.idempotencyRecord.create({ data: {
      scope, key: incompleteKey, fingerprint, status: "IN_PROGRESS", expiresAt: new Date("2199-01-01T00:00:00Z"),
    } });
    const incomplete = await send(incompleteKey);
    expect(incomplete.status).toBe(409);
    expect(await incomplete.json()).toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
    expect(await prisma.lotteryBetTypeVersion.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ state: "REVIEW", revision: 2 });
    expect(await prisma.auditRecord.count({ where: { resourceId: version.id, action: "LOTTERY_BET_TYPE_VERSION_SUBMIT" } })).toBe(1);
  });

  it("rolls back effects before result persistence and safely retries", async () => {
    const token = await createAdminSession("ADMIN");
    const actor = await adminAuth.authenticateAccess(token.accessToken);
    const service = new LotteryConfigurationService(prisma);
    const input = { scope: `admin:${actor.adminId}:lottery:failure`, key: randomUUID(), fingerprint: "same", responseCode: 201 };
    const code = `ROLLBACK_${randomUUID()}`;
    await expect(service.executeCommand(input, async () => {
      await service.createBetType({ code, actor });
      throw new Error("injected before durable result");
    })).rejects.toThrow("injected");
    expect(await prisma.lotteryBetType.count({ where: { code } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { scope: input.scope } })).toBe(0);
    const result = await service.executeCommand(input, () => service.createBetType({ code, actor })) as { id: string };
    betTypeIds.push(result.id);
    expect(await service.executeCommand(input, () => { throw new Error("must not re-execute"); })).toEqual(result);
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

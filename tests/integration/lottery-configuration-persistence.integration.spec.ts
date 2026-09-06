import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { LotteryConfigurationService } from "../../src/contexts/lottery/application/lottery-configuration.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Lottery configuration persistence", () => {
  let prisma: PrismaService;
  let configuration: LotteryConfigurationService;
  let adminId: string;
  let sessionId: string;
  const productIds: string[] = [];
  const betTypeIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeVersionIds: string[] = [];

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    configuration = new LotteryConfigurationService(prisma);
    adminId = randomUUID();
    sessionId = randomUUID();
    await prisma.adminUser.create({
      data: {
        id: adminId,
        email: `lottery-config-${adminId}@example.test`,
        name: "Lottery Config Test",
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    await prisma.adminAuthSession.create({
      data: {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: `refresh-${sessionId}`,
        familyId: randomUUID(),
        expiresAt: new Date("2199-01-01T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "lottery_product_versions" DISABLE TRIGGER "lottery_product_versions_published_immutable"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "lottery_bet_type_versions" DISABLE TRIGGER "lottery_bet_type_versions_published_immutable"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"',
    );
    await prisma.lotteryProductVersionBetType.deleteMany({
      where: { productVersionId: { in: productVersionIds } },
    });
    await prisma.lotteryProductVersion.deleteMany({
      where: { id: { in: productVersionIds } },
    });
    await prisma.lotteryBetTypeVersion.deleteMany({
      where: { id: { in: betTypeVersionIds } },
    });
    await prisma.lotteryProduct.deleteMany({ where: { id: { in: productIds } } });
    await prisma.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
    await prisma.auditRecord.deleteMany({ where: { actorAdminId: adminId } });
    await prisma.adminAuthSession.deleteMany({ where: { id: sessionId } });
    await prisma.adminUser.deleteMany({ where: { id: adminId } });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"',
    );
    await prisma.$disconnect();
  });

  it("keeps Product and Bet Type published versions immutable and non-overlapping", async () => {
    const productId = randomUUID();
    const betTypeId = randomUUID();
    const productVersionId = randomUUID();
    const betTypeVersionId = randomUUID();
    productIds.push(productId);
    betTypeIds.push(betTypeId);
    productVersionIds.push(productVersionId);
    betTypeVersionIds.push(betTypeVersionId);

    await prisma.lotteryProduct.create({ data: { id: productId } });
    await prisma.lotteryBetType.create({ data: { id: betTypeId, code: `PAIR_${betTypeId.slice(0, 8)}` } });
    await prisma.lotteryBetTypeVersion.create({
      data: {
        id: betTypeVersionId,
        betTypeId,
        state: "DRAFT",
        canonicalNumberFormat: "00",
        validationPattern: "^\\d{2}$",
        defaultPayout: { kind: "FIXED", amountMinor: 9000 },
        minStakeMinor: 100n,
        maxStakeMinor: 100000n,
        limitPolicyRef: "limit-v1",
        restrictionPolicyRef: "restriction-v1",
        settlementRuleVersionRef: "settlement-v1",
        effectiveFrom: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    await prisma.lotteryProductVersion.create({
      data: {
        id: productVersionId,
        productId,
        state: "DRAFT",
        timezone: "Asia/Bangkok",
        scheduleTemplateRef: "schedule-v1",
        resultSchemaVersionRef: "result-v1",
        settlementRuleVersionRef: "settlement-v1",
        defaultPayoutPolicyRef: "payout-v1",
        defaultLimitPolicyRef: "limit-v1",
        defaultRestrictionPolicyRef: "restriction-v1",
        effectiveFrom: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    await prisma.lotteryProductVersionBetType.create({
      data: { productVersionId, betTypeId, betTypeVersionId },
    });

    await prisma.lotteryBetTypeVersion.update({
      where: { id: betTypeVersionId },
      data: { state: "REVIEW" },
    });
    await prisma.lotteryProductVersion.update({
      where: { id: productVersionId },
      data: { state: "REVIEW" },
    });
    await prisma.lotteryBetTypeVersion.update({
      where: { id: betTypeVersionId },
      data: { state: "PUBLISHED" },
    });
    await prisma.lotteryProductVersion.update({
      where: { id: productVersionId },
      data: { state: "PUBLISHED" },
    });

    await expect(
      prisma.lotteryProductVersion.update({
        where: { id: productVersionId },
        data: { reason: "must remain immutable" },
      }),
    ).rejects.toThrow("Published Lottery configuration versions are immutable");

    const overlappingVersionId = randomUUID();
    productVersionIds.push(overlappingVersionId);
    await expect(
      prisma.lotteryProductVersion.create({
        data: {
          id: overlappingVersionId,
          productId,
          version: 2,
          state: "PUBLISHED",
          timezone: "Asia/Bangkok",
          scheduleTemplateRef: "schedule-v2",
          resultSchemaVersionRef: "result-v2",
          settlementRuleVersionRef: "settlement-v2",
          defaultPayoutPolicyRef: "payout-v2",
          defaultLimitPolicyRef: "limit-v2",
          defaultRestrictionPolicyRef: "restriction-v2",
          effectiveFrom: new Date("2099-06-01T00:00:00.000Z"),
          effectiveUntil: new Date("2099-12-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a Product version linking a Bet Type version from another identity", async () => {
    const productId = randomUUID();
    const firstBetTypeId = randomUUID();
    const secondBetTypeId = randomUUID();
    const productVersionId = randomUUID();
    const betTypeVersionId = randomUUID();
    productIds.push(productId);
    betTypeIds.push(firstBetTypeId, secondBetTypeId);
    productVersionIds.push(productVersionId);
    betTypeVersionIds.push(betTypeVersionId);

    await prisma.lotteryProduct.create({ data: { id: productId } });
    await prisma.lotteryBetType.createMany({
      data: [
        { id: firstBetTypeId, code: `FIRST_${firstBetTypeId.slice(0, 8)}` },
        { id: secondBetTypeId, code: `SECOND_${secondBetTypeId.slice(0, 8)}` },
      ],
    });
    await prisma.lotteryBetTypeVersion.create({
      data: {
        id: betTypeVersionId,
        betTypeId: firstBetTypeId,
        state: "DRAFT",
        canonicalNumberFormat: "00",
        validationPattern: "^\\d{2}$",
        defaultPayout: { kind: "FIXED", amountMinor: 9000 },
        minStakeMinor: 100n,
        maxStakeMinor: 100000n,
        limitPolicyRef: "limit-v1",
        restrictionPolicyRef: "restriction-v1",
        settlementRuleVersionRef: "settlement-v1",
        effectiveFrom: new Date("2199-01-01T00:00:00.000Z"),
      },
    });
    await prisma.lotteryProductVersion.create({
      data: {
        id: productVersionId,
        productId,
        state: "DRAFT",
        timezone: "Asia/Bangkok",
        scheduleTemplateRef: "schedule-v1",
        resultSchemaVersionRef: "result-v1",
        settlementRuleVersionRef: "settlement-v1",
        defaultPayoutPolicyRef: "payout-v1",
        defaultLimitPolicyRef: "limit-v1",
        defaultRestrictionPolicyRef: "restriction-v1",
        effectiveFrom: new Date("2199-01-01T00:00:00.000Z"),
      },
    });

    await expect(
      prisma.lotteryProductVersionBetType.create({
        data: {
          productVersionId,
          betTypeId: secondBetTypeId,
          betTypeVersionId,
        },
      }),
    ).rejects.toThrow("Lottery Product version references a Bet Type version from a different Bet Type");
  });

  it("uses a separate revision for optimistic lifecycle commands", async () => {
    const actor = { adminId, sessionId, role: "ADMIN" as const };
    const betType = await configuration.createBetType({
      code: `REVISION_${adminId.slice(0, 8)}`,
      actor,
    });
    betTypeIds.push(betType.id);
    const version = await configuration.createBetTypeVersion({
      betTypeId: betType.id,
      version: 1,
      canonicalNumberFormat: "00",
      validationPattern: "^\\d{2}$",
      defaultPayout: { kind: "FIXED", amountMinor: 9000 },
      minStakeMinor: 100n,
      maxStakeMinor: 100000n,
      limitPolicyRef: "limit-v1",
      restrictionPolicyRef: "restriction-v1",
      settlementRuleVersionRef: "settlement-v1",
      effectiveFrom: new Date("2299-01-01T00:00:00.000Z"),
      actor,
    });
    betTypeVersionIds.push(version.id);

    const submitted = await configuration.submit({
      kind: "BET_TYPE",
      id: version.id,
      expectedRevision: 1,
      actor,
    });
    expect(submitted).toMatchObject({ state: "REVIEW", version: 1, revision: 2 });
    await expect(
      configuration.submit({ kind: "BET_TYPE", id: version.id, expectedRevision: 1, actor }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

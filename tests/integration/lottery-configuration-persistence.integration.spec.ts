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
    try {
      // Transaction rollback restores trigger state if any cleanup statement fails.
      await prisma.$transaction(async (tx) => {
        // Shared cleanup lock order: audit, Bet Type versions, Product versions, links.
        await tx.$executeRawUnsafe(
          'ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "lottery_bet_type_versions" DISABLE TRIGGER "lottery_bet_type_versions_published_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "lottery_product_versions" DISABLE TRIGGER "lottery_product_versions_published_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "lottery_product_version_bet_types" DISABLE TRIGGER "lottery_product_version_links_immutable"',
        );
        await tx.lotteryProductVersionBetType.deleteMany({
          where: { productVersionId: { in: productVersionIds } },
        });
        await tx.lotteryProductVersion.deleteMany({
          where: { id: { in: productVersionIds } },
        });
        await tx.lotteryBetTypeVersion.deleteMany({
          where: { id: { in: betTypeVersionIds } },
        });
        await tx.lotteryProduct.deleteMany({ where: { id: { in: productIds } } });
        await tx.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
        await tx.auditRecord.deleteMany({ where: { actorAdminId: adminId } });
        await tx.adminAuthSession.deleteMany({ where: { id: sessionId } });
        await tx.adminUser.deleteMany({ where: { id: adminId } });
        await tx.$executeRawUnsafe(
          'ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "lottery_product_version_bet_types" ENABLE TRIGGER "lottery_product_version_links_immutable"',
        );
      });
    } finally {
      await prisma.$disconnect();
    }
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

    await expect(prisma.lotteryProductVersionBetType.deleteMany({ where: { productVersionId } })).rejects.toThrow("Published Lottery configuration links are immutable");
    await expect(prisma.lotteryProductVersionBetType.updateMany({ where: { productVersionId }, data: { betTypeVersionId } })).rejects.toThrow("Published Lottery configuration links are immutable");

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

    const outcomes = await Promise.allSettled([1, 2].map(() => configuration.submit({
      kind: "BET_TYPE", id: version.id, expectedRevision: 1, actor,
    })));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
    expect(await prisma.lotteryBetTypeVersion.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ state: "REVIEW", version: 1, revision: 2 });
    await expect(
      configuration.submit({ kind: "BET_TYPE", id: version.id, expectedRevision: 1, actor }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("reads versioned Bet Type resources with state filtering and cursor pagination", async () => {
    const actor = { adminId, sessionId, role: "ADMIN" as const };
    const betType = await configuration.createBetType({
      code: `READ_${adminId.slice(0, 8)}`,
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
      effectiveFrom: new Date("2399-01-01T00:00:00.000Z"),
      actor,
    });
    betTypeVersionIds.push(version.id);
    const reviewBetType = await configuration.createBetType({
      code: `READ_REVIEW_${adminId.slice(0, 8)}`,
      actor,
    });
    betTypeIds.push(reviewBetType.id);
    const reviewVersion = await configuration.createBetTypeVersion({
      betTypeId: reviewBetType.id,
      version: 1,
      canonicalNumberFormat: "00",
      validationPattern: "^\\d{2}$",
      defaultPayout: { kind: "FIXED", amountMinor: 9000 },
      minStakeMinor: 100n,
      maxStakeMinor: 100000n,
      limitPolicyRef: "limit-v1",
      restrictionPolicyRef: "restriction-v1",
      settlementRuleVersionRef: "settlement-v1",
      effectiveFrom: new Date("2399-01-01T00:00:00.000Z"),
      actor,
    });
    betTypeVersionIds.push(reviewVersion.id);
    await configuration.submit({
      kind: "BET_TYPE",
      id: reviewVersion.id,
      expectedRevision: 1,
      actor,
    });

    const detail = await configuration.getBetType(betType.id, "DRAFT");
    expect(detail).toMatchObject({
      id: betType.id,
      code: betType.code,
      versions: [
        expect.objectContaining({ id: version.id, state: "DRAFT", minStakeMinor: "100" }),
      ],
    });

    expect(await configuration.getBetType(reviewBetType.id, "DRAFT")).toMatchObject({
      id: reviewBetType.id,
      versions: [],
    });
    expect(await configuration.getBetType(reviewBetType.id, "REVIEW")).toMatchObject({
      versions: [expect.objectContaining({ id: reviewVersion.id, state: "REVIEW" })],
    });

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const page = await configuration.listBetTypes({ limit: 1, state: "DRAFT", cursor });
      expect(page.items).toHaveLength(1);
      const item = page.items[0] as { id: string; versions: { id: string; state: string }[] };
      expect(seen.has(item.id)).toBe(false);
      if (cursor) expect(item.id > cursor).toBe(true);
      seen.add(item.id);
      expect(item.versions.every((entry) => entry.state === "DRAFT")).toBe(true);
      if (item.id === betType.id) {
        expect(item.versions).toEqual([expect.objectContaining({ id: version.id, state: "DRAFT" })]);
      }
      if (item.id === reviewBetType.id) expect(item.versions).toEqual([]);
      if (page.nextCursor !== null) expect(page.nextCursor).toBe(item.id);
      cursor = page.nextCursor ?? undefined;
      pageCount += 1;
    } while (cursor);
    expect(pageCount).toBeGreaterThanOrEqual(2);
    expect(seen.has(betType.id)).toBe(true);
    expect(seen.has(reviewBetType.id)).toBe(true);
  });
});

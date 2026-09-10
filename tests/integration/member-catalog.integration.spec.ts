import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemberCatalogController } from "../../apps/api/src/member-catalog.controller";
import { LotteryConfigurationService } from "../../src/contexts/lottery/application/lottery-configuration.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import type { MemberAuthenticatedRequest } from "../../apps/api/src/member-auth.guard";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

/**
 * Member catalog discovery boundary. Seeded directly so the suite exercises the
 * PUBLISHED-only projection deterministically, independent of the governed
 * create/submit/approve command flow (covered by the lottery configuration
 * suites).
 *
 * Namespace: every seeded bet-type code is prefixed so cleanup can sweep rows
 * left behind by an interrupted earlier run on the shared dev database.
 */
const codePrefix = "catalog-it";

describe.runIf(runIntegration)("Member catalog discovery integration", () => {
  let prisma: PrismaService;
  let controller: MemberCatalogController;

  const productIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeIds: string[] = [];
  const betTypeVersionIds: string[] = [];

  // Request is only read for correlation/actor context, never for auth in a
  // direct controller call (the guard is a separate, contract-tested concern).
  const request = {} as MemberAuthenticatedRequest;

  async function seed(input: {
    productState?: "DRAFT" | "REVIEW" | "PUBLISHED";
    betTypeState?: "DRAFT" | "REVIEW" | "PUBLISHED";
  }): Promise<{
    productId: string;
    productVersionId: string;
    betTypeId: string;
    betTypeVersionId: string;
  }> {
    const productId = randomUUID();
    const betTypeId = randomUUID();
    const betTypeVersionId = randomUUID();
    const productVersionId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const effectiveFrom = new Date("2020-01-01T00:00:00.000Z");

    // Published lottery configuration carries an immutability trigger. Fixture
    // construction is not a governed publication, so the trigger is bypassed for
    // the insert exactly as the other configuration suites do.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.lotteryProduct.create({ data: { id: productId } });
      await tx.lotteryBetType.create({
        data: { id: betTypeId, code: `${codePrefix}_${suffix}` },
      });
      await tx.lotteryBetTypeVersion.create({
        data: {
          id: betTypeVersionId,
          betTypeId,
          state: input.betTypeState ?? "PUBLISHED",
          canonicalNumberFormat: "00",
          validationPattern: "^[0-9]{2}$",
          defaultPayout: { kind: "FIXED", amountMinor: 9000 },
          minStakeMinor: 100n,
          maxStakeMinor: 100000n,
          limitPolicyRef: "limit-v1",
          restrictionPolicyRef: "restriction-v1",
          settlementRuleVersionRef: "settlement-v1",
          effectiveFrom,
        },
      });
      await tx.lotteryProductVersion.create({
        data: {
          id: productVersionId,
          productId,
          state: input.productState ?? "PUBLISHED",
          timezone: "Asia/Bangkok",
          scheduleTemplateRef: "schedule-v1",
          resultSchemaVersionRef: "result-schema-v1",
          settlementRuleVersionRef: "settlement-v1",
          defaultPayoutPolicyRef: "payout-v1",
          defaultLimitPolicyRef: "limit-v1",
          defaultRestrictionPolicyRef: "restriction-v1",
          effectiveFrom,
        },
      });
      await tx.lotteryProductVersionBetType.create({
        data: { productVersionId, betTypeId, betTypeVersionId },
      });
    });

    productIds.push(productId);
    betTypeIds.push(betTypeId);
    betTypeVersionIds.push(betTypeVersionId);
    productVersionIds.push(productVersionId);
    return { productId, productVersionId, betTypeId, betTypeVersionId };
  }

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    controller = new MemberCatalogController(
      new LotteryConfigurationService(prisma),
    );
  });

  afterAll(async () => {
    // Sweep this namespace, including rows from an interrupted earlier run.
    const betTypes = await prisma.lotteryBetType.findMany({
      where: { code: { startsWith: codePrefix } },
      select: { id: true, versions: { select: { id: true } } },
    });
    const ids = new Set([...betTypeIds, ...betTypes.map((row) => row.id)]);
    const versionIds = new Set([
      ...betTypeVersionIds,
      ...betTypes.flatMap((row) => row.versions.map((v) => v.id)),
    ]);
    const products = await prisma.lotteryProduct.findMany({
      where: { versions: { some: { scheduleTemplateRef: "schedule-v1", timezone: "Asia/Bangkok" } } },
      select: { id: true, versions: { select: { id: true } } },
    });
    const pIds = new Set([...productIds, ...products.map((row) => row.id)]);
    const pVersionIds = new Set([
      ...productVersionIds,
      ...products.flatMap((row) => row.versions.map((v) => v.id)),
    ]);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.lotteryProductVersionBetType.deleteMany({
        where: {
          OR: [
            { productVersionId: { in: [...pVersionIds] } },
            { betTypeVersionId: { in: [...versionIds] } },
          ],
        },
      });
      await tx.lotteryProductVersion.deleteMany({
        where: { id: { in: [...pVersionIds] } },
      });
      await tx.lotteryProduct.deleteMany({ where: { id: { in: [...pIds] } } });
      await tx.lotteryBetTypeVersion.deleteMany({
        where: { id: { in: [...versionIds] } },
      });
      await tx.lotteryBetType.deleteMany({ where: { id: { in: [...ids] } } });
    });
    await prisma.$disconnect();
  });

  it("lists a published Product for the Member with its published version", async () => {
    const seeded = await seed({});
    const page = await controller.listProducts(request, undefined, undefined);
    const found = page.items.find((item) => item.id === seeded.productId);
    expect(found).toBeDefined();
    expect(found!.versions.map((v) => v.state)).toEqual(["PUBLISHED"]);
    expect(found!.versions[0]!.id).toBe(seeded.productVersionId);
    // Date fields are serialised as ISO strings, never Date objects.
    expect(typeof found!.versions[0]!.effectiveFrom).toBe("string");
  });

  it("hides a Product that has no PUBLISHED version (not yet available)", async () => {
    const seeded = await seed({ productState: "DRAFT", betTypeState: "DRAFT" });
    const page = await controller.listProducts(request, "100", undefined);
    expect(page.items.some((item) => item.id === seeded.productId)).toBe(false);
  });

  it("never exposes a DRAFT/REVIEW product version to a Member", async () => {
    const seeded = await seed({ productState: "DRAFT" });
    // The product is hidden entirely; and were it listed, no non-PUBLISHED
    // version may ever be present.
    const page = await controller.listProducts(request, "100", undefined);
    const found = page.items.find((item) => item.id === seeded.productId);
    expect(found).toBeUndefined();
    for (const item of page.items) {
      for (const version of item.versions) expect(version.state).toBe("PUBLISHED");
    }
  });

  it("returns Product detail with enabled Bet Types resolved from published config", async () => {
    const seeded = await seed({});
    const detail = await controller.getProduct(request, seeded.productId);
    expect(detail.id).toBe(seeded.productId);
    const version = detail.versions.find((v) => v.id === seeded.productVersionId);
    expect(version).toBeDefined();
    expect(version!.state).toBe("PUBLISHED");
    expect(version!.timezone).toBe("Asia/Bangkok");
    const link = version!.enabledBetTypes.find(
      (l) => l.betTypeId === seeded.betTypeId,
    );
    expect(link).toBeDefined();
    expect(link!.betTypeVersionId).toBe(seeded.betTypeVersionId);
    expect(link!.betTypeVersionState).toBe("PUBLISHED");
  });

  it("lists Bet Types for the Member with PUBLISHED versions only", async () => {
    const seeded = await seed({});
    const page = await controller.listBetTypes(request, "100", undefined);
    const found = page.items.find((item) => item.id === seeded.betTypeId);
    expect(found).toBeDefined();
    expect(found!.versions.map((v) => v.state)).toEqual(["PUBLISHED"]);
  });

  it("returns Bet Type detail with stake bounds as integer minor-unit strings", async () => {
    const seeded = await seed({});
    const detail = await controller.getBetType(request, seeded.betTypeId);
    expect(detail.id).toBe(seeded.betTypeId);
    const version = detail.versions.find((v) => v.id === seeded.betTypeVersionId);
    expect(version).toBeDefined();
    expect(version!.minStakeMinor).toBe("100");
    expect(version!.maxStakeMinor).toBe("100000");
    expect(version!.defaultPayout).toMatchObject({ kind: "FIXED" });
  });

  it("reports a missing Product/Bet Type as a canonical not-found code", async () => {
    await expect(controller.getProduct(request, randomUUID())).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PRODUCT_NOT_FOUND" }),
    });
    await expect(controller.getBetType(request, randomUUID())).rejects.toMatchObject({
      response: expect.objectContaining({ code: "BET_TYPE_NOT_FOUND" }),
    });
  });

  it("rejects an out-of-range limit with a canonical validation code", async () => {
    await expect(controller.listProducts(request, "0", undefined)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    });
    await expect(controller.listProducts(request, "101", undefined)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    });
  });

  it("pages deterministically with a stable cursor", async () => {
    const first = await controller.listProducts(request, "1", undefined);
    expect(first.items.length).toBeLessThanOrEqual(1);
    if (first.nextCursor) {
      const second = await controller.listProducts(request, "1", first.nextCursor);
      // A cursor never re-emits an item from the previous page.
      const firstIds = new Set(first.items.map((item) => item.id));
      for (const item of second.items) expect(firstIds.has(item.id)).toBe(false);
    }
  });
});

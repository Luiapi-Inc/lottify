import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import {
  DrawRuleError,
  LotteryDrawService,
} from "../../src/contexts/lottery/application/lottery-draw.service";
import type { ScheduleOccurrence } from "../../src/contexts/lottery/domain/schedule-occurrence";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Lottery Draw persistence and discovery", () => {
  let prisma: PrismaService;
  let draws: LotteryDrawService;
  let adminId: string;
  let sessionId: string;
  const productIds: string[] = [];
  const betTypeIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeVersionIds: string[] = [];
  const drawIds: string[] = [];
  const overrideIds: string[] = [];

  const actor = () => ({ adminId, sessionId, role: "ADMIN" as const });

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    draws = new LotteryDrawService(prisma);
    adminId = randomUUID();
    sessionId = randomUUID();
    await prisma.adminUser.create({
      data: {
        id: adminId,
        email: `draw-admin-${adminId}@example.test`,
        name: "Draw Test Admin",
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    await prisma.adminAuthSession.create({
      data: {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: `draw-refresh-${sessionId}`,
        familyId: randomUUID(),
        expiresAt: new Date("2199-01-01T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" DISABLE TRIGGER "lottery_product_version_links_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" DISABLE TRIGGER "lottery_product_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" DISABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
        await tx.lotteryDrawOverride.deleteMany({ where: { drawId: { in: drawIds } } });
        await tx.lotteryDrawBetType.deleteMany({ where: { drawId: { in: drawIds } } });
        await tx.lotteryDraw.deleteMany({ where: { id: { in: drawIds } } });
        await tx.lotteryProductVersionBetType.deleteMany({ where: { productVersionId: { in: productVersionIds } } });
        await tx.lotteryProductVersion.deleteMany({ where: { id: { in: productVersionIds } } });
        await tx.lotteryBetTypeVersion.deleteMany({ where: { id: { in: betTypeVersionIds } } });
        await tx.lotteryProduct.deleteMany({ where: { id: { in: productIds } } });
        await tx.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
        await tx.adminAuthSession.deleteMany({ where: { id: sessionId } });
        await tx.adminUser.deleteMany({ where: { id: adminId } });
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" ENABLE TRIGGER "lottery_product_version_links_immutable"');
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function publishedProductFixture(prefix: string): Promise<{
    productId: string;
    productVersionId: string;
    betTypeId: string;
    betTypeVersionId: string;
  }> {
    const suffix = randomUUID();
    const productId = randomUUID();
    const betTypeId = randomUUID();
    const productVersionId = randomUUID();
    const betTypeVersionId = randomUUID();
    productIds.push(productId);
    betTypeIds.push(betTypeId);
    productVersionIds.push(productVersionId);
    betTypeVersionIds.push(betTypeVersionId);
    await prisma.lotteryProduct.create({ data: { id: productId } });
    await prisma.lotteryBetType.create({
      data: { id: betTypeId, code: `${prefix}_${suffix.slice(0, 8)}` },
    });
    await prisma.lotteryBetTypeVersion.create({
      data: {
        id: betTypeVersionId,
        betTypeId,
        state: "PUBLISHED",
        canonicalNumberFormat: "00",
        validationPattern: "^[0-9]{2}$",
        defaultPayout: { kind: "FIXED", amountMinor: 9000 },
        minStakeMinor: 100n,
        maxStakeMinor: 100000n,
        limitPolicyRef: "limit-v1",
        restrictionPolicyRef: "restriction-v1",
        settlementRuleVersionRef: "settlement-v1",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
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
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await prisma.lotteryProductVersionBetType.create({
      data: { productVersionId, betTypeId, betTypeVersionId },
    });
    await prisma.lotteryProductVersion.update({
      where: { id: productVersionId },
      data: { state: "PUBLISHED" },
    });
    return { productId, productVersionId, betTypeId, betTypeVersionId };
  }

  function occurrence(productId: string, day: string, provenance: ScheduleOccurrence["provenance"] = "SCHEDULE_GENERATED"): ScheduleOccurrence {
    return {
      occurrenceIdentity: `${productId}-${day}`,
      localDate: day,
      openAt: new Date(`${day}T06:00:00.000Z`),
      cutoffAt: new Date(`${day}T11:00:00.000Z`),
      drawAt: new Date(`${day}T12:00:00.000Z`),
      provenance,
    };
  }

  it("persists a Draw with a snapshotted Bet Type and exposes discovery detail", async () => {
    const { productId, productVersionId, betTypeId, betTypeVersionId } =
      await publishedProductFixture("DRAW_HAPPY");
    const day = "2099-01-05";
    const result = await draws.generateDraws({
      productId,
      baseOccurrences: [occurrence(productId, day)],
      actor: actor(),
    });
    expect(result.created).toHaveLength(1);
    expect(result.skippedOccurrenceIdentities).toEqual([]);
    const summary = result.created[0]!;
    drawIds.push(summary.id);

    const detail = await draws.getDraw(summary.id);
    expect(detail).toMatchObject({
      id: summary.id,
      productId,
      productVersionId,
      state: "DRAFT",
      version: 1,
      localDate: day,
      cutoff: { cutoffAt: new Date(`${day}T11:00:00.000Z`) },
      timezone: "Asia/Bangkok",
      scheduleTemplateRef: "schedule-v1",
      resultSchemaVersionRef: "result-v1",
      settlementRuleVersionRef: "settlement-v1",
      defaultPayoutPolicyRef: "payout-v1",
      defaultLimitPolicyRef: "limit-v1",
      defaultRestrictionPolicyRef: "restriction-v1",
    });
    expect(detail.serverNow.getTime()).toBeGreaterThan(0);
    expect(detail.allowedActions).toContain("SCHEDULE");
    expect(detail.betTypes).toHaveLength(1);
    expect(detail.betTypes[0]).toMatchObject({
      betTypeId,
      betTypeVersionId,
      betTypeCode: expect.any(String),
      canonicalNumberFormat: "00",
      minStakeMinor: "100",
      maxStakeMinor: "100000",
      payout: { kind: "FIXED", amountMinor: 9000 },
      settlementRuleVersionRef: "settlement-v1",
    });

    const listed = await draws.listDraws({ productId });
    expect(listed.items.some((item) => item.id === summary.id)).toBe(true);
    expect(listed.nextCursor).toBeNull();
  });

  it("rejects illegal and skipped lifecycle transitions deterministically", async () => {
    const { productId } = await publishedProductFixture("DRAW_TRANS");
    const day = "2099-02-05";
    const summary = (await draws.generateDraws({ productId, baseOccurrences: [occurrence(productId, day)] })).created[0]!;
    drawIds.push(summary.id);

    const scheduled = await draws.transition({
      id: summary.id,
      command: "SCHEDULE",
      expectedVersion: 1,
      actor: actor(),
    });
    expect(scheduled.state).toBe("SCHEDULED");

    const opened = await draws.transition({
      id: summary.id,
      command: "OPEN",
      expectedVersion: 2,
      actor: actor(),
    });
    expect(opened.state).toBe("OPEN");

    // Skipped transition: CLOSE is not allowed directly from OPEN? It is; but
    // MARK_RESULT_PENDING from OPEN is illegal (requires CLOSED first).
    await expect(
      draws.transition({ id: summary.id, command: "MARK_RESULT_PENDING", expectedVersion: 3, actor: actor() }),
    ).rejects.toMatchObject({ code: "ILLEGAL_DRAW_TRANSITION" });

    // Stale version must conflict regardless of command legality.
    await expect(
      draws.transition({ id: summary.id, command: "CLOSE", expectedVersion: 2, actor: actor() }),
    ).rejects.toMatchObject({ code: "DRAW_VERSION_CONFLICT" });

    const closed = await draws.transition({
      id: summary.id,
      command: "CLOSE",
      expectedVersion: 3,
      actor: actor(),
    });
    expect(closed.state).toBe("CLOSED");

    // Terminal guard: settle the full chain then reject further transitions.
    const pending = await draws.transition({ id: summary.id, command: "MARK_RESULT_PENDING", expectedVersion: 4, actor: actor() });
    expect(pending.state).toBe("RESULT_PENDING");
    const confirmed = await draws.transition({ id: summary.id, command: "CONFIRM_RESULT", expectedVersion: 5, actor: actor() });
    expect(confirmed.state).toBe("RESULT_CONFIRMED");
    const settling = await draws.transition({ id: summary.id, command: "START_SETTLEMENT", expectedVersion: 6, actor: actor() });
    expect(settling.state).toBe("SETTLING");
    const settled = await draws.transition({ id: summary.id, command: "COMPLETE_SETTLEMENT", expectedVersion: 7, actor: actor() });
    expect(settled.state).toBe("SETTLED");
    await expect(
      draws.transition({ id: summary.id, command: "OPEN", expectedVersion: 8, actor: actor() }),
    ).rejects.toMatchObject({ code: "ILLEGAL_DRAW_TRANSITION" });
  });

  it("enforces optimistic concurrency: only one of two concurrent transitions wins", async () => {
    const { productId } = await publishedProductFixture("DRAW_RACE");
    const day = "2099-03-05";
    const summary = (await draws.generateDraws({ productId, baseOccurrences: [occurrence(productId, day)] })).created[0]!;
    drawIds.push(summary.id);

    const outcomes = await Promise.allSettled([1, 2].map(() =>
      draws.transition({ id: summary.id, command: "SCHEDULE", expectedVersion: 1, actor: actor() }),
    ));
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "DRAW_VERSION_CONFLICT" },
    });
    const stored = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: summary.id } });
    expect(stored.state).toBe("SCHEDULED");
    expect(stored.version).toBe(2);
  });

  it("enforces one canonical cutoff: strictly-before eligible, exact/beyond rejected", async () => {
    const { productId } = await publishedProductFixture("DRAW_CUTOFF");
    const day = "2099-04-05";
    const summary = (await draws.generateDraws({ productId, baseOccurrences: [occurrence(productId, day)] })).created[0]!;
    drawIds.push(summary.id);
    await draws.transition({ id: summary.id, command: "SCHEDULE", expectedVersion: 1, actor: actor() });
    await draws.transition({ id: summary.id, command: "OPEN", expectedVersion: 2, actor: actor() });

    const cutoffAt = new Date(`${day}T11:00:00.000Z`);
    const before = new Date(cutoffAt.getTime() - 1);
    const exact = new Date(cutoffAt.getTime());
    const after = new Date(cutoffAt.getTime() + 1);

    // Pure cutoff eligibility reusing draw-cutoff.
    expect(await draws.checkCutoffEligibility({ id: summary.id, serverNow: before })).toMatchObject({
      eligible: true,
      cutoffAt,
    });
    expect((await draws.checkCutoffEligibility({ id: summary.id, serverNow: exact })).eligible).toBe(false);
    expect((await draws.checkCutoffEligibility({ id: summary.id, serverNow: after })).eligible).toBe(false);

    // Betting gate for #33: OPEN + before cutoff passes; exact/beyond rejects.
    await expect(draws.assertDrawOpenForBets(summary.id, before)).resolves.toMatchObject({ state: "OPEN" });
    await expect(draws.assertDrawOpenForBets(summary.id, exact)).rejects.toMatchObject({ code: "DRAW_CUTOFF_REACHED" });
    await expect(draws.assertDrawOpenForBets(summary.id, after)).rejects.toMatchObject({ code: "DRAW_CUTOFF_REACHED" });

    // A non-OPEN Draw is rejected regardless of cutoff.
    await draws.transition({ id: summary.id, command: "CLOSE", expectedVersion: 3, actor: actor() });
    await expect(draws.assertDrawOpenForBets(summary.id, before)).rejects.toMatchObject({ code: "DRAW_NOT_OPEN" });
  });

  it("is idempotent: re-running generation creates no duplicates", async () => {
    const { productId } = await publishedProductFixture("DRAW_IDEM");
    const days = ["2099-05-05", "2099-05-06"];
    const first = await draws.generateDraws({
      productId,
      baseOccurrences: days.map((day) => occurrence(productId, day)),
    });
    expect(first.created).toHaveLength(2);
    first.created.forEach((created) => drawIds.push(created.id));

    // Same base occurrences again -> nothing new, all preserved.
    const second = await draws.generateDraws({
      productId,
      baseOccurrences: days.map((day) => occurrence(productId, day)),
    });
    expect(second.created).toHaveLength(0);
    expect(second.preservedOccurrenceIdentities).toHaveLength(2);

    // Extending the horizon creates only the new occurrence.
    const third = await draws.generateDraws({
      productId,
      baseOccurrences: [...days, "2099-05-07"].map((day) => occurrence(productId, day)),
    });
    expect(third.created).toHaveLength(1);
    expect(third.created[0]!.localDate).toBe("2099-05-07");
    third.created.forEach((created) => drawIds.push(created.id));

    const all = await prisma.lotteryDraw.count({ where: { productId } });
    expect(all).toBe(3);
  });

  it("persists a governed versioned Draw Override and bumps the override revision", async () => {
    const { productId } = await publishedProductFixture("DRAW_OVR");
    const day = "2099-06-05";
    const summary = (await draws.generateDraws({ productId, baseOccurrences: [occurrence(productId, day)] })).created[0]!;
    drawIds.push(summary.id);
    await draws.transition({ id: summary.id, command: "SCHEDULE", expectedVersion: 1, actor: actor() });
    await draws.transition({ id: summary.id, command: "OPEN", expectedVersion: 2, actor: actor() });

    const newCutoff = new Date(`${day}T10:30:00.000Z`);
    const applied = await draws.applyDrawOverride({
      drawId: summary.id,
      reason: "Operational cutoff adjustment",
      actor: actor(),
      changes: { cutoffAt: newCutoff } as never,
      approvalEvidenceRef: `approval-${randomUUID()}`,
      auditEvidenceRef: `audit-${randomUUID()}`,
    });
    overrideIds.push(applied.overrideId);

    const override = await prisma.lotteryDrawOverride.findUniqueOrThrow({ where: { id: applied.overrideId } });
    expect(override).toMatchObject({
      status: "PUBLISHED",
      reason: "Operational cutoff adjustment",
      approvalEvidenceRef: expect.stringContaining("approval-"),
    });
    const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: summary.id } });
    expect(draw.overrideRevisionRef).toBe(applied.overrideRevisionRef);
    // version 1 (create) -> 2 (SCHEDULE) -> 3 (OPEN) -> 4 (override)
    expect(draw.version).toBe(4);
  });

  it("returns no fabricated values: unknown Draw is a 404-style not found", async () => {
    const missing = randomUUID();
    await expect(draws.getDraw(missing)).rejects.toBeInstanceOf(Error);
    await expect(draws.getDraw(missing)).rejects.toMatchObject({ response: { statusCode: 404 } });
    await expect(draws.checkCutoffEligibility({ id: missing })).rejects.toMatchObject({ response: { statusCode: 404 } });
  });

  it("rejects generation when no PUBLISHED Product version is effective", async () => {
    const { productId, productVersionId } = await publishedProductFixture("DRAW_NOPUB");
    // Keep only a DRAFT product version effective: publish state is immutable, so
    // create a second DRAFT version with a future-effective window and delete the
    // published one's effective window is not possible; instead rely on the rule
    // that a fresh product with no published version throws.
    const freshProductId = randomUUID();
    productIds.push(freshProductId);
    await prisma.lotteryProduct.create({ data: { id: freshProductId } });
    await expect(
      draws.generateDraws({ productId: freshProductId, baseOccurrences: [occurrence(freshProductId, "2099-07-05")] }),
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_PUBLISHED" });
    expect(productVersionId).toBeTruthy();
  });

  it("accepts a DrawRuleError contract with stable code", () => {
    const error = new DrawRuleError("ILLEGAL_DRAW_TRANSITION", "no", 409, {});
    expect(error.code).toBe("ILLEGAL_DRAW_TRANSITION");
    expect(error.status).toBe(409);
  });
});

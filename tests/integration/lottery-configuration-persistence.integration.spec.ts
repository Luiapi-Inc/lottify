import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
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
  const makerId = randomUUID();
  const productIds: string[] = [];
  const betTypeIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeVersionIds: string[] = [];
  const commandScopes: string[] = [];
  const commandReauthId = randomUUID();

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
    await prisma.adminUser.create({ data: {
      id: makerId, email: `lottery-maker-${makerId}@example.test`,
      name: "Lottery Maker Test", passwordHash: "test-hash", role: "ADMIN",
    } });
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
        await tx.idempotencyRecord.deleteMany({ where: { scope: { in: commandScopes } } });
        await tx.$executeRawUnsafe('ALTER TABLE "admin_approval_evidence" DISABLE TRIGGER "admin_approval_evidence_immutable"');
        await tx.adminApprovalEvidence.deleteMany({ where: { approverAdminId: adminId } });
        await tx.$executeRawUnsafe('ALTER TABLE "admin_approval_evidence" ENABLE TRIGGER "admin_approval_evidence_immutable"');
        await tx.adminReauthEvidence.deleteMany({ where: { adminUserId: adminId } });
        await tx.adminUser.deleteMany({ where: { id: makerId } });
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

  async function raceFixture(publishBetType = true) {
    const productId = randomUUID();
    const betTypeId = randomUUID();
    const productVersionId = randomUUID();
    const betTypeVersionId = randomUUID();
    productIds.push(productId);
    betTypeIds.push(betTypeId);
    productVersionIds.push(productVersionId);
    betTypeVersionIds.push(betTypeVersionId);
    await prisma.lotteryProduct.create({ data: { id: productId } });
    await prisma.lotteryBetType.create({ data: { id: betTypeId, code: `RACE_${betTypeId}` } });
    await prisma.lotteryBetTypeVersion.create({ data: {
      id: betTypeVersionId, betTypeId, state: "DRAFT", canonicalNumberFormat: "00",
      validationPattern: "^[0-9]{2}$", defaultPayout: { kind: "FIXED", amountMinor: 9000 },
      minStakeMinor: 100n, maxStakeMinor: 100000n, limitPolicyRef: "limit-v1",
      restrictionPolicyRef: "restriction-v1", settlementRuleVersionRef: "settlement-v1",
      effectiveFrom: new Date("2099-01-01T00:00:00Z"),
    } });
    await prisma.lotteryProductVersion.create({ data: {
      id: productVersionId, productId, state: "DRAFT", timezone: "Asia/Bangkok", scheduleTemplateRef: "schedule-v1",
      resultSchemaVersionRef: "result-v1", settlementRuleVersionRef: "settlement-v1",
      defaultPayoutPolicyRef: "payout-v1", defaultLimitPolicyRef: "limit-v1",
      defaultRestrictionPolicyRef: "restriction-v1", effectiveFrom: new Date("2099-01-01T00:00:00Z"),
    } });
    if (publishBetType) {
      await prisma.lotteryBetTypeVersion.update({ where: { id: betTypeVersionId }, data: { state: "REVIEW" } });
      await prisma.lotteryBetTypeVersion.update({ where: { id: betTypeVersionId }, data: { state: "PUBLISHED" } });
    }
    return { productVersionId, betTypeId, betTypeVersionId };
  }

  // Observe PostgreSQL's actual wait graph before releasing the first transaction.
  // A timer only bounds failure; it never establishes which operation won the race.
  async function waitForBlockedBy(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
      if (rows[0]?.blocked) return;
      await delay(10);
    }
    throw new Error(`No transaction was observed blocked by backend ${pid}`);
  }

  it.each(["INSERT", "UPDATE", "DELETE"] as const)(
    "rejects a waiting %s link mutation after publication commits",
    async (operation) => {
      const link = await raceFixture();
      if (operation !== "INSERT") await prisma.lotteryProductVersionBetType.create({ data: link });
      await prisma.lotteryProductVersion.update({ where: { id: link.productVersionId }, data: { state: "REVIEW" } });
      let mutation!: Promise<PromiseSettledResult<unknown>[]>;
      const mutate = async (tx: Prisma.TransactionClient): Promise<unknown> => operation === "INSERT"
        ? tx.lotteryProductVersionBetType.create({ data: link })
        : operation === "DELETE"
          ? tx.lotteryProductVersionBetType.deleteMany({ where: { productVersionId: link.productVersionId } })
          : tx.lotteryProductVersionBetType.updateMany({ where: { productVersionId: link.productVersionId }, data: { betTypeVersionId: link.betTypeVersionId } });
      try {
        await prisma.$transaction(async tx => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          await tx.lotteryProductVersion.update({ where: { id: link.productVersionId }, data: { state: "PUBLISHED" } });
          mutation = Promise.allSettled([prisma.$transaction(mutate)]);
          await waitForBlockedBy(backend!.pid);
        });
        const [outcome] = await mutation;
        expect(outcome).toMatchObject({ status: "rejected" });
        if (outcome?.status === "rejected") expect(String(outcome.reason)).toContain("Published Lottery configuration links are immutable");
        expect(await prisma.lotteryProductVersionBetType.count({ where: { productVersionId: link.productVersionId } })).toBe(operation === "INSERT" ? 0 : 1);
        expect(await prisma.lotteryProductVersion.findUniqueOrThrow({ where: { id: link.productVersionId } })).toMatchObject({ state: "PUBLISHED" });
      } finally {
        if (mutation) await mutation;
      }
    },
  );

  it("publication waits for an earlier draft link deletion and retains the committed link set", async () => {
    const link = await raceFixture();
    await prisma.lotteryProductVersionBetType.create({ data: link });
    await prisma.lotteryProductVersion.update({ where: { id: link.productVersionId }, data: { state: "REVIEW" } });
    let publication!: Promise<PromiseSettledResult<unknown>[]>;
    try {
      await prisma.$transaction(async tx => {
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        expect(await tx.lotteryProductVersionBetType.deleteMany({ where: { productVersionId: link.productVersionId } })).toEqual({ count: 1 });
        publication = Promise.allSettled([prisma.lotteryProductVersion.update({ where: { id: link.productVersionId }, data: { state: "PUBLISHED" } })]);
        await waitForBlockedBy(backend!.pid);
      });
      expect(await publication).toMatchObject([{ status: "fulfilled", value: { state: "PUBLISHED" } }]);
      expect(await prisma.lotteryProductVersionBetType.count({ where: { productVersionId: link.productVersionId } })).toBe(0);
    } finally {
      if (publication) await publication;
    }
  });

  async function publicationCommand(productVersionId: string) {
    await prisma.lotteryProductVersion.update({ where: { id: productVersionId }, data: { createdByAdminId: makerId } });
    const actor = { adminId, sessionId, role: "ADMIN" as const };
    await configuration.submit({ kind: "PRODUCT", id: productVersionId, expectedRevision: 1, actor });
    // One action-scoped evidence record per session, shared by these fixtures.
    const reauth = await prisma.adminReauthEvidence.upsert({
      where: { id: commandReauthId },
      update: {}, create: { id: commandReauthId, adminUserId: adminId, sessionId, actionClass: "lottery-configuration.publish",
        verifiedAt: new Date(), expiresAt: new Date("2199-01-01T00:00:00Z") },
    });
    const scope = `admin:${adminId}:lottery:PRODUCT:${productVersionId}:approve`;
    commandScopes.push(scope);
    const command = { scope, key: randomUUID(), fingerprint: randomUUID(), responseCode: 200 };
    const publish = (service = configuration) => service.executeCommand(command, () => service.approveAndPublish({
      kind: "PRODUCT", id: productVersionId, expectedRevision: 2, actor,
      reauthEvidenceId: reauth.id, correlationId: `race:${productVersionId}`,
    }));
    const verify = async (result: unknown) => {
      expect(await prisma.lotteryProductVersion.findUniqueOrThrow({ where: { id: productVersionId } })).toMatchObject({ state: "PUBLISHED", revision: 3 });
      const approvals = await prisma.adminApprovalEvidence.findMany({ where: { resourceId: productVersionId } });
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({ requesterAdminId: makerId, approverAdminId: adminId, requestedVersion: 2, reauthEvidenceId: reauth.id });
      const audits = await prisma.auditRecord.findMany({ where: { resourceId: productVersionId, action: "LOTTERY_PRODUCT_VERSION_PUBLISH" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ approvalId: approvals[0]!.id, reauthEvidenceId: reauth.id, outcome: "PUBLISHED" });
      const records = await prisma.idempotencyRecord.findMany({ where: { scope } });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ status: "COMPLETED", responseBody: result });
      expect(await publish()).toEqual(result);
      expect(await prisma.adminApprovalEvidence.findMany({ where: { resourceId: productVersionId } })).toEqual(approvals);
      expect(await prisma.auditRecord.findMany({ where: { resourceId: productVersionId, action: "LOTTERY_PRODUCT_VERSION_PUBLISH" } })).toEqual(audits);
    };
    return { publish, verify };
  }

  it.each(["INSERT", "UPDATE", "DELETE", "MOVE_IN", "MOVE_OUT"] as const)(
    "command publication commits before waiting %s and preserves both parent link sets", async operation => {
      const target = await raceFixture();
      const other = await raceFixture();
      const sourceParent = operation === "MOVE_IN" ? other.productVersionId : target.productVersionId;
      if (operation !== "INSERT") await prisma.lotteryProductVersionBetType.create({ data: { ...target, productVersionId: sourceParent } });
      const parentIds = [target.productVersionId, other.productVersionId];
      const links = () => prisma.lotteryProductVersionBetType.findMany({ where: { productVersionId: { in: parentIds } }, orderBy: [{ productVersionId: "asc" }, { betTypeId: "asc" }] });
      const original = await links();
      const command = await publicationCommand(target.productVersionId);
      let mutation: Promise<PromiseSettledResult<unknown>[]> | undefined;
      const mutate = async (tx: Prisma.TransactionClient): Promise<unknown> => {
        const where = { productVersionId: sourceParent, betTypeId: target.betTypeId };
        if (operation === "INSERT") return tx.lotteryProductVersionBetType.create({ data: target });
        if (operation === "DELETE") return tx.lotteryProductVersionBetType.deleteMany({ where });
        return tx.lotteryProductVersionBetType.updateMany({ where, data: operation === "UPDATE"
          ? { betTypeId: other.betTypeId, betTypeVersionId: other.betTypeVersionId }
          : { productVersionId: operation === "MOVE_IN" ? target.productVersionId : other.productVersionId } });
      };
      // Hold the real command's transaction after result persistence, before commit.
      const instrumented = new Proxy(prisma, { get(targetPrisma, property) {
        if (property === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          targetPrisma.$transaction(async tx => {
            const result = await work(tx);
            const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
            mutation = Promise.allSettled([prisma.$transaction(mutate)]);
            await waitForBlockedBy(backend!.pid);
            return result;
          });
        return Reflect.get(targetPrisma, property, targetPrisma);
      } });
      try {
        const result = await command.publish(new LotteryConfigurationService(instrumented));
        const [outcome] = await mutation!;
        expect(outcome).toMatchObject({ status: "rejected" });
        if (outcome?.status === "rejected") expect(String(outcome.reason)).toContain("Published Lottery configuration links are immutable");
        expect(await links()).toEqual(original);
        expect(await prisma.lotteryProductVersion.findUniqueOrThrow({ where: { id: other.productVersionId } })).toMatchObject({ state: "DRAFT", revision: 1 });
        await command.verify(result);
      } finally {
        if (mutation) await mutation;
      }
    },
  );

  it.each([
    ["SOURCE", "PUBLISHED"], ["DESTINATION", "PUBLISHED"],
    ["SOURCE", "DRAFT"], ["DESTINATION", "DRAFT"],
  ] as const)(
    "command publication of %s revalidates a moved %s Bet Type after waiting", async (publishedParent, betTypeState) => {
      const source = await raceFixture(betTypeState === "PUBLISHED");
      const destination = await raceFixture();
      await prisma.lotteryProductVersionBetType.create({ data: source });
      const targetId = publishedParent === "SOURCE" ? source.productVersionId : destination.productVersionId;
      const command = await publicationCommand(targetId);
      let publication: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await prisma.$transaction(async tx => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          expect(await tx.lotteryProductVersionBetType.updateMany({
            where: { productVersionId: source.productVersionId }, data: { productVersionId: destination.productVersionId },
          })).toEqual({ count: 1 });
          publication = Promise.allSettled([command.publish()]);
          await waitForBlockedBy(backend!.pid);
        });
        const [outcome] = await publication!;
        if (publishedParent === "DESTINATION" && betTypeState === "DRAFT") {
          expect(outcome).toMatchObject({ status: "rejected", reason: { code: "BET_TYPE_VERSION_NOT_PUBLISHED" } });
          await expect(command.publish()).rejects.toMatchObject({ code: "BET_TYPE_VERSION_NOT_PUBLISHED" });
          expect(await prisma.lotteryProductVersion.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ state: "REVIEW", revision: 2 });
          expect(await prisma.adminApprovalEvidence.count({ where: { resourceId: targetId } })).toBe(0);
          expect(await prisma.auditRecord.count({ where: { resourceId: targetId, action: "LOTTERY_PRODUCT_VERSION_PUBLISH" } })).toBe(0);
          expect(await prisma.idempotencyRecord.count({ where: { scope: `admin:${adminId}:lottery:PRODUCT:${targetId}:approve` } })).toBe(0);
        } else {
          expect(outcome).toMatchObject({ status: "fulfilled", value: { state: "PUBLISHED" } });
          if (outcome?.status !== "fulfilled") throw new Error("Expected publication after link update");
          await command.verify(outcome.value);
        }
        expect(await prisma.lotteryProductVersionBetType.count({ where: { productVersionId: source.productVersionId } })).toBe(0);
        const links = await prisma.lotteryProductVersionBetType.findMany({ where: { productVersionId: destination.productVersionId } });
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ betTypeId: source.betTypeId, betTypeVersionId: source.betTypeVersionId });
      } finally {
        if (publication) await publication;
      }
    },
  );

  it("concurrent approvals publish once with one linked approval and audit record", async () => {
    const link = await raceFixture();
    await prisma.lotteryProductVersionBetType.create({ data: link });
    await prisma.lotteryProductVersion.update({ where: { id: link.productVersionId }, data: { createdByAdminId: makerId } });
    const actor = { adminId, sessionId, role: "ADMIN" as const };
    await configuration.submit({ kind: "PRODUCT", id: link.productVersionId, expectedRevision: 1, actor });
    const reauth = await prisma.adminReauthEvidence.create({ data: {
      adminUserId: adminId, sessionId, actionClass: "LOTTERY_CONFIGURATION_PUBLISH",
      verifiedAt: new Date(), expiresAt: new Date("2199-01-01T00:00:00Z"),
    } });
    let approvals!: Promise<PromiseSettledResult<unknown>[]>;
    try {
      await prisma.$transaction(async tx => {
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT id FROM lottery_product_versions WHERE id = ${link.productVersionId}::uuid FOR UPDATE`;
        approvals = Promise.allSettled([1, 2].map(() => configuration.approveAndPublish({
          kind: "PRODUCT", id: link.productVersionId, expectedRevision: 2, actor,
          reauthEvidenceId: reauth.id, correlationId: randomUUID(),
        })));
        // Both commands must have reached the held row lock before it is released.
        const deadline = Date.now() + 3000;
        let waiting = 0;
        do {
          const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
            WITH RECURSIVE waiters(pid) AS (
              SELECT pid FROM pg_stat_activity WHERE ${backend!.pid}::int = ANY(pg_blocking_pids(pid))
              UNION
              SELECT activity.pid FROM pg_stat_activity activity
              JOIN waiters ON waiters.pid = ANY(pg_blocking_pids(activity.pid))
            ) SELECT count(*)::int AS count FROM waiters`;
          waiting = row!.count;
          if (waiting < 2) await delay(10);
        } while (waiting < 2 && Date.now() < deadline);
        expect(waiting).toBe(2);
      });
      const outcomes = await approvals;
      expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
      expect(await prisma.lotteryProductVersion.findUniqueOrThrow({ where: { id: link.productVersionId } })).toMatchObject({ state: "PUBLISHED", revision: 3 });
      const evidence = await prisma.adminApprovalEvidence.findMany({ where: { resourceId: link.productVersionId } });
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({ requesterAdminId: makerId, approverAdminId: adminId, requestedVersion: 2, reauthEvidenceId: reauth.id });
      const audits = await prisma.auditRecord.findMany({ where: { resourceId: link.productVersionId, action: "LOTTERY_PRODUCT_VERSION_PUBLISH" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ approvalId: evidence[0]!.id, outcome: "PUBLISHED", reauthEvidenceId: reauth.id });
    } finally {
      if (approvals) await approvals;
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

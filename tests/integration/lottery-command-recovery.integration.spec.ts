import { LotteryConfigurationService } from "../../src/contexts/lottery/application/lottery-configuration.service";
import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import type { ProcessCommand } from "./fixtures/lottery-command-process";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Lottery command process recovery (ADR 0004 / Ticket 16)", () => {
  let prisma: PrismaService;
  const adminId = randomUUID();
  const sessionId = randomUUID();
  const makerId = randomUUID();
  const makerSessionId = randomUUID();
  const reauthId = randomUUID();
  const betVersionIds: string[] = [];
  const productIds: string[] = [];
  const productVersionIds: string[] = [];
  const codes: string[] = [];
  const scopes: string[] = [];
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.adminUser.create({ data: {
      id: adminId, email: `lottery-recovery-${adminId}@example.test`,
      name: "Lottery recovery test", passwordHash: "test-hash", role: "ADMIN",
    } });
    await prisma.adminUser.create({ data: {
      id: makerId, email: `lottery-recovery-maker-${makerId}@example.test`,
      name: "Recovery maker", passwordHash: "test-hash", role: "ADMIN",
    } });
    await prisma.adminAuthSession.create({ data: {
      id: sessionId, adminUserId: adminId, refreshTokenHash: randomUUID(),
      familyId: randomUUID(), expiresAt: new Date("2199-01-01T00:00:00Z"),
    } });
    await prisma.adminAuthSession.create({ data: {
      id: makerSessionId, adminUserId: makerId, refreshTokenHash: randomUUID(),
      familyId: randomUUID(), expiresAt: new Date("2199-01-01T00:00:00Z"),
    } });
    await prisma.adminReauthEvidence.create({ data: {
      id: reauthId, adminUserId: adminId, sessionId, actionClass: "lottery-configuration.publish",
      verifiedAt: new Date(), expiresAt: new Date("2199-01-01T00:00:00Z"),
    } });
  });

  afterAll(async () => {
    try {
      await Promise.all(children.map(async child => {
        if (child.exitCode === null && child.signalCode === null) {
          const closed = waitForExit(child);
          child.kill("SIGKILL");
          await closed;
        }
      }));
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"');
        await tx.auditRecord.deleteMany({ where: { actorAdminId: { in: [adminId, makerId] } } });
        await tx.idempotencyRecord.deleteMany({ where: { scope: { in: scopes } } });
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" DISABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" DISABLE TRIGGER "lottery_product_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" DISABLE TRIGGER "lottery_product_version_links_immutable"');
        await tx.lotteryProductVersionBetType.deleteMany({ where: { productVersionId: { in: productVersionIds } } });
        await tx.lotteryProductVersion.deleteMany({ where: { id: { in: productVersionIds } } });
        await tx.lotteryProduct.deleteMany({ where: { id: { in: productIds } } });
        await tx.lotteryBetTypeVersion.deleteMany({ where: { id: { in: betVersionIds } } });
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" ENABLE TRIGGER "lottery_product_version_links_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "admin_approval_evidence" DISABLE TRIGGER "admin_approval_evidence_immutable"');
        await tx.adminApprovalEvidence.deleteMany({ where: { approverAdminId: adminId } });
        await tx.$executeRawUnsafe('ALTER TABLE "admin_approval_evidence" ENABLE TRIGGER "admin_approval_evidence_immutable"');
        await tx.adminReauthEvidence.deleteMany({ where: { id: reauthId } });
        await tx.lotteryBetType.deleteMany({ where: { code: { in: codes } } });
        await tx.adminAuthSession.deleteMany({ where: { id: { in: [sessionId, makerSessionId] } } });
        await tx.adminUser.deleteMany({ where: { id: { in: [adminId, makerId] } } });
        await tx.$executeRawUnsafe('ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"');
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  function start(input: ProcessCommand) {
    const child = fork(resolve("tests/integration/fixtures/lottery-command-process.ts"), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: process.env,
    });
    children.push(child);
    let stderr = "";
    child.stderr!.on("data", chunk => { stderr += String(chunk); });
    const message = new Promise<{ phase: string; backendPid?: number; resourceId?: string; result?: { id: string; code: string } }>((resolveMessage, reject) => {
      const timer = setTimeout(() => reject(new Error(`Child barrier timed out: ${stderr}`)), 8000);
      child.once("message", value => { clearTimeout(timer); resolveMessage(value as Awaited<typeof message>); });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`Child exited before barrier (${code}, ${signal}): ${stderr}`));
      });
    });
    const exit = waitForExit(child);
    child.send(input);
    return { child, message, exit };
  }

  it.each(["before-commit", "after-commit"] as const)(
    "SIGKILL %s then retries in a fresh process with one resource, audit and result",
    async phase => {
      const code = `RECOVERY_${randomUUID()}`;
      const scope = `admin:${adminId}:lottery:recovery:${randomUUID()}`;
      codes.push(code);
      scopes.push(scope);
      const input: ProcessCommand = {
        phase, code, actor: { adminId, sessionId, role: "ADMIN" },
        command: { scope, key: randomUUID(), fingerprint: code, responseCode: 201 },
      };
      const first = start(input);
      const startedAt = Date.now();
      const barrier = await first.message;
      expect(barrier).toMatchObject({ phase });
      const resourceBefore = await prisma.lotteryBetType.findUnique({ where: { code } });
      const recordBefore = await prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: input.command.key } } });
      if (phase === "before-commit") {
        expect(resourceBefore).toBeNull();
        expect(recordBefore).toBeNull();
      } else {
        expect(resourceBefore).not.toBeNull();
        expect(recordBefore).toMatchObject({ status: "COMPLETED", responseBody: { id: resourceBefore!.id, code } });
      }
      if (phase === "before-commit") {
        const activity = await prisma.$queryRaw<Array<{ state: string; hasTransaction: boolean; hasWrites: boolean }>>`
          SELECT state, xact_start IS NOT NULL AS "hasTransaction", backend_xid IS NOT NULL AS "hasWrites"
          FROM pg_stat_activity WHERE pid = ${barrier.backendPid!}::int`;
        expect(activity).toEqual([{ state: "idle in transaction", hasTransaction: true, hasWrites: true }]);
        expect(Date.now() - startedAt).toBeLessThan(15_000);
      }
      expect(first.child.kill("SIGKILL")).toBe(true);
      expect(await first.exit).toEqual({ code: null, signal: "SIGKILL" });

      const retry = start({ ...input, phase: "retry" });
      expect(retry.child.pid).not.toBe(first.child.pid);
      const reply = await retry.message;
      expect(reply).toMatchObject({ phase: "result", result: { code } });
      expect(await retry.exit).toEqual({ code: 0, signal: null });
      const result = reply.result!;
      if (phase === "after-commit") expect(result.id).toBe(resourceBefore!.id);
      else {
        expect(result.id).not.toBe(barrier.resourceId);
        expect(await prisma.lotteryBetType.findUnique({ where: { id: barrier.resourceId! } })).toBeNull();
        expect(await prisma.auditRecord.count({ where: { resourceId: barrier.resourceId! } })).toBe(0);
      }
      expect(await prisma.lotteryBetType.count({ where: { code } })).toBe(1);
      const audits = await prisma.auditRecord.findMany({ where: { actorAdminId: adminId, resourceId: result.id } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: "LOTTERY_BET_TYPE_CREATE", outcome: "CREATED" });
      const records = await prisma.idempotencyRecord.findMany({ where: { scope } });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ status: "COMPLETED", responseCode: 201, responseBody: result });

      // A third process proves repeat recovery remains a replay, not a new create.
      const replay = start({ ...input, phase: "retry" });
      expect(await replay.message).toEqual(reply);
      expect(await replay.exit).toEqual({ code: 0, signal: null });
      expect(await prisma.auditRecord.count({ where: { actorAdminId: adminId, resourceId: result.id } })).toBe(1);
    },
  );

  it.each([
    ["BET_TYPE", "before-commit"], ["BET_TYPE", "after-commit"],
    ["PRODUCT", "before-commit"], ["PRODUCT", "after-commit"],
  ] as const)("recovers %s publication after SIGKILL %s with atomic evidence", async (kind, phase) => {
    const service = new LotteryConfigurationService(prisma);
    const maker = { adminId: makerId, sessionId: makerSessionId, role: "ADMIN" as const };
    const checker = { adminId, sessionId, role: "ADMIN" as const };
    const code = `PUBLISH_RECOVERY_${randomUUID()}`;
    codes.push(code);
    const identity = await service.createBetType({ code, actor: maker });
    const betVersion = await service.createBetTypeVersion({
      betTypeId: identity.id, version: 1, canonicalNumberFormat: "00", validationPattern: "^[0-9]{2}$",
      defaultPayout: { amountMinor: 9000 }, minStakeMinor: 100n, maxStakeMinor: 100000n,
      limitPolicyRef: "limit-v1", restrictionPolicyRef: "restriction-v1", settlementRuleVersionRef: "settlement-v1",
      effectiveFrom: new Date("2099-01-01T00:00:00Z"), actor: maker,
    });
    betVersionIds.push(betVersion.id);
    await service.submit({ kind: "BET_TYPE", id: betVersion.id, expectedRevision: 1, actor: maker });
    let version = betVersion;
    if (kind === "PRODUCT") {
      await service.approveAndPublish({ kind: "BET_TYPE", id: betVersion.id, expectedRevision: 2,
        actor: checker, reauthEvidenceId: reauthId, correlationId: randomUUID() });
      const product = await service.createProduct({ actor: maker });
      productIds.push(product.id);
      version = await service.createProductVersion({
        productId: product.id, version: 1, timezone: "Asia/Bangkok", scheduleTemplateRef: "schedule-v1",
        resultSchemaVersionRef: "result-v1", settlementRuleVersionRef: "settlement-v1",
        defaultPayoutPolicyRef: "payout-v1", defaultLimitPolicyRef: "limit-v1", defaultRestrictionPolicyRef: "restriction-v1",
        effectiveFrom: new Date("2099-01-01T00:00:00Z"), actor: maker,
        enabledBetTypes: [{ betTypeId: identity.id, betTypeVersionId: betVersion.id }],
      });
      productVersionIds.push(version.id);
      await service.submit({ kind, id: version.id, expectedRevision: 1, actor: maker });
    }
    const scope = `admin:${adminId}:lottery:${kind}:${version.id}:approve`;
    scopes.push(scope);
    const input: ProcessCommand = {
      phase, code, actor: checker,
      command: { scope, key: randomUUID(), fingerprint: randomUUID(), responseCode: 200 },
      publication: { kind, id: version.id, expectedRevision: 2, reauthEvidenceId: reauthId, correlationId: randomUUID() },
    };
    const snapshot = async () => ({
      version: kind === "PRODUCT"
        ? await prisma.lotteryProductVersion.findUniqueOrThrow({ where: { id: version.id } })
        : await prisma.lotteryBetTypeVersion.findUniqueOrThrow({ where: { id: version.id } }),
      approvals: await prisma.adminApprovalEvidence.findMany({ where: { resourceId: version.id } }),
      audits: await prisma.auditRecord.findMany({ where: { resourceId: version.id, action: `LOTTERY_${kind}_VERSION_PUBLISH` } }),
      records: await prisma.idempotencyRecord.findMany({ where: { scope } }),
    });
    const before = await snapshot();
    expect(before).toMatchObject({ version: { state: "REVIEW", revision: 2 }, approvals: [], audits: [], records: [] });
    const startedAt = Date.now();
    const first = start(input);
    const barrier = await first.message;
    expect(barrier.phase).toBe(phase);
    const atBarrier = await snapshot();
    if (phase === "before-commit") {
      expect(atBarrier).toEqual(before);
      const activity = await prisma.$queryRaw<Array<{ state: string; hasTransaction: boolean; hasWrites: boolean }>>`
        SELECT state, xact_start IS NOT NULL AS "hasTransaction", backend_xid IS NOT NULL AS "hasWrites"
        FROM pg_stat_activity WHERE pid = ${barrier.backendPid!}::int`;
      expect(activity).toEqual([{ state: "idle in transaction", hasTransaction: true, hasWrites: true }]);
      expect(Date.now() - startedAt).toBeLessThan(15_000);
    } else {
      expect(atBarrier.version).toMatchObject({ state: "PUBLISHED", revision: 3 });
      expect(atBarrier.approvals).toHaveLength(1);
      expect(atBarrier.audits).toHaveLength(1);
      expect(atBarrier.records).toHaveLength(1);
      expect(atBarrier.records[0]).toMatchObject({ status: "COMPLETED" });
    }
    expect(first.child.kill("SIGKILL")).toBe(true);
    expect(await first.exit).toEqual({ code: null, signal: "SIGKILL" });
    const retry = start({ ...input, phase: "retry" });
    expect(retry.child.pid).not.toBe(first.child.pid);
    const reply = await retry.message;
    expect(reply).toMatchObject({ phase: "result", result: { id: version.id, state: "PUBLISHED" } });
    expect(await retry.exit).toEqual({ code: 0, signal: null });
    const recovered = await snapshot();
    expect(recovered.version).toMatchObject({ state: "PUBLISHED", revision: 3 });
    expect(recovered.approvals).toHaveLength(1);
    expect(recovered.approvals[0]).toMatchObject({ requesterAdminId: makerId, approverAdminId: adminId, requestedVersion: 2, reauthEvidenceId: reauthId });
    expect(recovered.audits).toHaveLength(1);
    expect(recovered.audits[0]).toMatchObject({ approvalId: recovered.approvals[0]!.id, reauthEvidenceId: reauthId, outcome: "PUBLISHED" });
    expect(recovered.records).toHaveLength(1);
    expect(recovered.records[0]).toMatchObject({ status: "COMPLETED", responseCode: 200, responseBody: reply.result });
    if (phase === "after-commit") expect(recovered).toEqual(atBarrier);
    const replay = start({ ...input, phase: "retry" });
    expect(await replay.message).toEqual(reply);
    expect(await replay.exit).toEqual({ code: 0, signal: null });
    expect(await snapshot()).toEqual(recovered);
    if (kind === "PRODUCT") {
      const links = await prisma.lotteryProductVersionBetType.findMany({ where: { productVersionId: version.id } });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ betTypeId: identity.id, betTypeVersionId: betVersion.id });
    }
  });

});

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise(resolveExit => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

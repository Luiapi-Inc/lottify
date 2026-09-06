import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerWalletReconciliationService } from "../../src/contexts/reporting/ledger-wallet-reconciliation.service";
import type {
  LedgerWalletProjectionPort,
  ReconciliationWalletProjection,
} from "../../src/contexts/reporting/ledger-wallet-projection.port";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Ledger ↔ Wallet reconciliation integration", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let reconciliation: LedgerWalletReconciliationService;
  const memberIds: string[] = [];
  const systemAccountIds: string[] = [];
  const transactionIds: string[] = [];
  const reservationIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    ledger = new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(prisma, new DatabaseAccountingPeriodTransactionClock()),
    );
    reconciliation = new LedgerWalletReconciliationService(prisma, ledger, ledger);
    await prisma.$connect();
  });

  afterAll(async () => {
    const runs = await prisma.reconciliationRun.findMany({
      where: { memberId: { in: memberIds } },
      select: { id: true },
    });
    const runIds = runs.map((run) => run.id);
    if (runIds.length > 0) {
      await prisma.reconciliationDiscrepancy.deleteMany({
        where: { reconciliationRunId: { in: runIds } },
      });
      await prisma.reconciliationRun.deleteMany({ where: { id: { in: runIds } } });
    }
    if (reservationIds.length > 0) {
      await prisma.reservationAllocation.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    if (transactionIds.length > 0) {
      await prisma.ledgerPosting.deleteMany({
        where: { transactionId: { in: transactionIds } },
      });
      await prisma.financialTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    }
    await prisma.ledgerAccount.deleteMany({
      where: {
        OR: [
          { memberId: { in: memberIds } },
          { id: { in: systemAccountIds } },
        ],
      },
    });
    await prisma.$disconnect();
  });

  async function createFixture(label: string, fixedMemberId?: string): Promise<{
    memberId: string;
    cashAccountId: string;
    transactionId: string;
    reservationId: string;
  }> {
    const memberId = fixedMemberId ?? randomUUID();
    memberIds.push(memberId);
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const systemAccountId = await ledger.ensureSystemAccount(`reconciliation:${label}:${randomUUID()}`);
    systemAccountIds.push(systemAccountId);

    const transactionId = await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: `reconciliation.integration.deposit.${label}`,
        key: randomUUID(),
        fingerprint: `${label}:deposit:5000`,
      },
      domainReferences: { test: label },
      currency: "THB",
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      postings: [
        { accountId: systemAccountId, side: "DEBIT", amountMinor: 5_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 5_000n },
      ],
    });
    transactionIds.push(transactionId);

    const reservationId = await ledger.reserve({
      purpose: "BET",
      businessReference: `reconciliation-bet:${label}:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 1_200n,
      correlationId: randomUUID(),
      idempotency: {
        scope: `reconciliation.integration.reserve.${label}`,
        key: randomUUID(),
        fingerprint: `${label}:reserve:1200`,
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 1_200n }],
    });
    reservationIds.push(reservationId);
    return { memberId, cashAccountId, transactionId, reservationId };
  }

  it("persists a reproducible matching run from authoritative Ledger and active Reservation facts", async () => {
    const fixture = await createFixture("matched");
    const checkpointKey = `ledger-wallet:${randomUUID()}`;

    const result = await reconciliation.run({ checkpointKey, memberId: fixture.memberId });

    expect(result).toMatchObject({
      checkpointKey,
      memberId: fixture.memberId,
      currency: "THB",
      result: "MATCHED",
      discrepancyCount: 0,
    });
    const persisted = await prisma.reconciliationRun.findUniqueOrThrow({
      where: { pair_checkpointKey: { pair: "LEDGER_WALLET", checkpointKey } },
      include: { discrepancies: true },
    });
    expect(persisted.asOf).toEqual(result.asOf);
    expect(persisted.sourceRange).toMatchObject({
      ledgerPostedAt: { through: result.asOf.toISOString() },
      reservationLifecycle: { through: result.asOf.toISOString() },
    });
    expect(persisted.sourceCheckpoint).toMatchObject({
      checkpointKey,
      memberId: fixture.memberId,
      currency: "THB",
      latestLedgerPostingId: expect.any(String),
      latestReservationId: fixture.reservationId,
    });
    expect(persisted.inspectedCounts).toEqual({
      ledgerAccounts: 1,
      ledgerPostings: 1,
      activeReservationAllocations: 1,
      walletBuckets: 3,
      discrepancies: 0,
    });
    expect(persisted.totals).toEqual({
      expected: { postedMinor: "5000", reservedMinor: "1200", availableMinor: "3800" },
      observed: { postedMinor: "5000", reservedMinor: "1200", availableMinor: "3800" },
      difference: { postedMinor: "0", reservedMinor: "0", availableMinor: "0" },
    });
    expect(persisted.resultSummary).toEqual({
      matched: true,
      discrepancyCount: 0,
      bucketCount: 3,
    });
    expect(persisted.discrepancies).toHaveLength(0);
  });

  it("replays the same logical checkpoint without duplicating the run", async () => {
    const fixture = await createFixture("replay");
    const checkpointKey = `ledger-wallet:${randomUUID()}`;

    const first = await reconciliation.run({ checkpointKey, memberId: fixture.memberId });
    const replay = await reconciliation.run({ checkpointKey, memberId: fixture.memberId });

    expect(replay).toEqual(first);
    expect(
      await prisma.reconciliationRun.count({
        where: { pair: "LEDGER_WALLET", checkpointKey },
      }),
    ).toBe(1);

    await expect(
      reconciliation.run({ checkpointKey, memberId: randomUUID() }),
    ).rejects.toThrow("Reconciliation checkpoint idempotency conflict");
  });

  it("persists a durable discrepancy from a controlled Wallet projection mismatch without mutating financial authority", async () => {
    const fixture = await createFixture("mismatch");
    const checkpointKey = `ledger-wallet:${randomUUID()}`;
    const financialCountsBefore = await authoritativeCounts(fixture.memberId);
    const driftingReader: LedgerWalletProjectionPort = {
      async getWalletProjection(memberId: string): Promise<ReconciliationWalletProjection> {
        const projection = await ledger.getWalletProjection(memberId, "THB");
        return {
          ...projection,
          buckets: projection.buckets.map((bucket) =>
            bucket.bucket === "CASH"
              ? { ...bucket, availableMinor: bucket.availableMinor + 1n }
              : bucket,
          ),
        };
      },
    };
    const mismatchReconciliation = new LedgerWalletReconciliationService(prisma, driftingReader, ledger);

    const result = await mismatchReconciliation.run({ checkpointKey, memberId: fixture.memberId });

    expect(result.result).toBe("MISMATCH");
    expect(result.discrepancyCount).toBe(1);
    const discrepancy = await prisma.reconciliationDiscrepancy.findFirstOrThrow({
      where: { reconciliationRunId: result.id },
    });
    expect(discrepancy).toMatchObject({
      identityKey: "CASH:availableMinor",
      status: "DETECTED",
      severity: "ERROR",
      amountDifferenceMinor: 1n,
      ownerReference: null,
      resolvedAt: null,
    });
    expect(discrepancy.expectedFacts).toEqual({
      memberId: fixture.memberId,
      currency: "THB",
      bucket: "CASH",
      metric: "availableMinor",
      amountMinor: "3800",
    });
    expect(discrepancy.observedFacts).toEqual({
      memberId: fixture.memberId,
      currency: "THB",
      bucket: "CASH",
      metric: "availableMinor",
      amountMinor: "3801",
    });
    expect(discrepancy.sourceReferences).toMatchObject({
      pair: "LEDGER_WALLET",
      checkpointKey,
      memberId: fixture.memberId,
      ledgerAccountId: fixture.cashAccountId,
    });
    expect(discrepancy.resolutionTrail).toEqual([]);
    expect(discrepancy.resolutionEvidence).toBeNull();
    expect(await authoritativeCounts(fixture.memberId)).toEqual(financialCountsBefore);

    const alertNow = new Date();
    const staleDetectedAt = new Date(alertNow.getTime() - 16 * 60_000);
    await prisma.reconciliationDiscrepancy.update({
      where: { id: discrepancy.id },
      data: { detectedAt: staleDetectedAt, severity: "CRITICAL" },
    });
    const alertSummary = await mismatchReconciliation.getOperationalAlertSummary(
      new Date(alertNow.getTime() - 15 * 60_000),
    );
    expect(alertSummary.staleMonetary).toMatchObject({
      count: expect.any(Number),
      oldestDiscrepancyId: discrepancy.id,
      oldestDetectedAt: staleDetectedAt,
    });
    expect(alertSummary.staleMonetary?.count).toBeGreaterThanOrEqual(1);
    expect(alertSummary.critical).toMatchObject({
      count: expect.any(Number),
      oldestDiscrepancyId: discrepancy.id,
      oldestDetectedAt: staleDetectedAt,
    });
    expect(alertSummary.critical?.count).toBeGreaterThanOrEqual(1);
  });

  it("discovers Wallet-Ledger reconciliation targets through a stable bounded page", async () => {
    const firstMemberId = "ffffffff-ffff-ffff-ffff-ffffffffffd1";
    const secondMemberId = "ffffffff-ffff-ffff-ffff-ffffffffffd2";
    const thirdMemberId = "ffffffff-ffff-ffff-ffff-ffffffffffd3";
    const afterMemberId = "ffffffff-ffff-ffff-ffff-ffffffffffd0";
    const first = await createFixture("target-page-1", firstMemberId);
    await createFixture("target-page-2", secondMemberId);
    await createFixture("target-page-3", thirdMemberId);

    const firstPage = await ledger.listReconciliationTargets({
      currency: "THB",
      afterMemberId,
      limit: 2,
    });
    expect(firstPage.targets.map((target) => target.memberId)).toEqual([
      firstMemberId,
      secondMemberId,
    ]);
    expect(firstPage.targets.every((target) => target.currency === "THB")).toBe(true);
    expect(firstPage.targets.every((target) => target.sourceVersionAt instanceof Date)).toBe(true);
    expect(firstPage.nextCursor).toBe(secondMemberId);

    const secondPage = await ledger.listReconciliationTargets({
      currency: "THB",
      afterMemberId: firstPage.nextCursor ?? undefined,
      limit: 2,
    });
    expect(secondPage.targets.map((target) => target.memberId)).toEqual([thirdMemberId]);
    expect(secondPage.nextCursor).toBeNull();

    const releasedAt = await ledger.releaseReservation(first.reservationId);
    const refreshed = await ledger.listReconciliationTargets({
      currency: "THB",
      afterMemberId,
      limit: 1,
    });
    expect(refreshed.targets[0]).toMatchObject({ memberId: firstMemberId, currency: "THB" });
    expect(refreshed.targets[0]?.sourceVersionAt.getTime()).toBeGreaterThanOrEqual(
      releasedAt.getTime(),
    );
  });

  async function authoritativeCounts(memberId: string): Promise<{
    financialTransactions: number;
    ledgerPostings: number;
    reservations: number;
    reservationAllocations: number;
  }> {
    const accounts = await prisma.ledgerAccount.findMany({
      where: { kind: "MEMBER", memberId, currency: "THB" },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    return {
      financialTransactions: await prisma.financialTransaction.count({
        where: { postings: { some: { accountId: { in: accountIds } } } },
      }),
      ledgerPostings: await prisma.ledgerPosting.count({ where: { accountId: { in: accountIds } } }),
      reservations: await prisma.reservation.count({ where: { memberId } }),
      reservationAllocations: await prisma.reservationAllocation.count({
        where: { accountId: { in: accountIds } },
      }),
    };
  }
});

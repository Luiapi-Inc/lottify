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
    reconciliation = new LedgerWalletReconciliationService(prisma, ledger);
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

  async function createFixture(label: string): Promise<{
    memberId: string;
    cashAccountId: string;
    transactionId: string;
    reservationId: string;
  }> {
    const memberId = randomUUID();
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
    const mismatchReconciliation = new LedgerWalletReconciliationService(prisma, driftingReader);

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

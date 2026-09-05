import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountingPeriodFinancialReportService } from "../../src/contexts/reporting/accounting-period-financial-report.service";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { type AccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runReportingIntegration = process.env.RUN_ACCOUNTING_PERIOD_REPORTING_TEST === "1";

class MutableAccountingPeriodClock implements AccountingPeriodTransactionClock {
  constructor(private instant: Date) {}

  set(instant: Date): void {
    this.instant = new Date(instant);
  }

  async now(): Promise<Date> {
    return new Date(this.instant);
  }
}

describe.runIf(runReportingIntegration)("accounting period reporting integration", () => {
  const originalPostingInstant = new Date("2033-06-08T04:00:00.000Z");
  const correctionPostingInstant = new Date("2033-06-15T04:00:00.000Z");
  const historicalEffectiveAt = new Date("2020-01-01T00:00:00.000Z");
  let prisma: PrismaService;
  let clock: MutableAccountingPeriodClock;
  let ledger: FinancialLedgerService;
  let reporting: AccountingPeriodFinancialReportService;
  let memberId: string;
  let cashAccountId: string;
  let providerAccountId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    clock = new MutableAccountingPeriodClock(originalPostingInstant);
    ledger = new FinancialLedgerService(new PrismaFinancialLedgerRepository(prisma, clock));
    reporting = new AccountingPeriodFinancialReportService(prisma);
    memberId = randomUUID();
    cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    providerAccountId = await ledger.ensureSystemAccount(`reporting-provider:${randomUUID()}`);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.ledgerPosting.deleteMany({
      where: { transaction: { domainReferences: { path: ["test"], equals: "accounting-period-reporting" } } },
    });
    await prisma.financialTransaction.deleteMany({
      where: {
        domainReferences: { path: ["test"], equals: "accounting-period-reporting" },
        correctionKind: { not: null },
      },
    });
    await prisma.financialTransaction.deleteMany({
      where: { domainReferences: { path: ["test"], equals: "accounting-period-reporting" } },
    });
    await prisma.ledgerAccount.deleteMany({
      where: { OR: [{ id: cashAccountId }, { id: providerAccountId }] },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.accountingPeriod.deleteMany({
        where: {
          effectiveStart: {
            gte: new Date("2033-06-01T00:00:00.000Z"),
            lt: new Date("2033-07-01T00:00:00.000Z"),
          },
        },
      });
    });
    await prisma.$disconnect();
  });

  it("groups by stored AccountingPeriodId, ignores effectiveAt for assignment, and exposes correction lineage across CLOSED history", async () => {
    const originalTransactionId = await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "accounting-period-reporting.original",
        key: randomUUID(),
        fingerprint: "deposit:5000",
      },
      domainReferences: { test: "accounting-period-reporting", phase: "original" },
      currency: "THB",
      effectiveAt: historicalEffectiveAt,
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 5_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 5_000n },
      ],
    });
    const originalBefore = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: originalTransactionId },
      select: { accountingPeriodId: true, postedAt: true, effectiveAt: true },
    });
    expect(originalBefore.postedAt).toEqual(originalPostingInstant);
    expect(originalBefore.effectiveAt).toEqual(historicalEffectiveAt);

    clock.set(correctionPostingInstant);
    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_REPORTING_PERIOD_TURNOVER",
      correlationId: randomUUID(),
      idempotency: {
        scope: "accounting-period-reporting.turnover",
        key: randomUUID(),
        fingerprint: "turnover:1",
      },
      domainReferences: { test: "accounting-period-reporting", phase: "turnover" },
      currency: "THB",
      effectiveAt: correctionPostingInstant,
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 1n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 1n },
      ],
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.accountingPeriod.update({
        where: { id: originalBefore.accountingPeriodId },
        data: { state: "CLOSED", version: { increment: 1 } },
      });
    });

    const correctionTransactionId = await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_COMPENSATION",
      correlationId: randomUUID(),
      idempotency: {
        scope: "accounting-period-reporting.correction",
        key: randomUUID(),
        fingerprint: "compensation:1200",
      },
      domainReferences: { test: "accounting-period-reporting", phase: "correction" },
      currency: "THB",
      effectiveAt: originalPostingInstant,
      correction: { kind: "COMPENSATION", correctsTransactionId: originalTransactionId },
      postings: [
        { accountId: cashAccountId, side: "DEBIT", amountMinor: 1_200n },
        { accountId: providerAccountId, side: "CREDIT", amountMinor: 1_200n },
      ],
    });

    const [originalAfter, correction] = await Promise.all([
      prisma.financialTransaction.findUniqueOrThrow({
        where: { id: originalTransactionId },
        select: { accountingPeriodId: true, postedAt: true, effectiveAt: true },
      }),
      prisma.financialTransaction.findUniqueOrThrow({
        where: { id: correctionTransactionId },
        select: {
          accountingPeriodId: true,
          postedAt: true,
          effectiveAt: true,
          correctionKind: true,
          correctsTransactionId: true,
        },
      }),
    ]);
    expect(originalAfter).toEqual(originalBefore);
    expect(correction.accountingPeriodId).not.toBe(originalBefore.accountingPeriodId);
    expect(correction.postedAt).toEqual(correctionPostingInstant);
    expect(correction.effectiveAt).toEqual(originalPostingInstant);
    expect(correction.correctionKind).toBe("COMPENSATION");
    expect(correction.correctsTransactionId).toBe(originalTransactionId);

    const report = await reporting.build();
    const originalPeriod = report.periods.find(
      (period) => period.accountingPeriodId === originalBefore.accountingPeriodId,
    );
    const correctionPeriod = report.periods.find(
      (period) => period.accountingPeriodId === correction.accountingPeriodId,
    );
    expect(originalPeriod).toMatchObject({ state: "CLOSED" });
    expect(correctionPeriod).toMatchObject({ state: "OPEN" });
    expect(originalPeriod?.transactionCount).toBe(1);
    expect(correctionPeriod?.transactionCount).toBe(2);
    expect(report.corrections).toContainEqual({
      transactionId: correctionTransactionId,
      correctionKind: "COMPENSATION",
      accountingPeriodId: correction.accountingPeriodId,
      correctsTransactionId: originalTransactionId,
      originalAccountingPeriodId: originalBefore.accountingPeriodId,
    });
    expect(report.completeness).toBe("CURRENT");
    expect(report.projectionLagMs).toBe(0);
    expect(report.generatedAt).toEqual(report.dataAsOf);
  });
});

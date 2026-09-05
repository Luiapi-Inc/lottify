import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountingPeriodService } from "../../src/contexts/wallet-ledger/application/accounting-period.service";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { automaticWeeklyAccountingPeriodBounds } from "../../src/contexts/wallet-ledger/domain/accounting-period";
import { PrismaAccountingPeriodRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-accounting-period.repository";
import {
  type AccountingPeriodTransactionClock,
  DatabaseAccountingPeriodTransactionClock,
} from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const boundaryScenarioAnchor = new Date("2018-05-16T12:00:00.000Z");
const boundaryScenarioBounds = automaticWeeklyAccountingPeriodBounds(boundaryScenarioAnchor);
const boundaryScenarioBoundary = boundaryScenarioBounds.end;
const schedulerRaceInstant = new Date("2019-08-15T12:00:00.000Z");

class FixedAccountingPeriodClock implements AccountingPeriodTransactionClock {
  constructor(private readonly instant: Date) {}

  async now(): Promise<Date> {
    return new Date(this.instant);
  }
}

describe.runIf(runIntegration)("financial core integration", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let accountingPeriods: AccountingPeriodService;

  function ledgerAt(instant: Date): FinancialLedgerService {
    return new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(prisma, new FixedAccountingPeriodClock(instant)),
    );
  }

  function accountingPeriodsAt(instant: Date): AccountingPeriodService {
    const clock = new FixedAccountingPeriodClock(instant);
    return new AccountingPeriodService(new PrismaAccountingPeriodRepository(prisma, clock));
  }

  async function postBalancedAt(instant: Date, label: string): Promise<string> {
    const fixedLedger = ledgerAt(instant);
    const memberId = randomUUID();
    const cashAccountId = await fixedLedger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await fixedLedger.ensureSystemAccount(`provider:${label}:${randomUUID()}`);
    return fixedLedger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: `financial.integration.accounting-period-runtime.${label}`,
        key: randomUUID(),
        fingerprint: `${label}:1000`,
      },
      domainReferences: { test: label },
      currency: "THB",
      effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 1_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 1_000n },
      ],
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    const clock = new DatabaseAccountingPeriodTransactionClock();
    ledger = new FinancialLedgerService(new PrismaFinancialLedgerRepository(prisma, clock));
    accountingPeriods = new AccountingPeriodService(
      new PrismaAccountingPeriodRepository(prisma, clock),
    );
    await prisma.$connect();
  });

  async function expectAuthoritativeAccountingPeriodLink(transactionId: string): Promise<void> {
    const transaction = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: {
        postedAt: true,
        accountingPeriodId: true,
        accountingPeriod: {
          select: {
            mode: true,
            effectiveStart: true,
            effectiveEnd: true,
            state: true,
          },
        },
      },
    });
    expect(transaction.accountingPeriodId).not.toBeNull();
    expect(transaction.accountingPeriod?.mode).toBe("AUTOMATIC_WEEKLY");
    expect(transaction.accountingPeriod?.state).toBe("OPEN");
    const expectedBounds = automaticWeeklyAccountingPeriodBounds(transaction.postedAt);
    expect(transaction.accountingPeriod?.effectiveStart).toEqual(expectedBounds.start);
    expect(transaction.accountingPeriod?.effectiveEnd).toEqual(expectedBounds.end);
  }

  afterAll(async () => {
    await prisma.reservationAllocation.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.ledgerPosting.deleteMany();
    await prisma.financialTransaction.deleteMany();
    await prisma.ledgerAccount.deleteMany();
    const runtimeStarts = [
      boundaryScenarioBounds.start,
      boundaryScenarioBoundary,
      automaticWeeklyAccountingPeriodBounds(boundaryScenarioBoundary).end,
      automaticWeeklyAccountingPeriodBounds(schedulerRaceInstant).start,
      automaticWeeklyAccountingPeriodBounds(schedulerRaceInstant).end,
    ];
    await prisma.accountingPeriod.deleteMany({
      where: { effectiveStart: { in: runtimeStarts } },
    });
    await prisma.$disconnect();
  });

  it("assigns a live Financial Transaction to the authoritative Automatic Accounting Period from postedAt", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);
    const historicalEffectiveAt = new Date("2020-01-01T00:00:00.000Z");

    const transactionId = await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.accounting-period",
        key: randomUUID(),
        fingerprint: "deposit:accounting-period:2500",
      },
      domainReferences: { test: "accounting-period-assignment" },
      currency: "THB",
      effectiveAt: historicalEffectiveAt,
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 2_500n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 2_500n },
      ],
    });

    const transaction = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: {
        effectiveAt: true,
        postedAt: true,
        accountingPeriodId: true,
        accountingPeriod: {
          select: {
            mode: true,
            generationKind: true,
            effectiveStart: true,
            effectiveEnd: true,
            state: true,
          },
        },
      },
    });

    expect(transaction.effectiveAt).toEqual(historicalEffectiveAt);
    expect(transaction.accountingPeriodId).not.toBeNull();
    expect(transaction.accountingPeriod).not.toBeNull();
    expect(transaction.accountingPeriod?.mode).toBe("AUTOMATIC_WEEKLY");
    expect(transaction.accountingPeriod?.generationKind).toBe("NOMINAL_WEEK");
    expect(transaction.accountingPeriod?.state).toBe("OPEN");
    const expectedBounds = automaticWeeklyAccountingPeriodBounds(transaction.postedAt);
    expect(transaction.accountingPeriod?.effectiveStart).toEqual(expectedBounds.start);
    expect(transaction.accountingPeriod?.effectiveEnd).toEqual(expectedBounds.end);
    expect(transaction.accountingPeriod!.effectiveStart.getTime()).toBeLessThanOrEqual(
      transaction.postedAt.getTime(),
    );
    expect(transaction.postedAt.getTime()).toBeLessThan(
      transaction.accountingPeriod!.effectiveEnd.getTime(),
    );
    expect(transaction.effectiveAt.getTime()).toBeLessThan(
      transaction.accountingPeriod!.effectiveStart.getTime(),
    );

    const period = await accountingPeriods.getById(transaction.accountingPeriodId!);
    expect(period).toMatchObject({
      id: transaction.accountingPeriodId,
      mode: "AUTOMATIC_WEEKLY",
      generationKind: "NOMINAL_WEEK",
      accountingTimezone: "Asia/Bangkok",
      state: "OPEN",
      version: 1,
      allowedActions: [],
    });
    expect(period.effectiveStart).toEqual(transaction.accountingPeriod!.effectiveStart);
    expect(period.effectiveEnd).toEqual(transaction.accountingPeriod!.effectiveEnd);
    expect(period.createdAt).toBeInstanceOf(Date);
    expect(period.updatedAt).toBeInstanceOf(Date);
  });

  it("prepares current and next Automatic coverage idempotently while racing posting-path repair", async () => {
    const scheduler = accountingPeriodsAt(schedulerRaceInstant);
    const transactionPromise = postBalancedAt(
      schedulerRaceInstant,
      "scheduler-posting-repair-race",
    );

    await Promise.all([
      scheduler.ensureAutomaticCoverage(),
      scheduler.ensureAutomaticCoverage(),
      transactionPromise,
    ]);
    const transactionId = await transactionPromise;
    const bounds = automaticWeeklyAccountingPeriodBounds(schedulerRaceInstant);
    const nextBounds = automaticWeeklyAccountingPeriodBounds(bounds.end);
    const periods = await prisma.accountingPeriod.findMany({
      where: {
        effectiveStart: { in: [bounds.start, nextBounds.start] },
      },
      orderBy: { effectiveStart: "asc" },
      select: { id: true, effectiveStart: true, effectiveEnd: true, state: true },
    });

    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({
      effectiveStart: bounds.start,
      effectiveEnd: bounds.end,
      state: "OPEN",
    });
    expect(periods[1]).toMatchObject({
      effectiveStart: nextBounds.start,
      effectiveEnd: nextBounds.end,
      state: "SCHEDULED",
    });
    expect(periods[0]!.effectiveEnd).toEqual(periods[1]!.effectiveStart);

    const transaction = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: { postedAt: true, accountingPeriodId: true },
    });
    expect(transaction.postedAt).toEqual(schedulerRaceInstant);
    expect(transaction.accountingPeriodId).toBe(periods[0]!.id);
  });

  it("turns over exactly at the Bangkok boundary and assigns concurrent postings to the successor", async () => {
    const preBoundary = new Date(boundaryScenarioBoundary.getTime() - 1);
    const postBoundary = new Date(boundaryScenarioBoundary.getTime() + 1);
    const predecessorTransactionId = await postBalancedAt(preBoundary, "pre-boundary");

    const exactTransactionIds = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        postBalancedAt(boundaryScenarioBoundary, `exact-boundary-${index}`),
      ),
    );
    const postTransactionId = await postBalancedAt(postBoundary, "post-boundary");

    const successorBounds = automaticWeeklyAccountingPeriodBounds(boundaryScenarioBoundary);
    const followingBounds = automaticWeeklyAccountingPeriodBounds(successorBounds.end);
    const periods = await prisma.accountingPeriod.findMany({
      where: {
        effectiveStart: {
          in: [boundaryScenarioBounds.start, successorBounds.start, followingBounds.start],
        },
      },
      orderBy: { effectiveStart: "asc" },
      select: { id: true, effectiveStart: true, effectiveEnd: true, state: true },
    });

    expect(periods).toHaveLength(3);
    expect(periods[0]).toMatchObject({
      effectiveStart: boundaryScenarioBounds.start,
      effectiveEnd: boundaryScenarioBounds.end,
      state: "CLOSING",
    });
    expect(periods[1]).toMatchObject({
      effectiveStart: successorBounds.start,
      effectiveEnd: successorBounds.end,
      state: "OPEN",
    });
    expect(periods[2]).toMatchObject({
      effectiveStart: followingBounds.start,
      effectiveEnd: followingBounds.end,
      state: "SCHEDULED",
    });
    expect(periods[0]!.effectiveEnd).toEqual(periods[1]!.effectiveStart);
    expect(periods[1]!.effectiveEnd).toEqual(periods[2]!.effectiveStart);

    const transactions = await prisma.financialTransaction.findMany({
      where: {
        id: {
          in: [predecessorTransactionId, ...exactTransactionIds, postTransactionId],
        },
      },
      select: { id: true, postedAt: true, accountingPeriodId: true },
    });
    const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    expect(byId.get(predecessorTransactionId)).toMatchObject({
      postedAt: preBoundary,
      accountingPeriodId: periods[0]!.id,
    });
    for (const transactionId of exactTransactionIds) {
      expect(byId.get(transactionId)).toMatchObject({
        postedAt: boundaryScenarioBoundary,
        accountingPeriodId: periods[1]!.id,
      });
    }
    expect(byId.get(postTransactionId)).toMatchObject({
      postedAt: postBoundary,
      accountingPeriodId: periods[1]!.id,
    });
  });

  it("posts a balanced financial transaction once and replays the same idempotent result", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);
    const idempotencyKey = randomUUID();
    const input = {
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.deposit",
        key: idempotencyKey,
        fingerprint: "deposit:10000",
      },
      domainReferences: { depositId: randomUUID() },
      currency: "THB" as const,
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT" as const, amountMinor: 10_000n },
        { accountId: cashAccountId, side: "CREDIT" as const, amountMinor: 10_000n },
      ],
    };

    const first = await ledger.post(input);
    const persisted = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: first },
      select: { accountingPeriodId: true },
    });
    expect(persisted.accountingPeriodId).not.toBeNull();
    if (!persisted.accountingPeriodId) {
      throw new Error("Financial Transaction did not persist an Accounting Period");
    }

    await prisma.accountingPeriod.update({
      where: { id: persisted.accountingPeriodId },
      data: { state: "CLOSING" },
    });
    let replay: string;
    try {
      replay = await ledger.post(input);
    } finally {
      await prisma.accountingPeriod.update({
        where: { id: persisted.accountingPeriodId },
        data: { state: "OPEN" },
      });
    }

    expect(replay).toBe(first);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(10_000n);
    await expect(
      ledger.post({
        ...input,
        idempotency: { ...input.idempotency, fingerprint: "different-payload" },
      }),
    ).rejects.toThrow("idempotency conflict");
  });

  it("allows DEPOSIT_CREDIT to credit Member CASH only", async () => {
    const memberId = randomUUID();
    const bonusAccountId = await ledger.ensureMemberAccount(memberId, "BONUS");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);

    await expect(
      ledger.post({
        businessTransactionId: randomUUID(),
        operationType: "DEPOSIT_CREDIT",
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.deposit.invalid-bucket",
          key: randomUUID(),
          fingerprint: "deposit:bonus:1000",
        },
        domainReferences: { depositId: randomUUID() },
        currency: "THB",
        effectiveAt: new Date(),
        postings: [
          { accountId: providerAccountId, side: "DEBIT", amountMinor: 1_000n },
          { accountId: bonusAccountId, side: "CREDIT", amountMinor: 1_000n },
        ],
      }),
    ).rejects.toThrow("DEPOSIT_CREDIT may post Member value only to CASH");
  });

  it("reverses an immutable financial transaction with exact inverse postings once", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);
    const originalTransactionId = await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.reversal.seed",
        key: randomUUID(),
        fingerprint: "deposit:10000",
      },
      domainReferences: { test: "exact-reversal" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 10_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 10_000n },
      ],
    });

    const reverseInput = {
      originalTransactionId,
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_REVERSAL",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.reversal",
        key: randomUUID(),
        fingerprint: "reverse:deposit:10000",
      },
      domainReferences: { test: "exact-reversal" },
      effectiveAt: new Date(),
    };

    const reversalId = await ledger.reverseTransaction(reverseInput);
    expect(await ledger.reverseTransaction(reverseInput)).toBe(reversalId);

    const [original, reversal] = await Promise.all([
      prisma.financialTransaction.findUniqueOrThrow({
        where: { id: originalTransactionId },
        select: {
          accountingPeriodId: true,
          correctionKind: true,
          correctsTransactionId: true,
          postings: { select: { accountId: true, side: true, amountMinor: true } },
        },
      }),
      prisma.financialTransaction.findUniqueOrThrow({
        where: { id: reversalId },
        select: {
          accountingPeriodId: true,
          correctionKind: true,
          correctsTransactionId: true,
          postings: { select: { accountId: true, side: true, amountMinor: true } },
        },
      }),
    ]);
    expect(original.correctionKind).toBeNull();
    expect(original.correctsTransactionId).toBeNull();
    expect(original.accountingPeriodId).not.toBeNull();
    expect(reversal.correctionKind).toBe("REVERSAL");
    expect(reversal.correctsTransactionId).toBe(originalTransactionId);
    expect(reversal.accountingPeriodId).not.toBeNull();
    await expectAuthoritativeAccountingPeriodLink(reversalId);

    const normalizedOriginal = original.postings
      .map((posting) => `${posting.accountId}:${posting.side}:${posting.amountMinor}`)
      .sort();
    const normalizedReversal = reversal.postings
      .map(
        (posting) =>
          `${posting.accountId}:${posting.side === "DEBIT" ? "CREDIT" : "DEBIT"}:${posting.amountMinor}`,
      )
      .sort();
    expect(normalizedReversal).toEqual(normalizedOriginal);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(0n);

    await expect(
      ledger.reverseTransaction({
        ...reverseInput,
        businessTransactionId: randomUUID(),
        idempotency: {
          scope: "financial.integration.reversal.second",
          key: randomUUID(),
          fingerprint: "reverse:deposit:10000:second",
        },
      }),
    ).rejects.toThrow("Financial transaction already reversed");
  });

  it("serializes concurrent reversal attempts so only one reversal can post", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);
    const originalTransactionId = await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.reversal.concurrent.seed",
        key: randomUUID(),
        fingerprint: "deposit:6000",
      },
      domainReferences: { test: "concurrent-reversal" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 6_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 6_000n },
      ],
    });

    const reverse = (suffix: string) =>
      ledger.reverseTransaction({
        originalTransactionId,
        businessTransactionId: randomUUID(),
        operationType: "DEPOSIT_REVERSAL",
        correlationId: randomUUID(),
        idempotency: {
          scope: `financial.integration.reversal.concurrent.${suffix}`,
          key: randomUUID(),
          fingerprint: `reverse:deposit:6000:${suffix}`,
        },
        domainReferences: { test: "concurrent-reversal" },
        effectiveAt: new Date(),
      });

    const results = await Promise.allSettled([reverse("a"), reverse("b")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.financialTransaction.count({
        where: { correctionKind: "REVERSAL", correctsTransactionId: originalTransactionId },
      }),
    ).toBe(1);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(0n);
  });

  it("posts business-semantic compensation only against a real linked transaction", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);
    const originalTransactionId = await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.compensation.seed",
        key: randomUUID(),
        fingerprint: "deposit:5000",
      },
      domainReferences: { test: "compensation" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 5_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 5_000n },
      ],
    });

    await expect(
      ledger.post({
        businessTransactionId: randomUUID(),
        operationType: "DEPOSIT_COMPENSATION",
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.compensation.missing",
          key: randomUUID(),
          fingerprint: "compensation:missing:1200",
        },
        domainReferences: { test: "compensation-missing-target" },
        currency: "THB",
        effectiveAt: new Date(),
        correction: { kind: "COMPENSATION", correctsTransactionId: randomUUID() },
        postings: [
          { accountId: cashAccountId, side: "DEBIT", amountMinor: 1_200n },
          { accountId: providerAccountId, side: "CREDIT", amountMinor: 1_200n },
        ],
      }),
    ).rejects.toThrow("Financial compensation target not found");

    const compensationInput = {
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_COMPENSATION",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.compensation",
        key: randomUUID(),
        fingerprint: "compensation:deposit:1200",
      },
      domainReferences: { test: "compensation" },
      currency: "THB" as const,
      effectiveAt: new Date(),
      correction: { kind: "COMPENSATION" as const, correctsTransactionId: originalTransactionId },
      postings: [
        { accountId: cashAccountId, side: "DEBIT" as const, amountMinor: 1_200n },
        { accountId: providerAccountId, side: "CREDIT" as const, amountMinor: 1_200n },
      ],
    };
    const compensationId = await ledger.post(compensationInput);
    expect(await ledger.post(compensationInput)).toBe(compensationId);

    const compensation = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: compensationId },
      select: { accountingPeriodId: true, correctionKind: true, correctsTransactionId: true },
    });
    expect(compensation.accountingPeriodId).not.toBeNull();
    expect(compensation.correctionKind).toBe("COMPENSATION");
    expect(compensation.correctsTransactionId).toBe(originalTransactionId);
    await expectAuthoritativeAccountingPeriodLink(compensationId);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(3_800n);
  });

  it("serializes concurrent reservations so available balance cannot be over-reserved", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.seed",
        key: randomUUID(),
        fingerprint: "seed:10000",
      },
      domainReferences: { test: "reservation-concurrency" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 10_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 10_000n },
      ],
    });

    const reserve = (suffix: string) =>
      ledger.reserve({
        purpose: "WITHDRAWAL",
        businessReference: `withdrawal:${randomUUID()}:${suffix}`,
        memberId,
        currency: "THB",
        amountMinor: 6_000n,
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.withdrawal.reserve",
          key: randomUUID(),
          fingerprint: `withdrawal:${suffix}:6000`,
        },
        allocations: [{ accountId: cashAccountId, amountMinor: 6_000n }],
      });

    const results = await Promise.allSettled([reserve("a"), reserve("b")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(4_000n);
  });

  it("releases a Reservation idempotently and restores its held availability", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.release.seed",
        key: randomUUID(),
        fingerprint: "seed:5000",
      },
      domainReferences: { test: "reservation-release" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 5_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 5_000n },
      ],
    });

    const reservationId = await ledger.reserve({
      purpose: "WITHDRAWAL",
      businessReference: `withdrawal:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 3_000n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.release.reserve",
        key: randomUUID(),
        fingerprint: "withdrawal:3000",
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 3_000n }],
    });

    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(2_000n);
    const firstRelease = await ledger.releaseReservation(reservationId);
    const replayRelease = await ledger.releaseReservation(reservationId);
    expect(replayRelease).toEqual(firstRelease);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(5_000n);
  });

  it("projects Wallet state from Ledger plus active Reservations and keeps LOCKED non-spendable", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const bonusAccountId = await ledger.ensureMemberAccount(memberId, "BONUS");
    const lockedAccountId = await ledger.ensureMemberAccount(memberId, "LOCKED");
    const fundingAccountId = await ledger.ensureSystemAccount(`funding:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_SEED_WALLET_PROJECTION",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.wallet-projection.seed",
        key: randomUUID(),
        fingerprint: "seed:cash:4000:bonus:3000:locked:2000",
      },
      domainReferences: { test: "wallet-projection" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: 9_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 4_000n },
        { accountId: bonusAccountId, side: "CREDIT", amountMinor: 3_000n },
        { accountId: lockedAccountId, side: "CREDIT", amountMinor: 2_000n },
      ],
    });

    await expect(
      ledger.reserve({
        purpose: "BET",
        businessReference: `bet:${randomUUID()}`,
        memberId,
        currency: "THB",
        amountMinor: 1_000n,
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.wallet-projection.locked",
          key: randomUUID(),
          fingerprint: "bet:locked:1000",
        },
        allocations: [{ accountId: lockedAccountId, amountMinor: 1_000n }],
      }),
    ).rejects.toThrow("Bet reservations may use Member CASH or BONUS only");

    await ledger.reserve({
      purpose: "BET",
      businessReference: `bet:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 2_500n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.wallet-projection.reserve",
        key: randomUUID(),
        fingerprint: "bet:cash:1000:bonus:1500",
      },
      allocations: [
        { accountId: cashAccountId, amountMinor: 1_000n },
        { accountId: bonusAccountId, amountMinor: 1_500n },
      ],
    });

    const projection = await ledger.getWalletProjection(memberId);
    expect(projection.memberId).toBe(memberId);
    expect(projection.currency).toBe("THB");
    expect(projection.dataAsOf).toBeInstanceOf(Date);
    expect(projection.buckets).toEqual([
      { bucket: "CASH", postedMinor: 4_000n, reservedMinor: 1_000n, availableMinor: 3_000n },
      { bucket: "BONUS", postedMinor: 3_000n, reservedMinor: 1_500n, availableMinor: 1_500n },
      { bucket: "LOCKED", postedMinor: 2_000n, reservedMinor: 0n, availableMinor: 0n },
    ]);
    expect(await ledger.getAvailableMinorUnits(lockedAccountId)).toBe(0n);
  });

  it("blocks betting and withdrawal availability while Member CASH remains negative", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const bonusAccountId = await ledger.ensureMemberAccount(memberId, "BONUS");
    const fundingAccountId = await ledger.ensureSystemAccount(`funding:${randomUUID()}`);
    const recoveryAccountId = await ledger.ensureSystemAccount(`recovery:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_SEED_RECOVERY_POSITION",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.recovery.seed",
        key: randomUUID(),
        fingerprint: "seed:cash:2000:bonus:3000",
      },
      domainReferences: { test: "recovery-debt" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: 5_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 2_000n },
        { accountId: bonusAccountId, side: "CREDIT", amountMinor: 3_000n },
      ],
    });

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_RECOVERY_CHARGEBACK",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.recovery.chargeback",
        key: randomUUID(),
        fingerprint: "chargeback:cash:3000",
      },
      domainReferences: { test: "recovery-debt" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: cashAccountId, side: "DEBIT", amountMinor: 3_000n },
        { accountId: recoveryAccountId, side: "CREDIT", amountMinor: 3_000n },
      ],
    });

    const projection = await ledger.getWalletProjection(memberId);
    expect(projection.buckets).toEqual([
      { bucket: "CASH", postedMinor: -1_000n, reservedMinor: 0n, availableMinor: 0n },
      { bucket: "BONUS", postedMinor: 3_000n, reservedMinor: 0n, availableMinor: 0n },
      { bucket: "LOCKED", postedMinor: 0n, reservedMinor: 0n, availableMinor: 0n },
    ]);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(0n);
    expect(await ledger.getAvailableMinorUnits(bonusAccountId)).toBe(0n);

    await expect(
      ledger.reserve({
        purpose: "BET",
        businessReference: `bet:${randomUUID()}`,
        memberId,
        currency: "THB",
        amountMinor: 1_000n,
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.recovery.bet",
          key: randomUUID(),
          fingerprint: "bet:bonus:1000",
        },
        allocations: [{ accountId: bonusAccountId, amountMinor: 1_000n }],
      }),
    ).rejects.toThrow("Member debt blocks betting and withdrawal availability");

    await expect(
      ledger.reserve({
        purpose: "WITHDRAWAL",
        businessReference: `withdrawal:${randomUUID()}`,
        memberId,
        currency: "THB",
        amountMinor: 1n,
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.recovery.withdrawal",
          key: randomUUID(),
          fingerprint: "withdrawal:cash:1",
        },
        allocations: [{ accountId: cashAccountId, amountMinor: 1n }],
      }),
    ).rejects.toThrow("Member debt blocks betting and withdrawal availability");
  });

  it("atomically consumes the persisted Reservation allocation into one balanced Ledger transaction", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const bonusAccountId = await ledger.ensureMemberAccount(memberId, "BONUS");
    const fundingAccountId = await ledger.ensureSystemAccount(`funding:${randomUUID()}`);
    const bettingSettlementAccountId = await ledger.ensureSystemAccount(
      `betting-settlement:${randomUUID()}`,
    );

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_SEED_MEMBER_BUCKETS",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.seed",
        key: randomUUID(),
        fingerprint: "seed:cash:4000:bonus:3000",
      },
      domainReferences: { test: "reservation-consumption" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: 7_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 4_000n },
        { accountId: bonusAccountId, side: "CREDIT", amountMinor: 3_000n },
      ],
    });

    const reservationId = await ledger.reserve({
      purpose: "BET",
      businessReference: `bet:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 7_000n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.reserve",
        key: randomUUID(),
        fingerprint: "bet:cash:4000:bonus:3000",
      },
      allocations: [
        { accountId: cashAccountId, amountMinor: 4_000n },
        { accountId: bonusAccountId, amountMinor: 3_000n },
      ],
    });

    const consumeInput = {
      reservationId,
      businessTransactionId: randomUUID(),
      operationType: "BET_STAKE_COMMIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.post",
        key: randomUUID(),
        fingerprint: "bet-consume:7000",
      },
      domainReferences: { betOrderId: randomUUID() },
      currency: "THB" as const,
      effectiveAt: new Date(),
      destinations: [{ accountId: bettingSettlementAccountId, amountMinor: 7_000n }],
    };

    const transactionId = await ledger.consumeReservationAndPost(consumeInput);
    const replayTransactionId = await ledger.consumeReservationAndPost(consumeInput);
    expect(replayTransactionId).toBe(transactionId);
    await expect(
      ledger.consumeReservationAndPost({
        ...consumeInput,
        idempotency: {
          ...consumeInput.idempotency,
          fingerprint: "different-consume-payload",
        },
      }),
    ).rejects.toThrow("idempotency conflict");

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      select: { consumedAt: true, releasedAt: true, consumingTransactionId: true },
    });
    expect(reservation.consumedAt).not.toBeNull();
    expect(reservation.releasedAt).toBeNull();
    expect(reservation.consumingTransactionId).toBe(transactionId);

    const consumedTransaction = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: { accountingPeriodId: true },
    });
    expect(consumedTransaction.accountingPeriodId).not.toBeNull();
    await expectAuthoritativeAccountingPeriodLink(transactionId);

    const postings = await prisma.ledgerPosting.findMany({
      where: { transactionId },
      select: { accountId: true, side: true, amountMinor: true },
    });
    expect(postings).toHaveLength(3);
    expect(postings).toEqual(
      expect.arrayContaining([
        { accountId: cashAccountId, side: "DEBIT", amountMinor: 4_000n },
        { accountId: bonusAccountId, side: "DEBIT", amountMinor: 3_000n },
        { accountId: bettingSettlementAccountId, side: "CREDIT", amountMinor: 7_000n },
      ]),
    );
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(0n);
    expect(await ledger.getAvailableMinorUnits(bonusAccountId)).toBe(0n);

    expect(
      await prisma.financialTransaction.count({
        where: {
          idempotencyScope: consumeInput.idempotency.scope,
          idempotencyKey: consumeInput.idempotency.key,
        },
      }),
    ).toBe(1);
  });

  it("does not relabel a BET Reservation as a Withdrawal financial effect", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const fundingAccountId = await ledger.ensureSystemAccount(`funding:${randomUUID()}`);
    const bettingSettlementAccountId = await ledger.ensureSystemAccount(
      `betting-settlement:${randomUUID()}`,
    );

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_SEED_BET_PURPOSE",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.bet-purpose.seed",
        key: randomUUID(),
        fingerprint: "seed:cash:2500",
      },
      domainReferences: { test: "bet-purpose" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: 2_500n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 2_500n },
      ],
    });

    const reservationId = await ledger.reserve({
      purpose: "BET",
      businessReference: `bet:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 2_500n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.bet-purpose.reserve",
        key: randomUUID(),
        fingerprint: "bet:cash:2500",
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 2_500n }],
    });

    await expect(
      ledger.consumeReservationAndPost({
        reservationId,
        businessTransactionId: randomUUID(),
        operationType: "WITHDRAWAL_FINALIZE",
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.consume.bet-purpose.invalid",
          key: randomUUID(),
          fingerprint: "withdrawal-from-bet:2500",
        },
        domainReferences: { betOrderId: randomUUID() },
        currency: "THB",
        effectiveAt: new Date(),
        destinations: [{ accountId: bettingSettlementAccountId, amountMinor: 2_500n }],
      }),
    ).rejects.toThrow("WITHDRAWAL_FINALIZE requires a WITHDRAWAL Reservation");

    expect(
      await prisma.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        select: { consumedAt: true },
      }),
    ).toEqual({ consumedAt: null });
  });

  it("does not relabel a WITHDRAWAL Reservation as a Bet financial effect", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const fundingAccountId = await ledger.ensureSystemAccount(`funding:${randomUUID()}`);
    const payoutAccountId = await ledger.ensureSystemAccount(`payout:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_SEED_WITHDRAWAL_PURPOSE",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.withdrawal-purpose.seed",
        key: randomUUID(),
        fingerprint: "seed:cash:1800",
      },
      domainReferences: { test: "withdrawal-purpose" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: 1_800n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 1_800n },
      ],
    });

    const reservationId = await ledger.reserve({
      purpose: "WITHDRAWAL",
      businessReference: `withdrawal:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 1_800n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.withdrawal-purpose.reserve",
        key: randomUUID(),
        fingerprint: "withdrawal:cash:1800",
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 1_800n }],
    });

    await expect(
      ledger.consumeReservationAndPost({
        reservationId,
        businessTransactionId: randomUUID(),
        operationType: "BET_STAKE_COMMIT",
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.consume.withdrawal-purpose.invalid",
          key: randomUUID(),
          fingerprint: "bet-from-withdrawal:1800",
        },
        domainReferences: { withdrawalId: randomUUID() },
        currency: "THB",
        effectiveAt: new Date(),
        destinations: [{ accountId: payoutAccountId, amountMinor: 1_800n }],
      }),
    ).rejects.toThrow("BET_STAKE_COMMIT requires a BET Reservation");

    expect(
      await prisma.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        select: { consumedAt: true },
      }),
    ).toEqual({ consumedAt: null });
  });

  it("does not consume a released Reservation", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const fundingAccountId = await ledger.ensureSystemAccount(`funding:${randomUUID()}`);
    const payoutAccountId = await ledger.ensureSystemAccount(`payout:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_SEED_WITHDRAWAL",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.released.seed",
        key: randomUUID(),
        fingerprint: "seed:5000",
      },
      domainReferences: { test: "released-reservation" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: 5_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 5_000n },
      ],
    });

    const reservationId = await ledger.reserve({
      purpose: "WITHDRAWAL",
      businessReference: `withdrawal:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 3_000n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.released.reserve",
        key: randomUUID(),
        fingerprint: "withdrawal:3000",
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 3_000n }],
    });
    await ledger.releaseReservation(reservationId);

    const consumeKey = randomUUID();
    await expect(
      ledger.consumeReservationAndPost({
        reservationId,
        businessTransactionId: randomUUID(),
        operationType: "WITHDRAWAL_FINALIZE",
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.consume.released.post",
          key: consumeKey,
          fingerprint: "withdrawal-consume:3000",
        },
        domainReferences: { withdrawalId: randomUUID() },
        currency: "THB",
        effectiveAt: new Date(),
        destinations: [{ accountId: payoutAccountId, amountMinor: 3_000n }],
      }),
    ).rejects.toThrow("Released Reservation cannot be consumed");

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      select: { releasedAt: true, consumedAt: true, consumingTransactionId: true },
    });
    expect(reservation.releasedAt).not.toBeNull();
    expect(reservation.consumedAt).toBeNull();
    expect(reservation.consumingTransactionId).toBeNull();
    expect(
      await prisma.financialTransaction.count({
        where: {
          idempotencyScope: "financial.integration.consume.released.post",
          idempotencyKey: consumeKey,
        },
      }),
    ).toBe(0);
  });

  it("allows only one financial effect when concurrent consumes target the same Reservation", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const fundingAccountId = await ledger.ensureSystemAccount(`funding:${randomUUID()}`);
    const payoutAccountId = await ledger.ensureSystemAccount(`payout:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_SEED_CONCURRENT_CONSUME",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.concurrent.seed",
        key: randomUUID(),
        fingerprint: "seed:6000",
      },
      domainReferences: { test: "concurrent-consume" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: 6_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 6_000n },
      ],
    });

    const reservationId = await ledger.reserve({
      purpose: "WITHDRAWAL",
      businessReference: `withdrawal:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 6_000n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.concurrent.reserve",
        key: randomUUID(),
        fingerprint: "withdrawal:6000",
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 6_000n }],
    });

    const consume = (suffix: string) =>
      ledger.consumeReservationAndPost({
        reservationId,
        businessTransactionId: randomUUID(),
        operationType: "WITHDRAWAL_FINALIZE",
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.consume.concurrent.post",
          key: randomUUID(),
          fingerprint: `withdrawal-consume:${suffix}:6000`,
        },
        domainReferences: { withdrawalId: randomUUID() },
        currency: "THB",
        effectiveAt: new Date(),
        destinations: [{ accountId: payoutAccountId, amountMinor: 6_000n }],
      });

    const results = await Promise.allSettled([consume("a"), consume("b")]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<string> => result.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      select: { consumingTransactionId: true, consumedAt: true },
    });
    const consumingTransactionId = reservation.consumingTransactionId;
    expect(reservation.consumedAt).not.toBeNull();
    expect(consumingTransactionId).toBe(fulfilled[0]?.value);
    if (!consumingTransactionId) {
      throw new Error("Concurrent Reservation consumption did not persist a transaction identity");
    }
    expect(
      await prisma.financialTransaction.count({
        where: { consumedReservations: { some: { id: reservationId } } },
      }),
    ).toBe(1);
    expect(
      await prisma.ledgerPosting.count({
        where: { transactionId: consumingTransactionId },
      }),
    ).toBe(2);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(0n);
  });

  it("rolls back the Ledger transaction if Reservation consumption cannot be finalized", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const fundingAccountId = await ledger.ensureSystemAccount(`funding:${randomUUID()}`);
    const payoutAccountId = await ledger.ensureSystemAccount(`payout:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "TEST_SEED_ROLLBACK",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.rollback.seed",
        key: randomUUID(),
        fingerprint: "seed:4000",
      },
      domainReferences: { test: "consume-rollback" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: fundingAccountId, side: "DEBIT", amountMinor: 4_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 4_000n },
      ],
    });

    const reservationId = await ledger.reserve({
      purpose: "WITHDRAWAL",
      businessReference: `withdrawal:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 4_000n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.consume.rollback.reserve",
        key: randomUUID(),
        fingerprint: "withdrawal:4000",
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 4_000n }],
    });

    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `test_fail_consume_${suffix}`;
    const triggerName = `test_fail_consume_${suffix}`;
    const consumeScope = "financial.integration.consume.rollback.post";
    const consumeKey = randomUUID();

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${reservationId}'::uuid AND NEW.consumed_at IS NOT NULL THEN
          RAISE EXCEPTION 'forced reservation consumption failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE ON "reservations"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);

    try {
      await expect(
        ledger.consumeReservationAndPost({
          reservationId,
          businessTransactionId: randomUUID(),
          operationType: "WITHDRAWAL_FINALIZE",
          correlationId: randomUUID(),
          idempotency: {
            scope: consumeScope,
            key: consumeKey,
            fingerprint: "withdrawal-consume:rollback:4000",
          },
          domainReferences: { withdrawalId: randomUUID() },
          currency: "THB",
          effectiveAt: new Date(),
          destinations: [{ accountId: payoutAccountId, amountMinor: 4_000n }],
        }),
      ).rejects.toThrow("forced reservation consumption failure");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "reservations"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      select: { consumedAt: true, consumingTransactionId: true, releasedAt: true },
    });
    expect(reservation.consumedAt).toBeNull();
    expect(reservation.consumingTransactionId).toBeNull();
    expect(reservation.releasedAt).toBeNull();
    expect(
      await prisma.financialTransaction.count({
        where: { idempotencyScope: consumeScope, idempotencyKey: consumeKey },
      }),
    ).toBe(0);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(0n);
  });
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { automaticWeeklyAccountingPeriodBounds } from "../../src/contexts/wallet-ledger/domain/accounting-period";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runBackfillMigration = process.env.RUN_ACCOUNTING_PERIOD_BACKFILL_TEST === "1";
const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260905094500_accounting_period_backfill_verify/migration.sql",
);

describe.runIf(runBackfillMigration)("Accounting Period historical backfill migration", () => {
  let prisma: PrismaService;
  const scopePrefix = `accounting-period-backfill.${randomUUID()}`;
  const accountCodePrefix = `accounting-period-backfill:${randomUUID()}`;
  const periodStartsToClean = new Set<number>();

  function executeBackfillMigration(): void {
    const historicalSql = readFileSync(migrationPath, "utf8");
    const replaySql = historicalSql.replace(
      'ON CONFLICT ("effective_start", "effective_end") DO NOTHING;',
      "ON CONFLICT DO NOTHING;",
    );
    if (replaySql === historicalSql) {
      throw new Error("Historical Accounting Period backfill conflict clause was not found");
    }
    execFileSync("pnpm", ["exec", "prisma", "db", "execute", "--stdin"], {
      cwd: process.cwd(),
      env: process.env,
      input: replaySql,
      stdio: "pipe",
    });
  }

  async function createSystemAccounts(label: string): Promise<{ debitId: string; creditId: string }> {
    const [debit, credit] = await Promise.all([
      prisma.ledgerAccount.create({
        data: {
          kind: "SYSTEM",
          systemCode: `${accountCodePrefix}:${label}:debit`,
          currency: "THB",
        },
        select: { id: true },
      }),
      prisma.ledgerAccount.create({
        data: {
          kind: "SYSTEM",
          systemCode: `${accountCodePrefix}:${label}:credit`,
          currency: "THB",
        },
        select: { id: true },
      }),
    ]);
    return { debitId: debit.id, creditId: credit.id };
  }

  async function createHistoricalTransaction(input: {
    label: string;
    postedAt: Date;
    effectiveAt: Date;
    debitAccountId: string;
    creditAccountId: string;
    amountMinor: bigint;
    correctionKind?: "REVERSAL" | "COMPENSATION";
    correctsTransactionId?: string;
    accountingPeriodId?: string;
  }): Promise<string> {
    const transactionId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "financial_transactions" (
        "id",
        "business_transaction_id",
        "operation_type",
        "correlation_id",
        "idempotency_scope",
        "idempotency_key",
        "fingerprint",
        "domain_references",
        "currency",
        "effective_at",
        "posted_at",
        "accounting_period_id",
        "correction_kind",
        "corrects_transaction_id",
        "created_at"
      ) VALUES (
        ${transactionId}::uuid,
        ${`${scopePrefix}.business.${input.label}`},
        ${input.correctionKind ?? "DEPOSIT_CREDIT"},
        ${`${scopePrefix}.correlation.${input.label}`},
        ${`${scopePrefix}.${input.label}`},
        ${randomUUID()},
        ${`${input.label}:${input.amountMinor}`},
        ${JSON.stringify({ migrationTest: input.label })}::jsonb,
        'THB',
        ${input.effectiveAt},
        ${input.postedAt},
        ${input.accountingPeriodId ?? null}::uuid,
        ${input.correctionKind ?? null},
        ${input.correctsTransactionId ?? null}::uuid,
        ${input.postedAt}
      )
    `;
    await prisma.ledgerPosting.createMany({
      data: [
        {
          transactionId,
          accountId: input.debitAccountId,
          side: "DEBIT",
          amountMinor: input.amountMinor,
          createdAt: input.postedAt,
        },
        {
          transactionId,
          accountId: input.creditAccountId,
          side: "CREDIT",
          amountMinor: input.amountMinor,
          createdAt: input.postedAt,
        },
      ],
    });
    const bounds = automaticWeeklyAccountingPeriodBounds(input.postedAt);
    periodStartsToClean.add(bounds.start.getTime());
    return transactionId;
  }

  async function transactionSnapshot() {
    return prisma.financialTransaction.findMany({
      where: { idempotencyScope: { startsWith: scopePrefix } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        businessTransactionId: true,
        operationType: true,
        correlationId: true,
        idempotencyScope: true,
        idempotencyKey: true,
        fingerprint: true,
        domainReferences: true,
        currency: true,
        effectiveAt: true,
        postedAt: true,
        correctionKind: true,
        correctsTransactionId: true,
        createdAt: true,
      },
    });
  }

  async function postingSnapshot() {
    return prisma.ledgerPosting.findMany({
      where: { transaction: { idempotencyScope: { startsWith: scopePrefix } } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        transactionId: true,
        accountId: true,
        side: true,
        amountMinor: true,
        createdAt: true,
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    // This suite replays the historical backfill migration against the current
    // schema. Temporarily disable only the later close-finality guards so the
    // migration is evaluated under the invariants that existed when it shipped.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "accounting_periods" DISABLE TRIGGER "accounting_periods_close_transition_guard"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "accounting_periods" DISABLE TRIGGER "accounting_periods_closed_finality_guard"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "financial_transactions" ALTER COLUMN "accounting_period_id" DROP NOT NULL',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "financial_transactions" DISABLE TRIGGER "financial_transactions_accounting_period_membership"',
    );
  });

  afterAll(async () => {
    const transactions = await prisma.financialTransaction.findMany({
      where: { idempotencyScope: { startsWith: scopePrefix } },
      select: { id: true },
    });
    const transactionIds = transactions.map((transaction) => transaction.id);
    if (transactionIds.length > 0) {
      await prisma.ledgerPosting.deleteMany({ where: { transactionId: { in: transactionIds } } });
      await prisma.financialTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    }
    await prisma.ledgerAccount.deleteMany({
      where: { systemCode: { startsWith: accountCodePrefix } },
    });
    const starts = [...periodStartsToClean].map((value) => new Date(value));
    if (starts.length > 0) {
      await prisma.accountingPeriod.deleteMany({ where: { effectiveStart: { in: starts } } });
    }
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "accounting_periods" ENABLE TRIGGER "accounting_periods_closed_finality_guard"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "accounting_periods" ENABLE TRIGGER "accounting_periods_close_transition_guard"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "financial_transactions" ENABLE TRIGGER "financial_transactions_accounting_period_membership"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "financial_transactions" ALTER COLUMN "accounting_period_id" SET NOT NULL',
    );
    await prisma.$disconnect();
  });

  it("backfills deterministic Bangkok weeks by postedAt, preserves financial history, and reruns idempotently", async () => {
    const accounts = await createSystemAccounts("success");
    const preBoundary = new Date("2017-03-05T16:59:59.999Z");
    const exactBoundary = new Date("2017-03-05T17:00:00.000Z");
    const sameWeek = new Date("2017-03-06T09:30:00.000Z");
    const laterBoundary = new Date("2017-03-19T17:00:00.000Z");

    const originalId = await createHistoricalTransaction({
      label: "pre-boundary",
      postedAt: preBoundary,
      effectiveAt: new Date("2010-01-01T00:00:00.000Z"),
      debitAccountId: accounts.debitId,
      creditAccountId: accounts.creditId,
      amountMinor: 1_000n,
    });
    const exactBoundaryId = await createHistoricalTransaction({
      label: "exact-boundary",
      postedAt: exactBoundary,
      effectiveAt: new Date("2001-01-01T00:00:00.000Z"),
      debitAccountId: accounts.debitId,
      creditAccountId: accounts.creditId,
      amountMinor: 2_000n,
    });
    await createHistoricalTransaction({
      label: "correction",
      postedAt: sameWeek,
      effectiveAt: new Date("2030-01-01T00:00:00.000Z"),
      debitAccountId: accounts.creditId,
      creditAccountId: accounts.debitId,
      amountMinor: 1_000n,
      correctionKind: "REVERSAL",
      correctsTransactionId: originalId,
    });
    await createHistoricalTransaction({
      label: "later-boundary",
      postedAt: laterBoundary,
      effectiveAt: new Date("2005-06-01T12:00:00.000Z"),
      debitAccountId: accounts.debitId,
      creditAccountId: accounts.creditId,
      amountMinor: 3_000n,
    });

    const transactionsBefore = await transactionSnapshot();
    const postingsBefore = await postingSnapshot();

    executeBackfillMigration();

    expect(await transactionSnapshot()).toEqual(transactionsBefore);
    expect(await postingSnapshot()).toEqual(postingsBefore);

    const linked = await prisma.financialTransaction.findMany({
      where: { idempotencyScope: { startsWith: scopePrefix } },
      orderBy: { id: "asc" },
      select: {
        id: true,
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
    expect(linked).toHaveLength(4);
    for (const transaction of linked) {
      const expected = automaticWeeklyAccountingPeriodBounds(transaction.postedAt);
      expect(transaction.accountingPeriodId).not.toBeNull();
      expect(transaction.accountingPeriod).toMatchObject({
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: expected.start,
        effectiveEnd: expected.end,
        state: "CLOSED",
      });
    }

    const exact = linked.find((transaction) => transaction.id === exactBoundaryId);
    expect(exact).toBeDefined();
    expect(exact?.accountingPeriod?.effectiveStart).toEqual(exactBoundary);
    expect(exact?.effectiveAt.getTime()).toBeLessThan(exactBoundary.getTime());

    const firstLinks = new Map(linked.map((transaction) => [transaction.id, transaction.accountingPeriodId]));
    const distinctPeriodIds = new Set(linked.map((transaction) => transaction.accountingPeriodId));
    expect(distinctPeriodIds.size).toBe(3);

    executeBackfillMigration();

    const rerun = await prisma.financialTransaction.findMany({
      where: { idempotencyScope: { startsWith: scopePrefix } },
      orderBy: { id: "asc" },
      select: { id: true, accountingPeriodId: true },
    });
    expect(new Map(rerun.map((transaction) => [transaction.id, transaction.accountingPeriodId]))).toEqual(
      firstLinks,
    );

    const dbClock = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT transaction_timestamp() AS "now"
    `;
    const currentBounds = automaticWeeklyAccountingPeriodBounds(dbClock[0]!.now);
    const nextBounds = automaticWeeklyAccountingPeriodBounds(currentBounds.end);
    const runtimePeriods = await prisma.accountingPeriod.findMany({
      where: { effectiveStart: { in: [currentBounds.start, nextBounds.start] } },
      orderBy: { effectiveStart: "asc" },
      select: { effectiveStart: true, effectiveEnd: true, state: true },
    });
    expect(runtimePeriods).toEqual([
      { effectiveStart: currentBounds.start, effectiveEnd: currentBounds.end, state: "OPEN" },
      { effectiveStart: nextBounds.start, effectiveEnd: nextBounds.end, state: "SCHEDULED" },
    ]);

    const overlaps = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "accounting_periods" left_period
      JOIN "accounting_periods" right_period
        ON left_period."id" < right_period."id"
        AND left_period."effective_start" < right_period."effective_end"
        AND right_period."effective_start" < left_period."effective_end"
      WHERE left_period."state" IN ('SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED')
        AND right_period."state" IN ('SCHEDULED', 'OPEN', 'CLOSING', 'CLOSED')
    `;
    expect(overlaps[0]?.count).toBe(0n);
  });

  it("rolls back the backfill when an existing authoritative link fails verification", async () => {
    const accounts = await createSystemAccounts("rollback");
    const postedAt = new Date("2016-11-13T17:00:00.000Z");
    const correctBounds = automaticWeeklyAccountingPeriodBounds(postedAt);
    const wrongBounds = automaticWeeklyAccountingPeriodBounds(
      new Date(correctBounds.start.getTime() - 1),
    );
    periodStartsToClean.add(wrongBounds.start.getTime());
    periodStartsToClean.add(correctBounds.start.getTime());

    const wrongPeriod = await prisma.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: wrongBounds.start,
        effectiveEnd: wrongBounds.end,
        state: "CLOSED",
      },
      select: { id: true, state: true, version: true },
    });
    const transactionId = await createHistoricalTransaction({
      label: "invalid-existing-link",
      postedAt,
      effectiveAt: new Date("2000-01-01T00:00:00.000Z"),
      debitAccountId: accounts.debitId,
      creditAccountId: accounts.creditId,
      amountMinor: 4_000n,
      accountingPeriodId: wrongPeriod.id,
    });

    expect(() => executeBackfillMigration()).toThrow();

    const transaction = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: { accountingPeriodId: true },
    });
    expect(transaction.accountingPeriodId).toBe(wrongPeriod.id);
    expect(
      await prisma.accountingPeriod.findFirst({
        where: {
          effectiveStart: correctBounds.start,
          effectiveEnd: correctBounds.end,
        },
      }),
    ).toBeNull();
    expect(await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: wrongPeriod.id } })).toMatchObject(
      {
        state: wrongPeriod.state,
        version: wrongPeriod.version,
      },
    );
  });
});

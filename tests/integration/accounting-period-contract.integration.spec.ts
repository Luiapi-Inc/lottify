import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runContractMigration = process.env.RUN_ACCOUNTING_PERIOD_CONTRACT_TEST === "1";
const contractMigrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260905101500_accounting_period_contract/migration.sql",
);
const backfillMigrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260905094500_accounting_period_backfill_verify/migration.sql",
);

describe.runIf(runContractMigration)("Accounting Period contract migration", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  const idempotencyPrefix = `accounting-period-contract.${randomUUID()}`;
  const accountCodePrefix = `accounting-period-contract:${randomUUID()}`;
  const accountIdsToClean = new Set<string>();

  function executeMigration(path: string): void {
    execFileSync("pnpm", ["exec", "prisma", "db", "execute", "--file", path], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });
  }

  async function setLinkageNullable(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "financial_transactions" ALTER COLUMN "accounting_period_id" DROP NOT NULL',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "financial_transactions" DISABLE TRIGGER "financial_transactions_accounting_period_membership"',
    );
  }

  async function isLinkageNullable(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ isNullable: "YES" | "NO" }>>`
      SELECT "is_nullable" AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'financial_transactions'
        AND column_name = 'accounting_period_id'
    `;
    return rows[0]?.isNullable === "YES";
  }

  async function postBalanced(label: string): Promise<string> {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`${accountCodePrefix}:${label}`);
    accountIdsToClean.add(cashAccountId);
    accountIdsToClean.add(providerAccountId);
    return ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: `${idempotencyPrefix}.${label}`,
        key: randomUUID(),
        fingerprint: `${label}:1000`,
      },
      domainReferences: { migrationTest: label },
      currency: "THB",
      effectiveAt: new Date("2000-01-01T00:00:00.000Z"),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 1_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 1_000n },
      ],
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    ledger = new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(prisma, new DatabaseAccountingPeriodTransactionClock()),
    );
    await prisma.$connect();
  });

  afterAll(async () => {
    const transactions = await prisma.financialTransaction.findMany({
      where: { idempotencyScope: { startsWith: idempotencyPrefix } },
      select: { id: true },
    });
    const transactionIds = transactions.map((transaction) => transaction.id);
    if (transactionIds.length > 0) {
      await prisma.ledgerPosting.deleteMany({ where: { transactionId: { in: transactionIds } } });
      await prisma.financialTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    }
    const accountIds = [...accountIdsToClean];
    if (accountIds.length > 0) {
      await prisma.ledgerAccount.deleteMany({ where: { id: { in: accountIds } } });
    }
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "financial_transactions" ENABLE TRIGGER "financial_transactions_accounting_period_membership"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "financial_transactions" ALTER COLUMN "accounting_period_id" SET NOT NULL',
    );
    await prisma.$disconnect();
  });

  it("supports the pre-contract writer, contracts to NOT NULL, and keeps the post-contract writer green", async () => {
    await setLinkageNullable();
    expect(await isLinkageNullable()).toBe(true);

    const beforeContractId = await postBalanced("before-contract");
    const beforeContract = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: beforeContractId },
      select: { accountingPeriodId: true },
    });
    expect(beforeContract.accountingPeriodId).toBeTruthy();

    executeMigration(contractMigrationPath);
    expect(await isLinkageNullable()).toBe(false);

    const afterContractId = await postBalanced("after-contract");
    const afterContract = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: afterContractId },
      select: { accountingPeriodId: true },
    });
    expect(afterContract.accountingPeriodId).toBeTruthy();
  });

  it("refuses contract while a pre-existing Financial Transaction is unassigned and succeeds after governed repair", async () => {
    await setLinkageNullable();
    const transactionId = await postBalanced("null-precondition");
    await prisma.$executeRaw`
      UPDATE "financial_transactions"
      SET "accounting_period_id" = NULL
      WHERE "id" = ${transactionId}::uuid
    `;

    expect(() => executeMigration(contractMigrationPath)).toThrow();
    expect(await isLinkageNullable()).toBe(true);
    expect(
      await prisma.financialTransaction.findUniqueOrThrow({
        where: { id: transactionId },
        select: { accountingPeriodId: true },
      }),
    ).toEqual({ accountingPeriodId: null });

    executeMigration(backfillMigrationPath);
    executeMigration(contractMigrationPath);
    expect(await isLinkageNullable()).toBe(false);
    expect(
      await prisma.financialTransaction.findUniqueOrThrow({
        where: { id: transactionId },
        select: { accountingPeriodId: true },
      }),
    ).not.toEqual({ accountingPeriodId: null });
  });

  it("rejects overlapping effective Accounting Period coverage while allowing non-effective proposals", async () => {
    const current = await prisma.accountingPeriod.findFirstOrThrow({
      where: { state: "OPEN" },
      select: { effectiveStart: true, effectiveEnd: true },
    });
    const draftId = randomUUID();
    const draftStart = new Date(current.effectiveStart.getTime() + 60_000);
    const draftEnd = new Date(current.effectiveEnd.getTime() - 60_000);
    await prisma.accountingPeriod.create({
      data: {
        id: draftId,
        mode: "CUSTOM",
        generationKind: "CUSTOM",
        effectiveStart: draftStart,
        effectiveEnd: draftEnd,
        state: "DRAFT",
      },
    });
    try {
      await expect(
        prisma.accountingPeriod.create({
          data: {
            mode: "CUSTOM",
            generationKind: "CUSTOM",
            effectiveStart: new Date(current.effectiveStart.getTime() + 120_000),
            effectiveEnd: new Date(current.effectiveEnd.getTime() - 120_000),
            state: "SCHEDULED",
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.accountingPeriod.delete({ where: { id: draftId } });
    }
  });

  it("rejects a Financial Transaction reference whose Accounting Period does not contain postedAt", async () => {
    const transactionId = await postBalanced("invalid-range-reference");
    const transaction = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: { postedAt: true, accountingPeriodId: true },
    });
    const wrongPeriod = await prisma.accountingPeriod.findFirstOrThrow({
      where: {
        id: { not: transaction.accountingPeriodId },
        OR: [
          { effectiveEnd: { lte: transaction.postedAt } },
          { effectiveStart: { gt: transaction.postedAt } },
        ],
      },
      select: { id: true },
    });

    await expect(
      prisma.$executeRaw`
        UPDATE "financial_transactions"
        SET "accounting_period_id" = ${wrongPeriod.id}::uuid
        WHERE "id" = ${transactionId}::uuid
      `,
    ).rejects.toThrow();

    expect(
      await prisma.financialTransaction.findUniqueOrThrow({
        where: { id: transactionId },
        select: { accountingPeriodId: true },
      }),
    ).toEqual({ accountingPeriodId: transaction.accountingPeriodId });
  });
});

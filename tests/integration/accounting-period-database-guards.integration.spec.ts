import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

/**
 * The authoritative-Accounting-Period rules are enforced by database triggers, not by application code.
 * A shared development database can therefore drift away from prisma/migrations without any signal:
 * `prisma migrate status` only compares the migration ledger, and a reverted trigger function body still
 * leaves the ledger "up to date". When that happens, suites that assert the invariant fail against the
 * shared database while staying green on CI (fresh Postgres), which reads like a flaky or data-polluted test.
 *
 * This suite pins the deployed schema itself: every fixture is created inside a transaction that is always
 * rolled back, so it depends on neither accumulated data nor other suites. A drifted database fails here
 * with the invariant named, instead of surfacing deep inside an unrelated end-to-end assertion.
 */
const CLOSED_PERIOD_START = new Date("2299-01-01T17:00:00.000Z");
const CLOSED_PERIOD_END = new Date("2299-01-02T17:00:00.000Z");
const OPEN_PERIOD_START = new Date("2299-01-03T17:00:00.000Z");
const OPEN_PERIOD_END = new Date("2299-01-04T17:00:00.000Z");

/** Thrown to force the surrounding interactive transaction to roll its fixtures back. */
class RollbackFixture extends Error {}

describe.runIf(runIntegration)("Accounting Period database guards", () => {
  const prisma = new PrismaService();
  const closedPeriodId = randomUUID();
  const openPeriodId = randomUUID();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function periodFixture(
    id: string,
    state: string,
    effectiveStart: Date,
    effectiveEnd: Date,
  ) {
    return {
      id,
      mode: "CUSTOM",
      generationKind: "CUSTOM",
      effectiveStart,
      effectiveEnd,
      state,
      version: 3,
    };
  }

  function transactionFixture(accountingPeriodId: string, postedAt: Date) {
    return {
      businessTransactionId: `accounting-period-guard-${randomUUID()}`,
      operationType: "TEST_ACCOUNTING_PERIOD_GUARD_POST",
      correlationId: randomUUID(),
      idempotencyScope: "test.accounting-period-guard.post",
      idempotencyKey: randomUUID(),
      fingerprint: createHash("sha256").update(randomUUID()).digest("hex"),
      domainReferences: { source: "accounting-period-database-guards-spec" },
      currency: "THB",
      effectiveAt: postedAt,
      postedAt,
      accountingPeriodId,
    };
  }

  async function rollBackAfter<T>(
    body: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let value: T | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        value = await body(tx);
        throw new RollbackFixture();
      });
    } catch (error) {
      if (!(error instanceof RollbackFixture)) {
        throw error;
      }
    }
    return value as T;
  }

  it("rejects a Financial Transaction posted into a CLOSED authoritative Accounting Period", async () => {
    await expect(
      rollBackAfter(async (tx) => {
        await tx.accountingPeriod.create({
          data: periodFixture(
            closedPeriodId,
            "CLOSED",
            CLOSED_PERIOD_START,
            CLOSED_PERIOD_END,
          ),
        });
        return tx.financialTransaction.create({
          data: transactionFixture(
            closedPeriodId,
            new Date("2299-01-02T00:00:00.000Z"),
          ),
        });
      }),
    ).rejects.toThrow(/authoritative OPEN Accounting Period/);
  });

  it("accepts a Financial Transaction posted inside an OPEN authoritative Accounting Period", async () => {
    const posted = await rollBackAfter(async (tx) => {
      await tx.accountingPeriod.create({
        data: periodFixture(
          openPeriodId,
          "OPEN",
          OPEN_PERIOD_START,
          OPEN_PERIOD_END,
        ),
      });
      const transaction = await tx.financialTransaction.create({
        data: transactionFixture(
          openPeriodId,
          new Date("2299-01-04T00:00:00.000Z"),
        ),
      });
      return transaction.accountingPeriodId;
    });

    expect(posted).toBe(openPeriodId);
  });

  it("treats a CLOSED Accounting Period as terminal", async () => {
    await expect(
      rollBackAfter(async (tx) => {
        await tx.accountingPeriod.create({
          data: periodFixture(
            closedPeriodId,
            "CLOSED",
            CLOSED_PERIOD_START,
            CLOSED_PERIOD_END,
          ),
        });
        return tx.accountingPeriod.update({
          where: { id: closedPeriodId },
          data: { state: "OPEN" },
        });
      }),
    ).rejects.toThrow(/CLOSED Accounting Period is terminal/);
  });
});

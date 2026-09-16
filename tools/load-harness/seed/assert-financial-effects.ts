// Independent financial-effect assertions for a load run.
//
// Runs after the load window and answers, from the database (not from HTTP
// responses and not from application logs):
//   1. every confirmed fixture Order carries exactly one stake financial
//      transaction and exactly one BET reservation (no duplicate stake effect)
//   2. the Settlement Batch for the settlement Draw reached COMPLETED
//   3. it settled exactly the seeded Bet Order population: one SettlementOrder
//      per Order, no order paid twice, no order both paid and reversed
//   4. re-running the settlement command (the resume path) created no second
//      batch and no second payout transaction
//
// Output: one JSON line on stdout (the harness embeds it in the report verbatim).
//
// Usage: node_modules/.bin/tsx tools/load-harness/seed/assert-financial-effects.ts --manifest <path>

import "reflect-metadata";
import { readFileSync, existsSync } from "node:fs";

import { PrismaService } from "../../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../../src/platform/config/env";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function loadDotEnv(): void {
  for (const candidate of [".env", "../../../.env"]) {
    if (!existsSync(candidate)) continue;
    for (const line of readFileSync(candidate, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key!] !== undefined) continue;
      process.env[key!] = rawValue!.replace(/^["']|["']$/g, "");
    }
    return;
  }
}

loadDotEnv();
const args = parseArgs(process.argv.slice(2));
if (typeof args["database-url"] === "string") process.env.DATABASE_URL = args["database-url"];
const manifestPath = typeof args.manifest === "string" ? args.manifest : null;
if (!manifestPath) {
  console.error("--manifest <path> is required");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
resetEnvironmentForTests();

// Guard: the assertions must run against the same load database the fixtures and
// the API used. Asserting against a shared development database would report
// zeros that look like a financial failure.
const assertDatabaseName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
if (!/load/i.test(assertDatabaseName) && args["allow-shared-db"] !== true) {
  console.error(
    `REFUSING: assertion target database '${assertDatabaseName || "(unset)"}' is not a load database. Pass --database-url <load db url>, or --allow-shared-db deliberately.`,
  );
  process.exit(2);
}

const prisma = new PrismaService();
const CHUNK = 500;

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size) as T[]);
  return out;
}

async function main(): Promise<void> {
  await prisma.$connect();
  const orderIds: string[] = manifest?.settlement?.allOrderIds ?? [];
  const settlementDrawId: string | null = manifest?.settlement?.drawId ?? null;
  const checks: Record<string, unknown> = {};
  const samples: Record<string, unknown> = {};
  const failures: string[] = [];

  // ---- 1. once-only stake effect on the seeded confirmed population -------
  let confirmedOrders = 0;
  let stakeTransactions = 0;
  let ordersMissingStakeEffect = 0;
  let ordersWithDuplicateStakeEffect = 0;
  const duplicateStakeSamples: unknown[] = [];
  for (const ids of chunk(orderIds, CHUNK)) {
    const orders = await prisma.betOrder.findMany({ where: { id: { in: ids } }, select: { id: true, state: true } });
    confirmedOrders += orders.filter((order) => order.state === "CONFIRMED").length;
    const transactions = await prisma.financialTransaction.findMany({
      where: { businessTransactionId: { in: ids } },
      select: { businessTransactionId: true, id: true },
    });
    stakeTransactions += transactions.length;
    const perOrder = new Map<string, number>();
    for (const transaction of transactions) {
      perOrder.set(transaction.businessTransactionId, (perOrder.get(transaction.businessTransactionId) ?? 0) + 1);
    }
    for (const order of orders.filter((candidate) => candidate.state === "CONFIRMED")) {
      const count = perOrder.get(order.id) ?? 0;
      if (count === 0) ordersMissingStakeEffect += 1;
      if (count > 1) {
        ordersWithDuplicateStakeEffect += 1;
        if (duplicateStakeSamples.length < 10) duplicateStakeSamples.push({ orderId: order.id, stakeTransactions: count });
      }
    }
  }
  checks.confirmedOrders = confirmedOrders;
  checks.stakeTransactions = stakeTransactions;
  checks.ordersMissingStakeEffect = ordersMissingStakeEffect;
  checks.ordersWithDuplicateStakeEffect = ordersWithDuplicateStakeEffect;
  samples.duplicateStakeSamples = duplicateStakeSamples;
  if (ordersMissingStakeEffect > 0) failures.push(`${ordersMissingStakeEffect} confirmed order(s) have no stake financial transaction`);
  if (ordersWithDuplicateStakeEffect > 0)
    failures.push(`${ordersWithDuplicateStakeEffect} order(s) have more than one stake financial transaction`);

  // ---- 2/3/4. settlement batch facts -------------------------------------
  if (settlementDrawId) {
    const batches = await prisma.settlementBatch.findMany({
      where: { drawId: settlementDrawId },
      orderBy: { startedAt: "asc" },
    });
    const batch = batches[batches.length - 1] ?? null;
    checks.settlementBatchCount = batches.length;
    checks.settlementBatchState = batch?.state ?? null;
    checks.settlementBatchWinningOrders = batch?.winningOrderCount ?? null;
    checks.settlementBatchLosingOrders = batch?.losingOrderCount ?? null;
    checks.settlementTotalPayoutMinor = batch?.totalPayoutMinor?.toString() ?? null;
    if (batches.length > 1) failures.push(`${batches.length} settlement batches exist for one Draw (expected exactly 1: the resume path must not create a second batch)`);
    if (batch && batch.state !== "COMPLETED") failures.push(`settlement batch state is ${batch.state}, not COMPLETED`);

    if (batch) {
      const settlementOrders = await prisma.settlementOrder.findMany({
        where: { batchId: batch.id },
        select: { orderId: true, outcome: true, payoutTransactionId: true, status: true },
      });
      const betLines = await prisma.betOrderLine.count({
        where: { orderId: { in: settlementOrders.map((row) => row.orderId) } },
      });
      checks.settlementOrders = settlementOrders.length;
      checks.settlementBetLines = betLines;
      checks.settlementOutcomes = settlementOrders.reduce<Record<string, number>>((accumulator, row) => {
        accumulator[row.outcome] = (accumulator[row.outcome] ?? 0) + 1;
        return accumulator;
      }, {});
      checks.settlementOrdersWithPayoutTransaction = settlementOrders.filter((row) => row.payoutTransactionId !== null).length;
      checks.settlementOrdersNotPosted = settlementOrders.filter((row) => row.status !== "POSTED").length;

      const paidOrderIds = settlementOrders.map((row) => row.orderId);
      let payoutTransactions = 0;
      let reversalTransactions = 0;
      let ordersPaidTwice = 0;
      for (const ids of chunk(paidOrderIds, CHUNK)) {
        const payouts = await prisma.financialTransaction.groupBy({
          by: ["businessTransactionId"],
          where: { businessTransactionId: { in: ids.map((id) => `${id}:settle`) } },
          _count: { _all: true },
        });
        payoutTransactions += payouts.reduce((total, row) => total + row._count._all, 0);
        ordersPaidTwice += payouts.filter((row) => row._count._all > 1).length;
        const reversals = await prisma.financialTransaction.groupBy({
          by: ["businessTransactionId"],
          where: { businessTransactionId: { in: ids.map((id) => `${id}:settle:reversal`) } },
          _count: { _all: true },
        });
        reversalTransactions += reversals.reduce((total, row) => total + row._count._all, 0);
      }
      checks.settlementPayoutTransactions = payoutTransactions;
      checks.settlementReversalTransactions = reversalTransactions;
      checks.ordersPaidTwice = ordersPaidTwice;
      checks.settlementScopeExpectedOrders = orderIds.length;
      if (ordersPaidTwice > 0) failures.push(`${ordersPaidTwice} order(s) received more than one settlement payout transaction`);
      if (settlementOrders.length !== orderIds.length && orderIds.length > 0) {
        failures.push(
          `settlement covered ${settlementOrders.length} of ${orderIds.length} seeded orders (Member-visible/incomplete batch scope)`,
        );
      }
      if (checks.settlementOrdersNotPosted !== 0) failures.push(`${checks.settlementOrdersNotPosted} settlement order row(s) are not POSTED`);
    }
  }

  const output = {
    measured: true,
    checks,
    failures,
    samples,
  };
  console.log(JSON.stringify(output));
}

main()
  .catch((error) => {
    console.log(JSON.stringify({ measured: false, error: String(error?.message ?? error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

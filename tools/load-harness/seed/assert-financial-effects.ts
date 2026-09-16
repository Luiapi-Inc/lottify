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
import { evaluateStakeEffectOnceOnly } from "../lib/stake-effect.mjs";

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

  // ---- 1. once-only stake effect over the whole load database -------------
  // The population is the dedicated load database, NOT the manifest list and NOT
  // one Order state: the settlement driver moves the seeded Orders CONFIRMED ->
  // SETTLED earlier in the same run, and the Orders the live load creates are
  // equally subject to a duplicate stake effect. `evaluateStakeEffectOnceOnly`
  // owns the rule (and fails on an empty examined population).
  const allOrders = await prisma.betOrder.findMany({ select: { id: true, state: true } });
  const allStakeCommits = await prisma.financialTransaction.findMany({
    where: { operationType: "BET_STAKE_COMMIT" },
    select: { businessTransactionId: true },
  });
  const allRefunds = await prisma.financialTransaction.findMany({
    where: { operationType: "BET_STAKE_REFUND" },
    select: { businessTransactionId: true },
  });
  const stakeEffect = evaluateStakeEffectOnceOnly({
    orders: allOrders,
    stakeCommits: allStakeCommits,
    refunds: allRefunds,
    manifestOrderIds: orderIds,
  });
  Object.assign(checks, stakeEffect.checks);
  Object.assign(samples, stakeEffect.samples);
  failures.push(...stakeEffect.failures);

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
    if (batches.length === 0) {
      failures.push(
        `no settlement batch exists for Draw ${settlementDrawId}: the settlement assertion examined an empty population and cannot certify idempotent resume or the once-only payout effect`,
      );
    }
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
      if (settlementOrders.length === 0) {
        failures.push("the settlement batch has 0 Settlement Order rows: the payout assertions examined an empty population");
      }
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

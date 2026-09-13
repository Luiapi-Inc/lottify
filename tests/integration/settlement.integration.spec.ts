// Deterministic integration evidence for the Result & Settlement vertical
// (Issue 19 vertical 4) against a real PostgreSQL database.
//
// Covered acceptance criteria:
//   - Settlement evaluates confirmed Bet Lines against a validated Result and
//     posts once-only financial effects (matching / mismatch);
//   - the Settlement Batch is durable and incremental; its Member-visible
//     outcome is authoritative only on COMPLETED;
//   - idempotency / replay: re-running a batch never duplicates a payout;
//   - crash recovery: a batch resuming from a durable POSTING checkpoint does
//     not re-post an already-posted payout;
//   - Result correction is a dedicated immutable correction workflow (new
//     revision + compensating postings + re-settlement), never a result edit.
//
// These tests must never double-pay: every financial assertion is a count and a
// balance, not just a status code.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { LotteryDrawService } from "../../src/contexts/lottery/application/lottery-draw.service";
import { BettingQuoteService } from "../../src/contexts/betting/application/betting-quote.service";
import { BettingOrderService } from "../../src/contexts/betting/application/betting-order.service";
import { BettingQuoteDrawAdapter } from "../../src/platform/integration/quote-draw.adapter";
import { BetOrderWalletAdapter } from "../../src/platform/integration/betting-order-wallet.adapter";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { SettlementService } from "../../src/contexts/result-settlement/application/settlement.service";
import { PrismaSettlementRepository } from "../../src/contexts/result-settlement/infrastructure/prisma-settlement.repository";
import { LocalResultProviderAdapter } from "../../src/contexts/result-settlement/infrastructure/local-result-provider.adapter";
import { SettlementWalletAdapter } from "../../src/platform/integration/settlement-wallet.adapter";
import { SettlementDrawAdapter } from "../../src/platform/integration/settlement-draw.adapter";
import { SettlementOrdersAdapter } from "../../src/platform/integration/settlement-orders.adapter";
import { allowBetEligibility } from "../support/betting-eligibility.fake";
import { settlementFingerprint } from "../../src/contexts/result-settlement/application/settlement.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Result intake + Settlement Batch + Refund/correction", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let draws: LotteryDrawService;
  let quotes: BettingQuoteService;
  let orders: BettingOrderService;
  let settlement: SettlementService;
  let adminId: string;
  let sessionId: string;

  const memberIds: string[] = [];
  const productIds: string[] = [];
  const betTypeIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeVersionIds: string[] = [];
  const drawIds: string[] = [];
  const settlementBatchIds: string[] = [];

  const actor = () => ({ adminId, sessionId, role: "ADMIN" as const });

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(
        prisma,
        new DatabaseAccountingPeriodTransactionClock(),
      ),
    );
    draws = new LotteryDrawService(prisma);
    const drawAdapter = new BettingQuoteDrawAdapter(prisma);
    quotes = new BettingQuoteService(prisma, drawAdapter, allowBetEligibility);
    orders = new BettingOrderService(
      prisma,
      drawAdapter,
      new BetOrderWalletAdapter(ledger, prisma),
      allowBetEligibility,
    );
    const resultProvider = new LocalResultProviderAdapter();
    settlement = new SettlementService(
      new PrismaSettlementRepository(prisma),
      new SettlementDrawAdapter(draws, prisma),
      new SettlementWalletAdapter(ledger),
      new SettlementOrdersAdapter(prisma),
      resultProvider,
    );

    adminId = randomUUID();
    sessionId = randomUUID();
    await prisma.adminUser.create({
      data: {
        id: adminId,
        email: `settlement-admin-${adminId}@example.test`,
        name: "Settlement Test Admin",
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    await prisma.adminAuthSession.create({
      data: {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: `settlement-refresh-${sessionId}`,
        familyId: randomUUID(),
        expiresAt: new Date("2199-01-01T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    try {
      const accounts = await prisma.ledgerAccount.findMany({
        where: {
          OR: [
            { memberId: { in: memberIds } },
            { systemCode: "betting-settlement" },
            { systemCode: { startsWith: "settlement-test-funding" } },
            { systemCode: { startsWith: "order-test-funding" } },
          ],
        },
        select: { id: true },
      });
      const accountIds = accounts.map((account) => account.id);
      const postings = await prisma.ledgerPosting.findMany({
        where: { accountId: { in: accountIds } },
        select: { transactionId: true },
        distinct: ["transactionId"],
      });
      const transactionIds = postings.map((posting) => posting.transactionId);

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" DISABLE TRIGGER "bet_receipts_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "result_revisions" DISABLE TRIGGER "result_revisions_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" DISABLE TRIGGER "lottery_product_version_links_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" DISABLE TRIGGER "lottery_product_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" DISABLE TRIGGER "lottery_bet_type_versions_published_immutable"');

        await tx.settlementOrder.deleteMany({ where: { memberId: { in: memberIds } } });
        await tx.settlementBatch.deleteMany({ where: { id: { in: settlementBatchIds } } });
        await tx.resultRevision.deleteMany({ where: { drawId: { in: drawIds } } });
        await tx.betReceipt.deleteMany({ where: { memberId: { in: memberIds } } });
        await tx.betOrderLine.deleteMany({ where: { order: { memberId: { in: memberIds } } } });
        await tx.betOrder.deleteMany({ where: { memberId: { in: memberIds } } });
        await tx.bettingQuoteLine.deleteMany({ where: { quote: { memberId: { in: memberIds } } } });
        await tx.bettingQuote.deleteMany({ where: { memberId: { in: memberIds } } });

        await tx.reservationAllocation.deleteMany({
          where: { reservation: { OR: [{ memberId: { in: memberIds } }, { consumingTransactionId: { in: transactionIds } }] } },
        });
        await tx.reservation.deleteMany({
          where: { OR: [{ memberId: { in: memberIds } }, { consumingTransactionId: { in: transactionIds } }] },
        });
        await tx.ledgerPosting.deleteMany({ where: { transactionId: { in: transactionIds } } });
        // Reversals/compensations reference their corrected transaction via
        // corrects_transaction_id (Restrict), so delete them before the rest.
        await tx.financialTransaction.deleteMany({
          where: { id: { in: transactionIds }, correctionKind: { in: ["REVERSAL", "COMPENSATION"] } },
        });
        await tx.financialTransaction.deleteMany({ where: { id: { in: transactionIds } } });
        await tx.ledgerAccount.deleteMany({ where: { id: { in: accountIds } } });
        // Auto-created accounting periods are shared across the dev DB and are
        // not test-owned; leave them (other tenants' transactions reference them).

        await tx.lotteryDrawOverride.deleteMany({ where: { drawId: { in: drawIds } } });
        await tx.lotteryDrawBetType.deleteMany({ where: { drawId: { in: drawIds } } });
        await tx.lotteryDraw.deleteMany({ where: { id: { in: drawIds } } });
        await tx.lotteryProductVersionBetType.deleteMany({
          where: { productVersionId: { in: productVersionIds } },
        });
        await tx.lotteryProductVersion.deleteMany({ where: { id: { in: productVersionIds } } });
        await tx.lotteryBetTypeVersion.deleteMany({ where: { id: { in: betTypeVersionIds } } });
        await tx.lotteryProduct.deleteMany({ where: { id: { in: productIds } } });
        await tx.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
        await tx.member.deleteMany({ where: { id: { in: memberIds } } });
        await tx.adminAuthSession.deleteMany({ where: { id: sessionId } });
        await tx.adminUser.deleteMany({ where: { id: adminId } });

        await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" ENABLE TRIGGER "lottery_product_version_links_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "result_revisions" ENABLE TRIGGER "result_revisions_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" ENABLE TRIGGER "bet_receipts_immutable"');
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function publishedProductFixture(prefix: string): Promise<{
    productId: string;
    productVersionId: string;
    betTypeId: string;
    betTypeVersionId: string;
  }> {
    const suffix = randomUUID();
    const productId = randomUUID();
    const betTypeId = randomUUID();
    const productVersionId = randomUUID();
    const betTypeVersionId = randomUUID();
    productIds.push(productId);
    betTypeIds.push(betTypeId);
    productVersionIds.push(productVersionId);
    betTypeVersionIds.push(betTypeVersionId);
    await prisma.lotteryProduct.create({ data: { id: productId } });
    await prisma.lotteryBetType.create({
      data: { id: betTypeId, code: `${prefix}_${suffix.slice(0, 8)}` },
    });
    await prisma.lotteryBetTypeVersion.create({
      data: {
        id: betTypeVersionId,
        betTypeId,
        state: "PUBLISHED",
        canonicalNumberFormat: "00",
        validationPattern: "^[0-9]{2}$",
        defaultPayout: { kind: "FIXED", amountMinor: 9000 },
        minStakeMinor: 100n,
        maxStakeMinor: 100000n,
        limitPolicyRef: "limit-v1",
        restrictionPolicyRef: "restriction-v1",
        settlementRuleVersionRef: "settlement-v1",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await prisma.lotteryProductVersion.create({
      data: {
        id: productVersionId,
        productId,
        state: "DRAFT",
        timezone: "Asia/Bangkok",
        scheduleTemplateRef: "schedule-v1",
        resultSchemaVersionRef: "result-v1",
        settlementRuleVersionRef: "settlement-v1",
        defaultPayoutPolicyRef: "payout-v1",
        defaultLimitPolicyRef: "limit-v1",
        defaultRestrictionPolicyRef: "restriction-v1",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await prisma.lotteryProductVersionBetType.create({
      data: { productVersionId, betTypeId, betTypeVersionId },
    });
    await prisma.lotteryProductVersion.update({
      where: { id: productVersionId },
      data: { state: "PUBLISHED" },
    });
    return { productId, productVersionId, betTypeId, betTypeVersionId };
  }

  async function newMember(): Promise<string> {
    const id = randomUUID();
    memberIds.push(id);
    await prisma.member.create({
      data: { id, phone: `+66${id.replaceAll("-", "").slice(0, 10)}` },
    });
    return id;
  }

  async function fundCash(memberId: string, amountMinor: bigint): Promise<void> {
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH", "THB");
    const counterpartyId = await ledger.ensureSystemAccount(
      `settlement-test-funding:${randomUUID()}`,
      "THB",
    );
    const identity = randomUUID();
    await ledger.post({
      businessTransactionId: `settlement-funding-${identity}`,
      operationType: "TEST_SETTLEMENT_FUNDING",
      correlationId: randomUUID(),
      idempotency: {
        scope: `TEST_SETTLEMENT_FUNDING:${identity}`,
        key: identity,
        fingerprint: identity,
      },
      domainReferences: {},
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: cashAccountId, side: "CREDIT", amountMinor },
        { accountId: counterpartyId, side: "DEBIT", amountMinor },
      ],
    });
  }

  async function cashAvailable(memberId: string): Promise<bigint> {
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH", "THB");
    return ledger.getAvailableMinorUnits(cashAccountId);
  }

  async function settleFixture(opts: {
    day: string;
    stakeMinor?: bigint;
    lines?: Array<{ canonicalNumber: string; stakeMinor: bigint }>;
  }): Promise<{
    drawId: string;
    memberId: string;
    orderId: string;
    betTypeCode: string;
    serverNow: Date;
    confirmedCash: bigint;
  }> {
    const { productId, betTypeId } = await publishedProductFixture("S");
    const day = opts.day;
    const occurrence = {
      occurrenceIdentity: `${productId}-${day}`,
      localDate: day,
      openAt: new Date(`${day}T06:00:00.000Z`),
      cutoffAt: new Date(`${day}T11:00:00.000Z`),
      drawAt: new Date(`${day}T12:00:00.000Z`),
      provenance: "SCHEDULE_GENERATED" as const,
    };
    const summary = (
      await draws.generateDraws({ productId, baseOccurrences: [occurrence], actor: actor() })
    ).created[0]!;
    drawIds.push(summary.id);
    await draws.transition({ id: summary.id, command: "SCHEDULE", expectedVersion: 1, actor: actor() });
    await draws.transition({ id: summary.id, command: "OPEN", expectedVersion: 2, actor: actor() });
    const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: summary.id } });
    const betType = await prisma.lotteryDrawBetType.findFirstOrThrow({ where: { drawId: summary.id } });

    const memberId = await newMember();
    await fundCash(memberId, 10_000n);
    const serverNow = new Date(`${day}T08:00:00.000Z`);
    const quote = await quotes.createQuote({
      memberId,
      drawId: summary.id,
      currency: "THB",
      idempotencyKey: `settle-q-${randomUUID()}`,
      lines: (opts.lines ?? [{ canonicalNumber: "42", stakeMinor: opts.stakeMinor ?? 100n }]).map(
        (line) => ({
          betTypeCode: betType.betTypeCode,
          canonicalNumber: line.canonicalNumber,
          stakeMinor: line.stakeMinor,
        }),
      ),
      now: serverNow,
    });
    const order = await orders.createOrder({
      memberId,
      quoteId: quote.id,
      idempotencyKey: `settle-o-${randomUUID()}`,
    });
    const confirmed = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: order.version,
      idempotencyKey: `settle-c-${randomUUID()}`,
      now: serverNow,
    });
    expect(confirmed.state).toBe("CONFIRMED");
    // version after OPEN is 3.
    await draws.transition({ id: summary.id, command: "CLOSE", expectedVersion: 3, actor: actor() });
    const confirmedCash = await cashAvailable(memberId);
    return {
      drawId: summary.id,
      memberId,
      orderId: order.id,
      betTypeCode: betType.betTypeCode,
      serverNow,
      confirmedCash,
    };
  }

  async function intakeAndConfirm(drawId: string, winningNumbers: Record<string, string>) {
    const intake = await settlement.intakeResult({
      drawId,
      winningNumbers,
      resultSchemaVersionRef: "result-v1",
      correlationId: randomUUID(),
    });
    expect(intake.state).toBe("RECEIVED");
    const confirmed = await settlement.confirmResult({
      drawId,
      revision: intake.revision,
      actor: actor(),
    });
    expect(confirmed.state).toBe("CONFIRMED");
    return confirmed;
  }

  async function payoutTransactionCount(orderId: string): Promise<number> {
    return prisma.financialTransaction.count({
      where: { operationType: "SETTLEMENT_PAYOUT", domainReferences: { path: ["orderId"], equals: orderId } },
    });
  }

  // ---------------------------------------------------------------------------

  it("settles a winning Order once-only and drives the Draw to SETTLED", async () => {
    const fixture = await settleFixture({ day: "2099-08-05", stakeMinor: 100n });
    const { drawId, memberId, orderId, confirmedCash } = fixture;

    const revision = await intakeAndConfirm(drawId, { [fixture.betTypeCode]: "42" });

    const batch = await settlement.runSettlement({ drawId, actor: actor() });
    expect(batch.state).toBe("COMPLETED");
    settlementBatchIds.push(batch.id);
    expect(batch.winningOrderCount).toBe(1);
    expect(batch.losingOrderCount).toBe(0);
    expect(batch.totalPayoutMinor).toBe(9000n);

    // The Order reached terminal SETTLED and the payout was posted once.
    const order = await prisma.betOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe("SETTLED");
    expect(await payoutTransactionCount(orderId)).toBe(1);
    // funded 10000, staked 100 (confirmedCash 9900), won 9000 -> 18900.
    expect(await cashAvailable(memberId)).toBe(confirmedCash + 9000n);

    // The settlement outcome is member-visible and authoritative now.
    const outcome = await settlement.getOrderSettlementOutcome(memberId, orderId);
    expect(outcome).toMatchObject({ outcome: "WIN", payoutMinor: 9000n, authoritative: true });

    // The Draw reached terminal SETTLED.
    const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: drawId } });
    expect(draw.state).toBe("SETTLED");
  });

  it("is idempotent: a re-driven run reuses the same batch and never re-pays", async () => {
    const fixture = await settleFixture({ day: "2099-08-06", stakeMinor: 200n });
    const { drawId, memberId, orderId, confirmedCash } = fixture;
    await intakeAndConfirm(drawId, { [fixture.betTypeCode]: "42" });

    const first = await settlement.runSettlement({ drawId, actor: actor() });
    settlementBatchIds.push(first.id);
    await settlement.runSettlement({ drawId, actor: actor() });

    expect(await payoutTransactionCount(orderId)).toBe(1);
    // stake 200 -> payout 18000.
    expect(await cashAvailable(memberId)).toBe(confirmedCash + 18000n);
    const ordersRows = await prisma.settlementOrder.findMany({ where: { orderId } });
    expect(ordersRows).toHaveLength(1);
  });

  it("evaluates a mismatch as LOSE with no payout", async () => {
    const fixture = await settleFixture({ day: "2099-08-07", stakeMinor: 300n });
    const { drawId, memberId, orderId, confirmedCash } = fixture;
    await intakeAndConfirm(drawId, { [fixture.betTypeCode]: "07" }); // bet was on 42

    const batch = await settlement.runSettlement({ drawId, actor: actor() });
    settlementBatchIds.push(batch.id);
    expect(batch.state).toBe("COMPLETED");
    expect(batch.winningOrderCount).toBe(0);
    expect(batch.losingOrderCount).toBe(1);
    expect(batch.totalPayoutMinor).toBe(0n);

    expect(await payoutTransactionCount(orderId)).toBe(0);
    // Stake is lost: cash unchanged from after-confirm.
    expect(await cashAvailable(memberId)).toBe(confirmedCash);
    const outcome = await settlement.getOrderSettlementOutcome(memberId, orderId);
    expect(outcome).toMatchObject({ outcome: "LOSE", payoutMinor: 0n, authoritative: true });
  });

  it("resumes a crashed batch from a durable POSTING checkpoint without re-paying", async () => {
    const fixture = await settleFixture({ day: "2099-08-08", stakeMinor: 500n });
    const { drawId, memberId, orderId, confirmedCash, betTypeCode } = fixture;
    const revision = await intakeAndConfirm(drawId, { [betTypeCode]: "42" });

    // Simulate a crash: the batch was created, reached POSTING, and one Order
    // row is still EVALUATED (payout not yet posted).
    const batchId = randomUUID();
    settlementBatchIds.push(batchId);
    await prisma.settlementBatch.create({
      data: {
        id: batchId,
        drawId,
        resultRevisionId: revision.id,
        state: "POSTING",
        version: 2,
        correlationId: randomUUID(),
        idempotencyScope: `SETTLEMENT_BATCH:${drawId}`,
        idempotencyKey: revision.id,
        fingerprint: settlementFingerprint(drawId, revision.id),
      },
    });
    await prisma.settlementOrder.create({
      data: {
        id: orderId,
        batchId,
        orderId,
        memberId,
        outcome: "WIN",
        stakeMinor: 500n,
        payoutMinor: 45000n,
        status: "EVALUATED",
        payoutTransactionId: null,
      },
    });

    const resumed = await settlement.runSettlement({ drawId, actor: actor() });
    expect(resumed.id).toBe(batchId);
    expect(resumed.state).toBe("COMPLETED");
    // exactly one payout, never two
    expect(await payoutTransactionCount(orderId)).toBe(1);
    // stake 500 -> payout 45000
    expect(await cashAvailable(memberId)).toBe(confirmedCash + 45000n);
    const order = await prisma.betOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe("SETTLED");
  });

  it("reverses prior payouts and re-settles through the immutable correction workflow", async () => {
    const fixture = await settleFixture({ day: "2099-08-09", stakeMinor: 100n });
    const { drawId, memberId, orderId, confirmedCash, betTypeCode } = fixture;
    await intakeAndConfirm(drawId, { [betTypeCode]: "42" });

    const first = await settlement.runSettlement({ drawId, actor: actor() });
    settlementBatchIds.push(first.id);
    expect(await cashAvailable(memberId)).toBe(confirmedCash + 9000n);

    // Correct the Result: the winning number is now 07, not 42.
    const correction = await settlement.correctResult({
      drawId,
      winningNumbers: { [betTypeCode]: "07" },
      resultSchemaVersionRef: "result-v1",
      actor: actor(),
      correlationId: randomUUID(),
    });
    expect(correction.reversedCount).toBe(1);
    expect(correction.revision.state).toBe("CONFIRMED");

    // The prior confirmed revision is SUPERSEDED; the new one is active.
    const prior = await prisma.resultRevision.findFirstOrThrow({
      where: { drawId, state: "SUPERSEDED" },
    });
    expect(prior.supersedesRevisionId).toBeNull();
    const active = await prisma.resultRevision.findFirstOrThrow({
      where: { drawId, state: "CONFIRMED", supersededBy: null },
    });
    expect(active.revision).toBe(correction.revision.revision);

    // The compensating reversal was posted exactly once for this Order.
    expect(
      await prisma.financialTransaction.count({
        where: {
          operationType: "SETTLEMENT_PAYOUT_REVERSAL",
          domainReferences: { path: ["orderId"], equals: orderId },
        },
      }),
    ).toBe(1);

    // Re-settle against the corrected Result: the Order now loses.
    const second = await settlement.runSettlement({ drawId, actor: actor() });
    settlementBatchIds.push(second.id);
    expect(second.state).toBe("COMPLETED");
    expect(second.totalPayoutMinor).toBe(0n);

    // Net: funded 10000 - stake 100 = 9900 (win reversed, re-settle loses).
    expect(await cashAvailable(memberId)).toBe(confirmedCash);
    // Exactly one payout and one reversal; no double posting.
    expect(await payoutTransactionCount(orderId)).toBe(1);
    // The correction trail is complete: two batches exist for the Draw.
    const batchCount = await prisma.settlementBatch.count({ where: { drawId } });
    expect(batchCount).toBe(2);
  });

  it("blocks a changed intake once a Result is confirmed (correction only)", async () => {
    const fixture = await settleFixture({ day: "2099-08-10", stakeMinor: 100n });
    const { drawId, betTypeCode } = fixture;
    await intakeAndConfirm(drawId, { [betTypeCode]: "42" });
    // The Draw is now RESULT_CONFIRMED; a changed result cannot be re-intaked —
    // it must go through the correction workflow.
    await expect(
      settlement.intakeResult({
        drawId,
        winningNumbers: { [betTypeCode]: "07" },
        resultSchemaVersionRef: "result-v1",
      }),
    ).rejects.toMatchObject({ code: "DRAW_STATE_CONFLICT" });
  });
});

// End-to-end integration evidence for the Draw-cancellation refund orchestration
// (Issue 117, ADR 0001 workflow 5) against a real (non-prod) PostgreSQL database.
//
// Acceptance criteria covered:
//   - confirmed order -> draw cancelled -> stake reversal visible in the ledger,
//     member wallet zero-net, draw state CANCELLED;
//   - replaying the orchestrator yields exactly one refund transaction per order;
//   - the generic draw transition path refuses COMPLETE_CANCELLATION without the
//     refund flag (the orchestrator is the only admin path that reaches CANCELLED).
//
// Every financial assertion is a durable count/balance, not a status code: the
// refund posts exactly one BET_STAKE_REFUND per Order, and the Member's CASH
// returns to its pre-stake balance.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { LotteryDrawService } from "../../src/contexts/lottery/application/lottery-draw.service";
import { DrawCancellationOrchestrator } from "../../src/contexts/lottery/application/draw-cancellation-orchestrator";
import { DrawRefundAdapter } from "../../src/platform/integration/draw-refund.adapter";
import { DrawStakeRefundService } from "../../src/contexts/betting/application/draw-stake-refund.service";
import { PrismaStakeRefundRepository } from "../../src/contexts/betting/infrastructure/prisma-stake-refund.repository";
import { BettingQuoteService } from "../../src/contexts/betting/application/betting-quote.service";
import { BettingOrderService } from "../../src/contexts/betting/application/betting-order.service";
import { BettingQuoteDrawAdapter } from "../../src/platform/integration/quote-draw.adapter";
import { BetOrderWalletAdapter } from "../../src/platform/integration/betting-order-wallet.adapter";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { allowBetEligibility } from "../support/betting-eligibility.fake";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Draw-cancellation refund orchestration (admin path)", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let draws: LotteryDrawService;
  let orchestrator: DrawCancellationOrchestrator;
  let adminId: string;
  let sessionId: string;

  const memberIds: string[] = [];
  const productIds: string[] = [];
  const betTypeIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeVersionIds: string[] = [];
  const drawIds: string[] = [];
  const orderIds: string[] = [];

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
    const quotes = new BettingQuoteService(prisma, drawAdapter, allowBetEligibility);
    const orders = new BettingOrderService(
      prisma,
      drawAdapter,
      new BetOrderWalletAdapter(ledger, prisma),
      allowBetEligibility,
    );

    // Wire the orchestrator exactly as ContextsModule does: refund seam adapter
    // -> betting refund service -> betting repository + wallet-ledger port.
    const stakeRefundRepo = new PrismaStakeRefundRepository(prisma);
    const refundService = new DrawStakeRefundService(
      stakeRefundRepo,
      new BetOrderWalletAdapter(ledger, prisma),
    );
    orchestrator = new DrawCancellationOrchestrator(
      new DrawRefundAdapter(refundService),
      draws,
    );

    adminId = randomUUID();
    sessionId = randomUUID();
    await prisma.adminUser.create({
      data: {
        id: adminId,
        email: `draw-cancel-orch-${adminId}@example.test`,
        name: "Draw Cancel Orchestrator Test Admin",
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    await prisma.adminAuthSession.create({
      data: {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: `dc-refresh-${sessionId}`,
        familyId: randomUUID(),
        expiresAt: new Date("2199-01-01T00:00:00.000Z"),
        userAgent: "test",
        ipAddress: "127.0.0.1",
        createdAt: new Date(),
      },
    });
    void orders;
    void quotes;
  });

  afterAll(async () => {
    // Betting orders reference members and draws; delete orders first, then the
    // draws/product/member/admin rows this suite created (by exact id).
    await prisma.betOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.lotteryDraw.deleteMany({ where: { id: { in: drawIds } } });
    await prisma.lotteryProductVersionBetType.deleteMany({
      where: { productVersionId: { in: productVersionIds } },
    });
    await prisma.lotteryProductVersion.deleteMany({
      where: { id: { in: productVersionIds } },
    });
    await prisma.lotteryBetTypeVersion.deleteMany({
      where: { id: { in: betTypeVersionIds } },
    });
    await prisma.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
    await prisma.lotteryProduct.deleteMany({ where: { id: { in: productIds } } });
    await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
    await prisma.adminAuthSession.deleteMany({ where: { id: sessionId } });
    await prisma.adminUser.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  async function publishedProductFixture(prefix: string): Promise<{
    productId: string;
    productVersionId: string;
    betTypeId: string;
    betTypeVersionId: string;
  }> {
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
      data: { id: betTypeId, code: `${prefix}_${productId.slice(0, 8)}` },
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

  async function openDraw(
    prefix: string,
    day: string,
  ): Promise<{ drawId: string; betTypeCode: string }> {
    const { productId, betTypeId } = await publishedProductFixture(prefix);
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
    const betType = await prisma.lotteryDrawBetType.findFirstOrThrow({
      where: { drawId: summary.id },
    });
    void betTypeId;
    return { drawId: summary.id, betTypeCode: betType.betTypeCode };
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
      `orch-test-funding:${randomUUID()}`,
      "THB",
    );
    const identity = randomUUID();
    await ledger.post({
      businessTransactionId: `funding-${identity}`,
      operationType: "TEST_BET_ORDER_FUNDING",
      correlationId: randomUUID(),
      idempotency: {
        scope: `TEST_BET_ORDER_FUNDING:${identity}`,
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

  async function confirmedOrderForDraw(
    drawId: string,
    betTypeCode: string,
    memberId: string,
    stakeMinor: bigint,
  ): Promise<{ orderId: string; stakeTransactionId: string }> {
    const quote = await quoteService().createQuote({
      memberId,
      drawId,
      currency: "THB",
      idempotencyKey: `q-${randomUUID()}`,
      lines: [{ betTypeCode, canonicalNumber: "42", stakeMinor }],
      now: new Date(),
    });
    const orderService = orderServiceFor();
    const order = await orderService.createOrder({
      memberId,
      quoteId: quote.id,
      idempotencyKey: `o-${randomUUID()}`,
    });
    orderIds.push(order.id);
    const confirmed = await orderService.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: new Date(),
    });
    return { orderId: confirmed.id, stakeTransactionId: confirmed.stakeTransactionId! };
  }

  // Fresh instances bound to the shared prisma/ledger used by the harness.
  function quoteService(): BettingQuoteService {
    return new BettingQuoteService(prisma, new BettingQuoteDrawAdapter(prisma), allowBetEligibility);
  }
  function orderServiceFor(): BettingOrderService {
    return new BettingOrderService(
      prisma,
      new BettingQuoteDrawAdapter(prisma),
      new BetOrderWalletAdapter(ledger, prisma),
      allowBetEligibility,
    );
  }

  it("cancels a Draw end-to-end: confirmed order refunded, wallet zero-net, draw CANCELLED", async () => {
    const day = "2099-06-05";
    const { drawId, betTypeCode } = await openDraw("T06_E2E", day);
    const memberId = await newMember();
    const startingCash = 1_000n;
    const stakeMinor = 300n;
    await fundCash(memberId, startingCash);

    const { orderId, stakeTransactionId } = await confirmedOrderForDraw(
      drawId,
      betTypeCode,
      memberId,
      stakeMinor,
    );
    expect(await cashAvailable(memberId)).toBe(startingCash - stakeMinor);

    // Move the Draw to CANCELLING (the state from which COMPLETE_CANCELLATION is legal).
    await draws.transition({
      id: drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });

    const result = await orchestrator.completeDrawCancellation({
      drawId,
      expectedVersion: 4,
      actor: actor(),
    });

    // Draw reached CANCELLED, and the refund seam reported the one Order.
    expect(result.draw.state).toBe("CANCELLED");
    expect(result.refund.considered).toBe(1);
    expect(result.refund.refunded).toBe(1);
    expect(result.refund.outstanding).toBe(0);
    expect(result.refund.obligationsSatisfied).toBe(true);

    // Order is CANCELLED under a durable reversal.
    const order = await prisma.betOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe("CANCELLED");
    expect(order.refundTransactionId).not.toBeNull();

    // The ledger holds the reversal, keyed to the Order and to the refund op.
    const refundTx = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: order.refundTransactionId! },
      include: { postings: { include: { account: true } } },
    });
    expect(refundTx.operationType).toBe("BET_STAKE_REFUND");
    expect(refundTx.businessTransactionId).toBe(`${orderId}:refund`);
    expect(refundTx.domainReferences).toMatchObject({ orderId });
    const memberPosting = refundTx.postings.find(
      (posting) => posting.account.memberId === memberId,
    );
    expect(memberPosting).toMatchObject({ side: "CREDIT", amountMinor: stakeMinor });

    // Member wallet is back to zero-net (pre-stake balance).
    expect(await cashAvailable(memberId)).toBe(startingCash);
  });

  it("replaying the orchestrator yields exactly one refund transaction per order", async () => {
    const day = "2099-07-05";
    const { drawId, betTypeCode } = await openDraw("T06_REPLAY", day);
    const memberId = await newMember();
    const startingCash = 1_000n;
    const stakeMinor = 300n;
    await fundCash(memberId, startingCash);

    const { orderId } = await confirmedOrderForDraw(
      drawId,
      betTypeCode,
      memberId,
      stakeMinor,
    );
    await draws.transition({
      id: drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });

    const first = await orchestrator.completeDrawCancellation({
      drawId,
      expectedVersion: 4,
      actor: actor(),
    });
    expect(first.refund.refunded).toBe(1);

    // Replay: the Order is already CANCELLED under its durable reversal, so the
    // run reports ALREADY_REFUNDED and converges to the same single reversal.
    const second = await orchestrator.completeDrawCancellation({
      drawId,
      expectedVersion: 5,
      actor: actor(),
    });
    expect(second.refund.alreadyRefunded).toBe(1);
    expect(second.refund.refunded).toBe(0);

    const refunds = await prisma.financialTransaction.findMany({
      where: { operationType: "BET_STAKE_REFUND" },
      include: { postings: { include: { account: true } } },
    });
    const forThisOrder = refunds.filter((tx) =>
      tx.postings.some((posting) => posting.account.memberId === memberId),
    );
    expect(forThisOrder).toHaveLength(1);
    expect(forThisOrder[0]!.domainReferences).toMatchObject({ orderId });
    expect(await cashAvailable(memberId)).toBe(startingCash);
  });

  it("the generic draw transition path refuses COMPLETE_CANCELLATION without the refund flag", async () => {
    const day = "2099-08-05";
    const { drawId } = await openDraw("T06_GATE", day);
    await draws.transition({
      id: drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });

    // Calling the generic transition directly (no orchestrator, no refund flag)
    // must fail closed — only the orchestrator reaches CANCELLED.
    await expect(
      draws.transition({
        id: drawId,
        command: "COMPLETE_CANCELLATION",
        expectedVersion: 4,
        context: { privilegedReopen: true },
        actor: actor(),
      }),
    ).rejects.toMatchObject({ code: "ILLEGAL_DRAW_TRANSITION", status: 409 });

    const still = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: drawId } });
    expect(still.state).toBe("CANCELLING");
  });
});

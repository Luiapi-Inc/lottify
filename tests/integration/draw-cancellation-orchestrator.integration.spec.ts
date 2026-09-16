// End-to-end integration evidence for the Draw-cancellation refund orchestration
// (Issue 117, ADR 0001 workflow 5) against a real (non-prod) PostgreSQL database.
//
// Acceptance criteria covered:
//   - confirmed order -> draw cancelled -> stake reversal visible in the ledger,
//     member wallet zero-net, draw state CANCELLED;
//   - replaying the orchestrator yields exactly one refund transaction per order;
//   - the generic draw transition path refuses COMPLETE_CANCELLATION without the
//     refund flag (the orchestrator is the only admin path that reaches CANCELLED);
//   - Ticket 16: the same behaviour through the authenticated admin HTTP route —
//     bearer authentication, capability denial, body validation, the 409 for a
//     Draw that does not authorise the cancellation, the {draw, refund} response
//     shape (money as minor-unit strings), and a mid-batch refund failure that
//     stays a durable CANCELLING state reported as 409 outstanding obligations
//     and converges on a re-drive with exactly one reversal per Order.
//
// Every financial assertion is a durable count/balance, not a status code: the
// refund posts exactly one BET_STAKE_REFUND per Order, and the Member's CASH
// returns to its pre-stake balance.

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDrawController } from "../../apps/api/src/admin-draw.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import type { AdminRole } from "../../src/contexts/identity-access/domain/admin-auth.repository";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import { generateTotpCode, generateTotpSecret } from "../../src/contexts/identity-access/domain/totp";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import {
  getAdminMfaEncryptionKey,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";
import { IdempotencyService } from "../../src/platform/idempotency/idempotency.service";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import type {
  BetOrderWalletPort,
  BetStakeEffect,
} from "../../src/contexts/betting/application/betting-order-wallet.port";
import { LotteryDrawService } from "../../src/contexts/lottery/application/lottery-draw.service";
import { DrawCancellationOrchestrator } from "../../src/contexts/lottery/application/draw-cancellation-orchestrator";
import { DrawRefundAdapter } from "../../src/platform/integration/draw-refund.adapter";
import { DrawStakeRefundService } from "../../src/contexts/betting/application/draw-stake-refund.service";
import { PrismaStakeRefundRepository } from "../../src/contexts/betting/infrastructure/prisma-stake-refund.repository";
import { BettingQuoteService } from "../../src/contexts/betting/application/betting-quote.service";
import { BettingOrderService } from "../../src/contexts/betting/application/betting-order.service";
import { BettingQuoteDrawAdapter } from "../../src/platform/integration/quote-draw.adapter";
import { BetOrderWalletAdapter } from "../../src/platform/integration/betting-order-wallet.adapter";
import { PrismaDrawAdmissionBoundary } from "../../src/platform/concurrency/prisma-draw-admission.boundary";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { allowBetEligibility } from "../support/betting-eligibility.fake";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

/**
 * The production Wallet & Ledger port with a switchable, per-Order failure.
 *
 * Ticket 16 asks for real-DB evidence that a mid-batch refund failure stays a
 * recoverable operational state. The failure has to be injected somewhere, and
 * it is injected here — at the ledger seam — so everything else stays
 * production code against real PostgreSQL: the refund service, the Order
 * claim/settle CAS, the ledger reversals of the Orders that did succeed, and
 * the Draw state machine are all the real ones.
 */
class FaultInjectingRefundWallet implements BetOrderWalletPort {
  /** Orders whose reversal fails as if the ledger were unavailable. */
  readonly failingOrderIds = new Set<string>();

  constructor(private readonly inner: BetOrderWalletPort) {}

  commitStake(input: {
    orderId: string;
    memberId: string;
    drawId: string;
    amountMinor: bigint;
    currency: "THB";
    correlationId: string;
    acceptedAt: Date;
  }): Promise<BetStakeEffect> {
    return this.inner.commitStake(input);
  }

  refundStake(input: {
    orderId: string;
    memberId: string;
    stakeTransactionId: string;
    currency: "THB";
    correlationId: string;
  }): Promise<BetStakeEffect> {
    if (this.failingOrderIds.has(input.orderId)) {
      return Promise.reject(
        new Error(`injected ledger outage for Order ${input.orderId}`),
      );
    }
    return this.inner.refundStake(input);
  }
}

describe.runIf(runIntegration)("Draw-cancellation refund orchestration (admin path)", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let draws: LotteryDrawService;
  let orchestrator: DrawCancellationOrchestrator;
  let refundWallet: FaultInjectingRefundWallet;
  let app: INestApplication;
  let baseUrl: string;
  let adminAuth: AdminAuthService;
  let adminId: string;
  let sessionId: string;

  const memberIds: string[] = [];
  const productIds: string[] = [];
  const betTypeIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeVersionIds: string[] = [];
  const drawIds: string[] = [];
  const orderIds: string[] = [];
  const fundingAccountIds: string[] = [];
  /** Admin users created for the HTTP-path tests (cleaned up with the rest). */
  const httpAdminIds: string[] = [];

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
      new PrismaDrawAdmissionBoundary(prisma),
    );

    // Wire the orchestrator exactly as ContextsModule does: refund seam adapter
    // -> betting refund service -> betting repository + wallet-ledger port, and
    // the SAME Draw admission boundary the betting Confirm path holds. The
    // wallet seam is the fault-injecting one so a mid-batch failure can be
    // induced without replacing any production component.
    const stakeRefundRepo = new PrismaStakeRefundRepository(prisma);
    refundWallet = new FaultInjectingRefundWallet(
      new BetOrderWalletAdapter(ledger, prisma),
    );
    const refundService = new DrawStakeRefundService(
      stakeRefundRepo,
      refundWallet,
    );
    orchestrator = new DrawCancellationOrchestrator(
      new DrawRefundAdapter(refundService),
      draws,
      new PrismaDrawAdmissionBoundary(prisma),
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
    // The admin HTTP surface for the COMPLETE_CANCELLATION path, wired exactly
    // as apps/api does: the real controller, the real guards, real Admin auth
    // (JWT + session in the shared database) and the orchestrator built above.
    adminAuth = new AdminAuthService(
      new PrismaAdminAuthRepository(prisma),
      new JwtService(),
    );

    @Module({
      controllers: [AdminDrawController],
      providers: [
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: Reflector, useValue: new Reflector() },
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: LotteryDrawService, useValue: draws },
        { provide: DrawCancellationOrchestrator, useValue: orchestrator },
        { provide: IdempotencyService, useValue: new IdempotencyService(prisma) },
      ],
    })
    class AdminDrawHttpModule {}

    app = await NestFactory.create(AdminDrawHttpModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    void orders;
    void quotes;
  });

  afterAll(async () => {
    // Betting orders reference receipts/lines/reservations and the ledger posts
    // against member + funding accounts, so cleanup must run in dependency order
    // and disable the immutability triggers, mirroring betting-order.integration.spec.
    const accounts = await prisma.ledgerAccount.findMany({
      where: { memberId: { in: memberIds } },
      select: { id: true },
    });
    const memberAccountIds = accounts.map((account) => account.id);
    const postings = await prisma.ledgerPosting.findMany({
      where: { accountId: { in: memberAccountIds } },
      select: { transactionId: true },
      distinct: ["transactionId"],
    });
    const transactionIds = postings.map((posting) => posting.transactionId);
    const periods = await prisma.financialTransaction.findMany({
      where: { id: { in: transactionIds } },
      select: { accountingPeriodId: true },
      distinct: ["accountingPeriodId"],
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" DISABLE TRIGGER "bet_receipts_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" DISABLE TRIGGER "lottery_product_version_links_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" DISABLE TRIGGER "lottery_product_versions_published_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" DISABLE TRIGGER "lottery_bet_type_versions_published_immutable"');

      await tx.betReceipt.deleteMany({ where: { memberId: { in: memberIds } } });
      await tx.betOrderLine.deleteMany({ where: { order: { memberId: { in: memberIds } } } });
      await tx.betOrder.deleteMany({ where: { memberId: { in: memberIds } } });
      await tx.bettingQuoteLine.deleteMany({ where: { quote: { memberId: { in: memberIds } } } });
      await tx.bettingQuote.deleteMany({ where: { memberId: { in: memberIds } } });

      await tx.reservationAllocation.deleteMany({
        where: { reservation: { memberId: { in: memberIds } } },
      });
      await tx.reservation.deleteMany({ where: { memberId: { in: memberIds } } });
      await tx.ledgerPosting.deleteMany({ where: { transactionId: { in: transactionIds } } });
      await tx.financialTransaction.deleteMany({ where: { id: { in: transactionIds } } });
      await tx.ledgerAccount.deleteMany({
        where: { id: { in: [...memberAccountIds, ...fundingAccountIds] } },
      });
      await tx.accountingPeriod.deleteMany({
        where: { id: { in: periods.map((period) => period.accountingPeriodId) } },
      });

      await tx.lotteryDrawBetType.deleteMany({ where: { drawId: { in: drawIds } } });
      await tx.lotteryDraw.deleteMany({ where: { id: { in: drawIds } } });
      await tx.lotteryProductVersionBetType.deleteMany({
        where: { productVersionId: { in: productVersionIds } },
      });
      await tx.lotteryProductVersion.deleteMany({
        where: { id: { in: productVersionIds } },
      });
      await tx.lotteryBetTypeVersion.deleteMany({
        where: { id: { in: betTypeVersionIds } },
      });
      await tx.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
      await tx.lotteryProduct.deleteMany({ where: { id: { in: productIds } } });
      await tx.member.deleteMany({ where: { id: { in: memberIds } } });
      await tx.adminAuthSession.deleteMany({ where: { id: sessionId } });
      await tx.adminAuthSession.deleteMany({
        where: { adminUserId: { in: httpAdminIds } },
      });
      await tx.adminReauthEvidence.deleteMany({
        where: { adminUserId: { in: httpAdminIds } },
      });
      await tx.adminUser.deleteMany({ where: { id: adminId } });
      await tx.adminUser.deleteMany({ where: { id: { in: httpAdminIds } } });

      await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" ENABLE TRIGGER "lottery_product_version_links_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" ENABLE TRIGGER "bet_receipts_immutable"');
    });
    await app?.close();
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
    fundingAccountIds.push(counterpartyId);
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
      new PrismaDrawAdmissionBoundary(prisma),
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

    // Replay: the Order is already CANCELLED under its durable reversal, so it is
    // no longer a refundable candidate — the run considers 0 orders, refunds none,
    // and converges to the same single reversal (idempotency, not a second refund).
    const second = await orchestrator.completeDrawCancellation({
      drawId,
      expectedVersion: 5,
      actor: actor(),
    });
    expect(second.refund.considered).toBe(0);
    expect(second.refund.refunded).toBe(0);
    expect(second.refund.alreadyRefunded).toBe(0);
    expect(second.refund.outstanding).toBe(0);
    expect(second.refund.obligationsSatisfied).toBe(true);

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

  // ---------------------------------------------------------------------------
  // Ticket 16: the authenticated admin HTTP path.
  //
  // The tests above drive the orchestrator directly. These drive the real
  // controller over HTTP — real AdminAuthGuard/AdminCapabilityGuard, a real
  // Admin access token from the shared database, and the same orchestrator
  // instance — because "end-to-end admin path" is a claim about the route, not
  // about the service.
  // ---------------------------------------------------------------------------

  const HTTP_TEST_TIMEOUT_MS = 60_000;

  async function createAdminSession(role: AdminRole): Promise<string> {
    const id = randomUUID();
    const email = `draw-cancel-http+${role.toLowerCase()}-${id}@example.test`;
    const password = "Draw cancellation HTTP integration password 123!";
    const secret = generateTotpSecret();
    await prisma.adminUser.create({
      data: {
        id,
        email,
        name: `Draw cancellation HTTP ${role}`,
        passwordHash: await hashAdminPassword(password),
        role,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecretEncrypted: encryptAdminSecret(secret, getAdminMfaEncryptionKey()),
      },
    });
    httpAdminIds.push(id);
    const login = await adminAuth.login(email, password);
    if (login.status !== "MFA_REQUIRED") throw new Error("Expected an MFA challenge");
    const tokens = await adminAuth.verifyMfa(
      login.challengeToken,
      generateTotpCode(secret),
      "127.0.0.1",
      "draw-cancellation-orchestrator-integration",
    );
    return tokens.accessToken;
  }

  function postTransition(
    accessToken: string | null,
    drawId: string,
    body: unknown,
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/admin/draws/${drawId}/transition`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function refundTransactionsFor(
    orderId: string,
    memberId: string,
  ): Promise<number> {
    const refunds = await prisma.financialTransaction.findMany({
      where: { operationType: "BET_STAKE_REFUND" },
      include: { postings: { include: { account: true } } },
    });
    return refunds.filter(
      (tx) =>
        (tx.domainReferences as { orderId?: string } | null)?.orderId === orderId &&
        tx.postings.some((posting) => posting.account.memberId === memberId),
    ).length;
  }

  it("authenticates and authorises the admin COMPLETE_CANCELLATION request", async () => {
    const { drawId, betTypeCode } = await openDraw("T06_HTTP_AUTH", "2099-09-01");
    const memberId = await newMember();
    const startingCash = 1_000n;
    const stakeMinor = 300n;
    await fundCash(memberId, startingCash);
    const { orderId } = await confirmedOrderForDraw(drawId, betTypeCode, memberId, stakeMinor);
    await draws.transition({
      id: drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });

    const unauthenticated = await postTransition(null, drawId, {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });

    // An Admin without lottery-draw.manage is refused by the capability guard.
    const auditor = await createAdminSession("AUDITOR");
    const denied = await postTransition(auditor, drawId, {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      code: "ACCESS_DENIED",
      details: { required: ["lottery-draw.manage"] },
    });

    // Neither refusal terminalized the Draw or moved money.
    expect(
      (await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: drawId } })).state,
    ).toBe("CANCELLING");
    const order = await prisma.betOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe("CONFIRMED");
    expect(order.refundTransactionId).toBeNull();
    expect(await cashAvailable(memberId)).toBe(startingCash - stakeMinor);
    expect(await refundTransactionsFor(orderId, memberId)).toBe(0);
  }, HTTP_TEST_TIMEOUT_MS);

  it("validates the transition body and refuses a Draw that does not authorise the cancellation", async () => {
    const { drawId, betTypeCode } = await openDraw("T06_HTTP_INPUT", "2099-09-02");
    const memberId = await newMember();
    const startingCash = 1_000n;
    const stakeMinor = 300n;
    await fundCash(memberId, startingCash);
    const { orderId } = await confirmedOrderForDraw(drawId, betTypeCode, memberId, stakeMinor);
    // The Draw is OPEN: COMPLETE_CANCELLATION is not legal from here.
    await draws.transition({ id: drawId, command: "CLOSE", expectedVersion: 3, actor: actor() });

    const admin = await createAdminSession("ADMIN");

    const badCommand = await postTransition(admin, drawId, {
      command: "NOT_A_DRAW_COMMAND",
      expectedVersion: 4,
    });
    expect(badCommand.status).toBe(400);
    expect(await badCommand.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "command" },
    });

    const missingVersion = await postTransition(admin, drawId, {
      command: "COMPLETE_CANCELLATION",
    });
    expect(missingVersion.status).toBe(400);
    expect(await missingVersion.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "expectedVersion" },
    });

    // A valid body against a Draw that is not CANCELLING is a 409, not money.
    const illegalState = await postTransition(admin, drawId, {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });
    expect(illegalState.status).toBe(409);
    expect(await illegalState.json()).toMatchObject({
      code: "ILLEGAL_DRAW_TRANSITION",
      details: { state: "CLOSED", command: "COMPLETE_CANCELLATION" },
    });

    // Nothing above touched the Draw or the money.
    expect(
      (await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: drawId } })).state,
    ).toBe("CLOSED");
    const order = await prisma.betOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe("CONFIRMED");
    expect(order.refundTransactionId).toBeNull();
    expect(await cashAvailable(memberId)).toBe(startingCash - stakeMinor);
    expect(await refundTransactionsFor(orderId, memberId)).toBe(0);
  }, HTTP_TEST_TIMEOUT_MS);

  it("cancels a Draw through the admin route and reports the money moved", async () => {
    const { drawId, betTypeCode } = await openDraw("T06_HTTP_OK", "2099-09-03");
    const memberId = await newMember();
    const startingCash = 1_000n;
    const stakeMinor = 400n;
    await fundCash(memberId, startingCash);
    const { orderId } = await confirmedOrderForDraw(drawId, betTypeCode, memberId, stakeMinor);
    await draws.transition({
      id: drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });

    const admin = await createAdminSession("ADMIN");
    const response = await postTransition(admin, drawId, {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });

    expect(response.status).toBe(201);
    // Money crosses the HTTP boundary as a minor-unit string: the orchestrator
    // reports a bigint, and Express cannot serialise one at all.
    expect(await response.json()).toEqual({
      draw: { id: drawId, state: "CANCELLED", version: 5 },
      refund: {
        considered: 1,
        refunded: 1,
        alreadyRefunded: 0,
        outstanding: 0,
        refundedStakeMinor: stakeMinor.toString(),
        obligationsSatisfied: true,
      },
    });

    const order = await prisma.betOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe("CANCELLED");
    expect(order.refundTransactionId).not.toBeNull();
    expect(await refundTransactionsFor(orderId, memberId)).toBe(1);
    expect(await cashAvailable(memberId)).toBe(startingCash);
  }, HTTP_TEST_TIMEOUT_MS);

  it("reports a mid-batch refund failure as 409 outstanding obligations and recovers on a re-drive", async () => {
    const { drawId, betTypeCode } = await openDraw("T06_HTTP_PARTIAL", "2099-09-04");
    const firstMember = await newMember();
    const secondMember = await newMember();
    const startingCash = 1_000n;
    await fundCash(firstMember, startingCash);
    await fundCash(secondMember, startingCash);
    const first = await confirmedOrderForDraw(drawId, betTypeCode, firstMember, 300n);
    const second = await confirmedOrderForDraw(drawId, betTypeCode, secondMember, 200n);
    await draws.transition({
      id: drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });

    const admin = await createAdminSession("ADMIN");

    // The ledger refuses the reversal of the second Order only.
    refundWallet.failingOrderIds.add(second.orderId);
    const failed = await postTransition(admin, drawId, {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });

    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({
      code: "REFUND_OBLIGATIONS_OUTSTANDING",
      details: { drawId, outstanding: 1 },
    });

    // Partial failure is a durable operational state, not a completed draw and
    // not a hidden one: the Draw is still CANCELLING, the first Order's reversal
    // is already committed, the second Order is claimed but not refunded.
    expect(
      (await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: drawId } })).state,
    ).toBe("CANCELLING");
    const firstOrder = await prisma.betOrder.findUniqueOrThrow({
      where: { id: first.orderId },
    });
    expect(firstOrder.state).toBe("CANCELLED");
    expect(firstOrder.refundTransactionId).not.toBeNull();
    expect(await refundTransactionsFor(first.orderId, firstMember)).toBe(1);
    expect(await cashAvailable(firstMember)).toBe(startingCash);
    const secondOrderBefore = await prisma.betOrder.findUniqueOrThrow({
      where: { id: second.orderId },
    });
    expect(secondOrderBefore.state).toBe("CANCELLING");
    expect(secondOrderBefore.refundTransactionId).toBeNull();
    expect(await cashAvailable(secondMember)).toBe(startingCash - 200n);
    expect(await refundTransactionsFor(second.orderId, secondMember)).toBe(0);

    // Re-drive the same admin request once the ledger recovers.
    refundWallet.failingOrderIds.delete(second.orderId);
    const recovered = await postTransition(admin, drawId, {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });

    expect(recovered.status).toBe(201);
    expect(await recovered.json()).toEqual({
      draw: { id: drawId, state: "CANCELLED", version: 5 },
      refund: {
        considered: 1,
        refunded: 1,
        alreadyRefunded: 0,
        outstanding: 0,
        refundedStakeMinor: "200",
        obligationsSatisfied: true,
      },
    });

    // Convergence, not a second refund: exactly one reversal per Order.
    const secondOrderAfter = await prisma.betOrder.findUniqueOrThrow({
      where: { id: second.orderId },
    });
    expect(secondOrderAfter.state).toBe("CANCELLED");
    expect(secondOrderAfter.refundTransactionId).not.toBeNull();
    expect(await refundTransactionsFor(second.orderId, secondMember)).toBe(1);
    expect(await refundTransactionsFor(first.orderId, firstMember)).toBe(1);
    expect(await cashAvailable(firstMember)).toBe(startingCash);
    expect(await cashAvailable(secondMember)).toBe(startingCash);
  }, HTTP_TEST_TIMEOUT_MS);
});

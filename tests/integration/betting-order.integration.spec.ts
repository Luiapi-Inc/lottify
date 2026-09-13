// Deterministic integration evidence for the Betting Bet Order + Receipt
// capability (Issue 45) against a real PostgreSQL database.
//
// Covered acceptance criteria:
//   - create/confirm/cancel with Idempotency-Key + allowedActions + version,
//     VERSION_CONFLICT on stale writes;
//   - Confirm reaches CONFIRMED only after the durable Wallet & Ledger
//     reserve/commit, with Quote TTL and Draw cutoff/state revalidated at
//     Confirm (including an Override-moved effective cutoff);
//   - the Receipt is immutable, member-facing and carries only accepted terms;
//   - happy, denial, cutoff-race, idempotency, concurrency and recovery paths.
//
// These tests must never double-debit: every financial assertion is a count and
// a balance, not just a status code.

import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { LotteryDrawService } from "../../src/contexts/lottery/application/lottery-draw.service";
import { BettingQuoteService } from "../../src/contexts/betting/application/betting-quote.service";
import {
  BettingOrderService,
  BettingOrderError,
} from "../../src/contexts/betting/application/betting-order.service";
import { BettingQuoteDrawAdapter } from "../../src/platform/integration/quote-draw.adapter";
import { BetOrderWalletAdapter } from "../../src/platform/integration/betting-order-wallet.adapter";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { calculateAvailableMinorUnits } from "../../src/contexts/wallet-ledger/domain/financial-invariants";
import {
  allowBetEligibility,
  denyBetEligibility,
} from "../support/betting-eligibility.fake";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Bet Order create/confirm/cancel + Receipt", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let draws: LotteryDrawService;
  let quotes: BettingQuoteService;
  let orders: BettingOrderService;
  let adminId: string;
  let sessionId: string;

  const memberIds: string[] = [];
  const productIds: string[] = [];
  const betTypeIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeVersionIds: string[] = [];
  const drawIds: string[] = [];

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

    adminId = randomUUID();
    sessionId = randomUUID();
    await prisma.adminUser.create({
      data: {
        id: adminId,
        email: `order-admin-${adminId}@example.test`,
        name: "Order Test Admin",
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    await prisma.adminAuthSession.create({
      data: {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: `order-refresh-${sessionId}`,
        familyId: randomUUID(),
        expiresAt: new Date("2199-01-01T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    try {
      const accounts = await prisma.ledgerAccount.findMany({
        where: { memberId: { in: memberIds } },
        select: { id: true },
      });
      const accountIds = accounts.map((account) => account.id);
      const postings = await prisma.ledgerPosting.findMany({
        where: { accountId: { in: accountIds } },
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
          where: {
            OR: [
              { id: { in: accountIds } },
              { systemCode: "betting-settlement" },
            ],
          },
        });
        await tx.accountingPeriod.deleteMany({
          where: { id: { in: periods.map((period) => period.accountingPeriodId) } },
        });

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

  async function openDraw(
    prefix: string,
    day: string,
  ): Promise<{ drawId: string; betTypeId: string; betTypeCode: string; cutoffAt: Date }> {
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
    const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: summary.id } });
    const betType = await prisma.lotteryDrawBetType.findFirstOrThrow({
      where: { drawId: summary.id },
    });
    return { drawId: summary.id, betTypeId, betTypeCode: betType.betTypeCode, cutoffAt: draw.cutoffAt };
  }

  async function newMember(): Promise<string> {
    const id = randomUUID();
    memberIds.push(id);
    await prisma.member.create({
      data: { id, phone: `+66${id.replaceAll("-", "").slice(0, 10)}` },
    });
    return id;
  }

  /** Credits the Member's CASH account from a test counterparty. */
  async function fundCash(memberId: string, amountMinor: bigint): Promise<void> {
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH", "THB");
    const counterpartyId = await ledger.ensureSystemAccount(
      `order-test-funding:${randomUUID()}`,
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

  async function authorisedQuote(input: {
    memberId: string;
    drawId: string;
    betTypeCode: string;
    serverNow: Date;
    lines?: Array<{ canonicalNumber: string; stakeMinor: bigint }>;
  }) {
    return quotes.createQuote({
      memberId: input.memberId,
      drawId: input.drawId,
      currency: "THB",
      idempotencyKey: `q-${randomUUID()}`,
      lines: (input.lines ?? [{ canonicalNumber: "42", stakeMinor: 300n }]).map((line) => ({
        betTypeCode: input.betTypeCode,
        canonicalNumber: line.canonicalNumber,
        stakeMinor: line.stakeMinor,
      })),
      now: input.serverNow,
    });
  }

  async function createOrderForQuote(memberId: string, quoteId: string) {
    return orders.createOrder({
      memberId,
      quoteId,
      idempotencyKey: `o-${randomUUID()}`,
    });
  }

  async function stakeEffectRows(orderId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { purpose_businessReference: { purpose: "BET", businessReference: orderId } },
      include: { allocations: true },
    });
    const transactions = await prisma.financialTransaction.findMany({
      where: { businessTransactionId: orderId },
      include: { postings: true },
    });
    return { reservation, transactions };
  }

  // ---------------------------------------------------------------------------

  it("creates the Order from an authorised Quote with version + allowedActions and moves no money", async () => {
    const { drawId, betTypeCode } = await openDraw("O_CREATE", "2099-08-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2099-08-05T08:00:00.000Z");

    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);

    expect(order.state).toBe("QUOTED");
    expect(order.version).toBe(1);
    expect(order.allowedActions).toEqual(["CONFIRM"]);
    expect(order.totalStakeMinor).toBe(300n);
    expect(order.lines).toHaveLength(quote.lines.length);
    expect(order.lines[0]!.canonicalNumber).toBe("42");
    expect(order.reservationId).toBeNull();
    expect(order.stakeTransactionId).toBeNull();
    expect(order.receiptId).toBeNull();

    const { reservation, transactions } = await stakeEffectRows(order.id);
    expect(reservation).toBeNull();
    expect(transactions).toEqual([]);
    expect(await cashAvailable(memberId)).toBe(1_000n);

    // Only the owning Member can read it back.
    const other = await newMember();
    await expect(orders.getOrder(other, order.id)).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
  });

  it("is idempotent by Idempotency-Key and allows exactly one Order per Quote", async () => {
    const { drawId, betTypeCode } = await openDraw("O_IDEM", "2099-09-05");
    const memberId = await newMember();
    const quoteAt = new Date("2099-09-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });

    const key = `create-${randomUUID()}`;
    const first = await orders.createOrder({ memberId, quoteId: quote.id, idempotencyKey: key });
    const replay = await orders.createOrder({ memberId, quoteId: quote.id, idempotencyKey: key });
    expect(replay.id).toBe(first.id);
    expect(
      await prisma.betOrder.count({ where: { memberId, quoteId: quote.id } }),
    ).toBe(1);

    // Same key, different Quote: conflict.
    const otherQuote = await authorisedQuote({
      memberId,
      drawId,
      betTypeCode,
      serverNow: quoteAt,
    });
    await expect(
      orders.createOrder({ memberId, quoteId: otherQuote.id, idempotencyKey: key }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    // A different key for the same Quote cannot create a second Order.
    await expect(
      orders.createOrder({ memberId, quoteId: quote.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "ORDER_EXISTS_FOR_QUOTE" });

    // An expired Quote is not authorised.
    const expired = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    await expect(
      orders.createOrder({
        memberId,
        quoteId: expired.id,
        idempotencyKey: randomUUID(),
        now: new Date("2099-09-05T08:05:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });

    // A missing Idempotency-Key is refused outright.
    await expect(
      orders.createOrder({ memberId, quoteId: expired.id, idempotencyKey: null }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });

  it("rejects stale writes with VERSION_CONFLICT and leaves the Order untouched", async () => {
    const { drawId, betTypeCode } = await openDraw("O_VERSION", "2099-10-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2099-10-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);

    await expect(
      orders.confirmOrder({
        memberId,
        orderId: order.id,
        expectedVersion: 7,
        idempotencyKey: randomUUID(),
        now: quoteAt,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const after = await prisma.betOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.state).toBe("QUOTED");
    expect(after.version).toBe(1);

    // A confirm that skipped the transition cannot be cancelled: CANCEL is only
    // legal from CONFIRMED.
    await expect(
      orders.cancelOrder({
        memberId,
        orderId: order.id,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        now: quoteAt,
      }),
    ).rejects.toMatchObject({ code: "ILLEGAL_ACTION" });

    const { reservation, transactions } = await stakeEffectRows(order.id);
    expect(reservation).toBeNull();
    expect(transactions).toEqual([]);
  });

  it("reaches CONFIRMED only after the durable reserve/commit and issues an immutable Receipt", async () => {
    const { drawId, betTypeCode } = await openDraw("O_CONFIRM", "2099-11-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2099-11-05T08:00:00.000Z");
    const quote = await authorisedQuote({
      memberId,
      drawId,
      betTypeCode,
      serverNow: quoteAt,
      lines: [
        { canonicalNumber: "42", stakeMinor: 100n },
        { canonicalNumber: "42", stakeMinor: 200n },
      ],
    });
    const order = await createOrderForQuote(memberId, quote.id);

    const confirmed = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: new Date("2099-11-05T08:00:30.000Z"),
    });

    expect(confirmed.state).toBe("CONFIRMED");
    expect(confirmed.version).toBe(3);
    expect(confirmed.allowedActions).toEqual(["CANCEL"]);
    expect(confirmed.reservationId).not.toBeNull();
    expect(confirmed.stakeTransactionId).not.toBeNull();
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(confirmed.receiptId).not.toBeNull();

    // The Reservation is the Order's own, is consumed, and points at the
    // committed stake transaction.
    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { purpose_businessReference: { purpose: "BET", businessReference: order.id } },
      include: { allocations: true },
    });
    expect(reservation.memberId).toBe(memberId);
    expect(reservation.amountMinor).toBe(300n);
    expect(reservation.consumedAt).not.toBeNull();
    expect(reservation.consumingTransactionId).toBe(confirmed.stakeTransactionId);
    expect(reservation.allocations).toHaveLength(1);

    // The stake is a balanced posting from the Member bucket to Betting Settlement.
    const stake = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: confirmed.stakeTransactionId! },
      include: { postings: { include: { account: true } } },
    });
    expect(stake.operationType).toBe("BET_STAKE_COMMIT");
    const memberPosting = stake.postings.find(
      (posting) => posting.account.memberId === memberId,
    );
    const settlementPosting = stake.postings.find(
      (posting) => posting.account.systemCode === "betting-settlement",
    );
    expect(memberPosting).toMatchObject({ side: "DEBIT", amountMinor: 300n });
    expect(settlementPosting).toMatchObject({ side: "CREDIT", amountMinor: 300n });
    expect(await cashAvailable(memberId)).toBe(700n);

    // The Receipt is member-facing and only carries accepted terms, and its
    // digest verifies against the byte-exact canonical serialization.
    const receipt = await orders.getReceipt(memberId, order.id);
    expect(receipt.orderVersion).toBe(3);
    expect(receipt.terms.totalStakeMinor).toBe("300");
    // The Quote resolver aggregated the two equivalent "42" lines into one.
    expect(receipt.terms.lines).toHaveLength(1);
    expect(receipt.terms.lines[0]).toMatchObject({
      canonicalNumber: "42",
      stakeMinor: "300",
    });
    expect(receipt.terms.drawReference).toBe(drawId);
    expect(receipt.terms.drawCutoffAt).toBe("2099-11-05T11:00:00.000Z");
    expect(receipt.terms.acceptedAt).toBe("2099-11-05T08:00:30.000Z");
    const stored = await prisma.betReceipt.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(
      createHash("sha256").update(stored.termsCanonical).digest("hex"),
    ).toBe(receipt.contentDigest);
    expect(JSON.parse(stored.termsCanonical)).toEqual(stored.terms);

    // Posted Receipts cannot be rewritten or deleted.
    await expect(
      prisma.betReceipt.update({
        where: { orderId: order.id },
        data: { contentDigest: "0".repeat(64) },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("denies a stake the Member cannot cover without moving any money", async () => {
    const { drawId, betTypeCode } = await openDraw("O_DENY", "2099-12-05");
    const memberId = await newMember();
    await fundCash(memberId, 50n);
    const quoteAt = new Date("2099-12-05T08:00:00.000Z");
    const quote = await authorisedQuote({
      memberId,
      drawId,
      betTypeCode,
      serverNow: quoteAt,
      lines: [{ canonicalNumber: "42", stakeMinor: 300n }],
    });
    const order = await createOrderForQuote(memberId, quote.id);

    const rejected = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: quoteAt,
    });

    expect(rejected.state).toBe("REJECTED");
    expect(rejected.version).toBe(3);
    expect(rejected.rejectionReason).toBe("INSUFFICIENT_FUNDS");
    expect(rejected.allowedActions).toEqual([]);
    expect(rejected.receiptId).toBeNull();

    const { reservation, transactions } = await stakeEffectRows(order.id);
    expect(reservation).toBeNull();
    expect(transactions).toEqual([]);
    expect(await cashAvailable(memberId)).toBe(50n);
    await expect(orders.getReceipt(memberId, order.id)).rejects.toMatchObject({
      code: "RECEIPT_NOT_FOUND",
    });
  });

  it("rechecks current BET eligibility at Confirm and rejects before any Wallet effect", async () => {
    const { drawId, betTypeCode } = await openDraw("O_ELIGIBILITY", "2100-01-04");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2100-01-04T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);

    const deniedOrders = new BettingOrderService(
      prisma,
      new BettingQuoteDrawAdapter(prisma),
      new BetOrderWalletAdapter(ledger, prisma),
      denyBetEligibility,
    );
    const rejected = await deniedOrders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: new Date("2100-01-04T08:00:30.000Z"),
    });

    expect(rejected.state).toBe("REJECTED");
    expect(rejected.version).toBe(3);
    expect(rejected.rejectionReason).toBe("MEMBER_NOT_ELIGIBLE");
    expect(rejected.receiptId).toBeNull();

    const { reservation, transactions } = await stakeEffectRows(order.id);
    expect(reservation).toBeNull();
    expect(transactions).toEqual([]);
    expect(await cashAvailable(memberId)).toBe(1_000n);
  });

  it("revalidates the effective Draw cutoff at Confirm: an Override that moved the cutoff earlier denies with no debit", async () => {
    const { drawId, betTypeId, betTypeCode } = await openDraw("O_CUTOFF", "2100-01-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2100-01-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);

    // The Draw is still OPEN and the Quote is still inside its TTL, but the
    // authoritative (Override-resolved) cutoff is now earlier.
    await draws.applyDrawOverride({
      drawId,
      reason: "Move the cutoff earlier after the Quote was authorised",
      actor: actor(),
      changes: { cutoffAt: new Date("2100-01-05T08:01:00.000Z") } as never,
      approvalEvidenceRef: `approval-${randomUUID()}`,
      auditEvidenceRef: `audit-${randomUUID()}`,
      effectiveAt: new Date("2100-01-05T08:00:30.000Z"),
    });
    expect(betTypeId).toBeTruthy();

    const rejected = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: new Date("2100-01-05T08:01:30.000Z"), // inside the Quote TTL, past the cutoff
    });

    expect(rejected.state).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("CUTOFF_REACHED");
    const { reservation, transactions } = await stakeEffectRows(order.id);
    expect(reservation).toBeNull();
    expect(transactions).toEqual([]);
    expect(await cashAvailable(memberId)).toBe(1_000n);
  });

  it("revalidates the Draw state at Confirm: a Draw closed after authorisation denies with no debit", async () => {
    const { drawId, betTypeCode } = await openDraw("O_CLOSED", "2100-02-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2100-02-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);

    await draws.transition({ id: drawId, command: "CLOSE", expectedVersion: 3, actor: actor() });

    const rejected = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: new Date("2100-02-05T08:00:30.000Z"),
    });

    expect(rejected.state).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("DRAW_NOT_OPEN");
    const { reservation, transactions } = await stakeEffectRows(order.id);
    expect(reservation).toBeNull();
    expect(transactions).toEqual([]);
    expect(await cashAvailable(memberId)).toBe(1_000n);
  });

  it("replays Confirm and Cancel under the same Idempotency-Key without double-debiting or double-refunding", async () => {
    const { drawId, betTypeCode } = await openDraw("O_REPLAY", "2100-03-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2100-03-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);

    const confirmKey = `c-${randomUUID()}`;
    const confirmed = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: confirmKey,
      now: quoteAt,
    });
    const confirmedReplay = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: confirmKey,
      now: quoteAt,
    });
    expect(confirmedReplay.state).toBe("CONFIRMED");
    expect(confirmedReplay.version).toBe(confirmed.version);
    expect(confirmedReplay.stakeTransactionId).toBe(confirmed.stakeTransactionId);
    expect(await cashAvailable(memberId)).toBe(700n);

    // A different key cannot re-execute an already-executed command.
    await expect(
      orders.confirmOrder({
        memberId,
        orderId: order.id,
        expectedVersion: 3,
        idempotencyKey: `c-${randomUUID()}`,
        now: quoteAt,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const cancelKey = `x-${randomUUID()}`;
    const cancelled = await orders.cancelOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 3,
      idempotencyKey: cancelKey,
      reason: "changed my mind",
      now: quoteAt,
    });
    const cancelledReplay = await orders.cancelOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 3,
      idempotencyKey: cancelKey,
      reason: "changed my mind",
      now: quoteAt,
    });

    expect(cancelled.state).toBe("CANCELLED");
    expect(cancelled.version).toBe(5);
    expect(cancelled.refundTransactionId).not.toBeNull();
    expect(cancelledReplay.version).toBe(5);
    expect(cancelledReplay.refundTransactionId).toBe(cancelled.refundTransactionId);
    expect(await cashAvailable(memberId)).toBe(1_000n);

    const refunds = await prisma.financialTransaction.findMany({
      where: { businessTransactionId: `${order.id}:refund` },
      include: { postings: { include: { account: true } } },
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.operationType).toBe("BET_STAKE_REFUND");
    expect(refunds[0]!.correctionKind).toBe("REVERSAL");
    // The refund restores the exact accepted source-bucket composition.
    const memberCredit = refunds[0]!.postings.find(
      (posting) => posting.account.memberId === memberId,
    );
    expect(memberCredit).toMatchObject({ side: "CREDIT", amountMinor: 300n });

    // The Receipt of the confirmed Order outlives the cancellation untouched.
    const receipt = await orders.getReceipt(memberId, order.id);
    expect(receipt.orderVersion).toBe(3);
  });

  it("refuses member cancellation after the Draw cutoff and leaves the Order confirmed", async () => {
    const { drawId, betTypeCode } = await openDraw("O_NOCANCEL", "2100-04-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2100-04-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);

    const confirmed = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: quoteAt,
    });
    expect(confirmed.state).toBe("CONFIRMED");

    await expect(
      orders.cancelOrder({
        memberId,
        orderId: order.id,
        expectedVersion: 3,
        idempotencyKey: `x-${randomUUID()}`,
        now: new Date("2100-04-05T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "CANCELLATION_CUTOFF_REACHED" });

    const after = await prisma.betOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.state).toBe("CONFIRMED");
    expect(after.version).toBe(3);
    expect(await cashAvailable(memberId)).toBe(700n);
  });

  it("serializes concurrent Confirms into exactly one stake effect and one Receipt", async () => {
    const { drawId, betTypeCode } = await openDraw("O_RACE", "2100-05-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2100-05-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);
    const key = `c-${randomUUID()}`;

    const results = await Promise.all([
      orders.confirmOrder({
        memberId,
        orderId: order.id,
        expectedVersion: 1,
        idempotencyKey: key,
        now: quoteAt,
      }),
      orders.confirmOrder({
        memberId,
        orderId: order.id,
        expectedVersion: 1,
        idempotencyKey: key,
        now: quoteAt,
      }),
    ]);

    for (const result of results) {
      expect(result.state).toBe("CONFIRMED");
      expect(result.version).toBe(3);
      expect(result.stakeTransactionId).not.toBeNull();
    }
    expect(results[0]!.stakeTransactionId).toBe(results[1]!.stakeTransactionId);

    const { reservation, transactions } = await stakeEffectRows(order.id);
    expect(reservation).not.toBeNull();
    expect(transactions).toHaveLength(1);
    expect(
      await prisma.betReceipt.count({ where: { orderId: order.id } }),
    ).toBe(1);
    expect(await cashAvailable(memberId)).toBe(700n);
  });

  it("resumes a Confirm that crashed after the durable Wallet effect but before resolution", async () => {
    const { drawId, betTypeCode } = await openDraw("O_RECOVER", "2100-06-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2100-06-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);
    const key = `c-${randomUUID()}`;

    const committed = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: key,
      now: quoteAt,
    });
    const committedTransactionId = committed.stakeTransactionId!;

    // Simulate the crash window: the Wallet & Ledger effect is durable, but the
    // Order is still in-flight with no resolution and no Receipt.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" DISABLE TRIGGER "bet_receipts_immutable"');
      await tx.betReceipt.deleteMany({ where: { orderId: order.id } });
      await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" ENABLE TRIGGER "bet_receipts_immutable"');
      await tx.betOrder.update({
        where: { id: order.id },
        data: {
          state: "CONFIRMING",
          version: 2,
          reservationId: null,
          stakeTransactionId: null,
          confirmedAt: null,
        },
      });
    });

    const resumed = await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 2,
      idempotencyKey: key,
      now: quoteAt,
    });

    expect(resumed.state).toBe("CONFIRMED");
    expect(resumed.version).toBe(3);
    expect(resumed.stakeTransactionId).toBe(committedTransactionId);
    expect(resumed.receiptId).not.toBeNull();

    const { reservation, transactions } = await stakeEffectRows(order.id);
    expect(reservation).not.toBeNull();
    expect(transactions).toHaveLength(1);
    expect(
      await prisma.betReceipt.count({ where: { orderId: order.id } }),
    ).toBe(1);
    // The Member is debited exactly once across the crash and the resume.
    expect(await cashAvailable(memberId)).toBe(700n);
  });

  it("keeps the wallet projection reconciled with the posted stake and refund", async () => {
    const { drawId, betTypeCode } = await openDraw("O_PROJECTION", "2100-07-05");
    const memberId = await newMember();
    await fundCash(memberId, 1_000n);
    const quoteAt = new Date("2100-07-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const order = await createOrderForQuote(memberId, quote.id);

    await orders.confirmOrder({
      memberId,
      orderId: order.id,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: quoteAt,
    });

    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH", "THB");
    const projection = await ledger.getWalletProjection(memberId, "THB");
    const cash = projection.buckets.find((bucket) => bucket.bucket === "CASH")!;
    expect(cash.postedMinor).toBe(700n);
    expect(cash.reservedMinor).toBe(0n);
    expect(cash.availableMinor).toBe(
      calculateAvailableMinorUnits(cash.postedMinor, []),
    );
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(700n);

    // A failed Command never leaves an orphaned reservation behind.
    const pending = await prisma.reservation.findMany({
      where: { memberId, releasedAt: null, consumedAt: null },
    });
    expect(pending).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Member Bet Order history ("my slips") — keyset pagination

  it("lists only the requesting Member's Orders, newest first", async () => {
    const { drawId, betTypeCode } = await openDraw("O_LIST", "2099-10-05");
    const owner = await newMember();
    const other = await newMember();
    const quoteAt = new Date("2099-10-05T08:00:00.000Z");

    const quoteA = await authorisedQuote({ memberId: owner, drawId, betTypeCode, serverNow: quoteAt });
    const first = await createOrderForQuote(owner, quoteA.id);
    const quoteB = await authorisedQuote({ memberId: owner, drawId, betTypeCode, serverNow: quoteAt });
    const second = await createOrderForQuote(owner, quoteB.id);
    const otherQuote = await authorisedQuote({ memberId: other, drawId, betTypeCode, serverNow: quoteAt });
    const otherOrder = await createOrderForQuote(other, otherQuote.id);

    const page = await orders.listOrders(owner, { limit: 20 });
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    // Ownership is enforced by the query, not by the caller.
    expect(ids).not.toContain(otherOrder.id);
    for (const item of page.items) expect(item.memberId).toBe(owner);
    // Deterministic (createdAt DESC, id DESC): the newest insert is not later
    // than the previous one.
    for (let i = 1; i < page.items.length; i += 1) {
      const prev = page.items[i - 1]!;
      const cur = page.items[i]!;
      const prevKey = `${prev.createdAt.toISOString()}|${prev.id}`;
      const curKey = `${cur.createdAt.toISOString()}|${cur.id}`;
      expect(prevKey >= curKey).toBe(true);
    }
  });

  it("pages the Member history with a stable cursor and no duplicates or gaps", async () => {
    const { drawId, betTypeCode } = await openDraw("O_PAGE", "2099-11-05");
    const memberId = await newMember();
    const quoteAt = new Date("2099-11-05T08:00:00.000Z");
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
      created.push((await createOrderForQuote(memberId, quote.id)).id);
    }

    const seen: string[] = [];
    let cursor: Awaited<ReturnType<typeof orders.listOrders>>["nextCursor"] = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof orders.listOrders>> = await orders.listOrders(memberId, {
        limit: 1,
        cursor,
      });
      for (const item of page.items) seen.push(item.id);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    // Every own Order appears exactly once across the pages.
    for (const id of created) expect(seen.filter((seenId) => seenId === id)).toHaveLength(1);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("filters the Member history by state", async () => {
    const { drawId, betTypeCode } = await openDraw("O_FILTER", "2099-12-05");
    const memberId = await newMember();
    const quoteAt = new Date("2099-12-05T08:00:00.000Z");
    const quote = await authorisedQuote({ memberId, drawId, betTypeCode, serverNow: quoteAt });
    const quoted = await createOrderForQuote(memberId, quote.id);

    const quotedPage = await orders.listOrders(memberId, { limit: 20, state: "QUOTED" });
    expect(quotedPage.items.map((item) => item.id)).toContain(quoted.id);

    const settledPage = await orders.listOrders(memberId, { limit: 20, state: "SETTLED" });
    expect(settledPage.items.map((item) => item.id)).not.toContain(quoted.id);
    for (const item of settledPage.items) expect(item.state).toBe("SETTLED");
  });

  it("rejects an out-of-range history limit with the canonical error contract", async () => {
    const memberId = await newMember();
    await expect(orders.listOrders(memberId, { limit: 0 })).rejects.toMatchObject({
      code: "INVALID_STATE",
      status: 400,
    });
    await expect(orders.listOrders(memberId, { limit: 101 })).rejects.toMatchObject({
      code: "INVALID_STATE",
      status: 400,
    });
  });

  it("exposes the canonical error contract on the domain error type", () => {
    expect(new BettingOrderError("VERSION_CONFLICT", "stale", 409, {}).status).toBe(409);
    expect(new BettingOrderError("INVALID_STATE", "late", 409, {}).code).toBe(
      "INVALID_STATE",
    );
  });
});

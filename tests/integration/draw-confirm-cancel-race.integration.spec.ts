// Confirm/cancel race evidence for the Draw admission boundary (Issue 117
// rework, ADR 0001 workflow 5) against a real (non-prod) PostgreSQL database.
//
// The blocking review finding was: a CONFIRMING Bet Order can pass its
// Draw-is-OPEN check, be invisible to the cancelled-Draw refund scan (it has no
// committed stake yet), let the Draw terminalize CANCELLED, and only then
// commit its stake — Member money committed to a cancelled Draw with no refund
// obligation recorded.
//
// This spec proves the fix at the PostgreSQL level, not with in-memory doubles:
// every write goes through the production services, the production Prisma
// repository and the real ledger, and the interleavings are driven by explicit
// gates so the outcome does not depend on timing. Blocking is asserted from
// `pg_locks` — the same advisory lock the production boundary takes — so the
// "waited for the other writer" claim is a database fact, not an assumption.
//
// Interleavings covered:
//   1. cancellation holds the boundary first -> a confirm contends, is waited
//      out, terminalizes nothing, and is REFUSED after CANCELLED with zero
//      money moved (the review's exact scenario);
//   2. confirm holds the boundary first -> the cancellation waits, then sees the
//      newly CONFIRMED order and refunds it, so the stake cannot escape the
//      scan (the reverse order of the same race);
//   3. the boundary is per Draw: a cancellation holding Draw A's boundary does
//      not block a confirm against Draw B (no over-serialisation).

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
import {
  PrismaDrawAdmissionBoundary,
  DRAW_ADMISSION_LOCK_NAMESPACE,
  drawAdmissionLockKey,
} from "../../src/platform/concurrency/prisma-draw-admission.boundary";
import type {
  DrawAdmissionBoundary,
} from "../../src/platform/concurrency/draw-admission.port";
import type {
  BetOrderWalletPort,
  BetStakeEffect,
} from "../../src/contexts/betting/application/betting-order-wallet.port";
import type {
  DrawRefundPort,
  DrawRefundRunResult,
  DrawRefundObligationView,
} from "../../src/contexts/lottery/application/draw-refund.port";
import { allowBetEligibility } from "../support/betting-eligibility.fake";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

/**
 * The shared dev PostgreSQL is remote and the default vitest budgets (10s hook,
 * 15s test) are too tight for it: a hook that connects and seeds two rows can
 * legitimately take longer when the box is loaded. The flows themselves are
 * gate-driven and take well under a second.
 */
const HOOK_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

/**
 * A promise pair used to force one interleaving: `signal()` resolves `arrived`,
 * `release()` resolves the wait. Nothing here inserts a delay — the tests only
 * choose which of two writers reaches the boundary first.
 */
function gate(): {
  arrived: Promise<void>;
  signal: () => void;
  release: () => void;
  wait: () => Promise<void>;
  armed: boolean;
} {
  let signal!: () => void;
  let release!: () => void;
  let armed = true;
  const arrived = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arrived,
    signal: () => signal(),
    release: () => release(),
    wait: () => waiting,
    get armed() {
      return armed;
    },
  };
}

/** Wraps the production admission boundary to hold a caller before it locks. */
class GatedAdmissionBoundary implements DrawAdmissionBoundary {
  holdBeforeLock: (() => Promise<void>) | null = null;
  admissions = 0;

  constructor(private readonly inner: DrawAdmissionBoundary) {}

  async admit<T>(drawId: string, work: () => Promise<T>): Promise<T> {
    this.admissions += 1;
    const hold = this.holdBeforeLock;
    if (hold) {
      this.holdBeforeLock = null;
      await hold();
    }
    return this.inner.admit(drawId, work);
  }
}

/**
 * Wraps the production wallet port. `commitStake` runs INSIDE the admission
 * boundary, so holding it holds the boundary (and the PostgreSQL lock) open.
 */
class GatedWalletPort implements BetOrderWalletPort {
  constructor(private readonly inner: BetOrderWalletPort) {}

  holdInsideCommit: (() => Promise<void>) | null = null;
  commitCalls = 0;

  async commitStake(input: {
    orderId: string;
    memberId: string;
    drawId: string;
    amountMinor: bigint;
    currency: "THB";
    correlationId: string;
    acceptedAt: Date;
  }): Promise<BetStakeEffect> {
    this.commitCalls += 1;
    const hold = this.holdInsideCommit;
    if (hold) {
      this.holdInsideCommit = null;
      await hold();
    }
    return this.inner.commitStake(input);
  }

  refundStake(input: {
    orderId: string;
    memberId: string;
    stakeTransactionId: string;
    currency: "THB";
    correlationId: string;
  }): Promise<BetStakeEffect> {
    return this.inner.refundStake(input);
  }
}

/** Wraps the production refund seam to observe/hold the cancellation scan. */
class GatedRefundPort implements DrawRefundPort {
  holdScan: (() => Promise<void>) | null = null;
  scanStarted = 0;

  constructor(private readonly inner: DrawRefundPort) {}

  async refundCommittedStakesForDraw(input: {
    drawId: string;
    reason?: string | null;
    now?: Date;
  }): Promise<DrawRefundRunResult> {
    this.scanStarted += 1;
    const hold = this.holdScan;
    if (hold) {
      this.holdScan = null;
      await hold();
    }
    return this.inner.refundCommittedStakesForDraw(input);
  }

  listOutstandingRefundObligations(
    drawId: string,
  ): Promise<readonly DrawRefundObligationView[]> {
    return this.inner.listOutstandingRefundObligations(drawId);
  }
}

describe.runIf(runIntegration)("Draw admission boundary: confirm vs cancellation race", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let draws: LotteryDrawService;
  let wallet: GatedWalletPort;
  let admission: GatedAdmissionBoundary;
  let refundPort: GatedRefundPort;
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
  const fundingAccountIds: string[] = [];

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
    wallet = new GatedWalletPort(new BetOrderWalletAdapter(ledger, prisma));
    admission = new GatedAdmissionBoundary(
      new PrismaDrawAdmissionBoundary(prisma),
    );
    refundPort = new GatedRefundPort(
      new DrawRefundAdapter(
        new DrawStakeRefundService(
          new PrismaStakeRefundRepository(prisma),
          new BetOrderWalletAdapter(ledger, prisma),
        ),
      ),
    );
    orchestrator = new DrawCancellationOrchestrator(
      refundPort,
      draws,
      admission,
    );

    adminId = randomUUID();
    sessionId = randomUUID();
    await prisma.adminUser.create({
      data: {
        id: adminId,
        email: `draw-race-${adminId}@example.test`,
        name: "Draw Race Test Admin",
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    await prisma.adminAuthSession.create({
      data: {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: `race-refresh-${sessionId}`,
        familyId: randomUUID(),
        expiresAt: new Date("2199-01-01T00:00:00.000Z"),
        userAgent: "test",
        ipAddress: "127.0.0.1",
        createdAt: new Date(),
      },
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
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
      await tx.adminUser.deleteMany({ where: { id: adminId } });

      await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" ENABLE TRIGGER "lottery_product_version_links_immutable"');
      await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" ENABLE TRIGGER "bet_receipts_immutable"');
    });
    await prisma.$disconnect();
  }, HOOK_TIMEOUT_MS);

  async function publishedProductFixture(prefix: string): Promise<string> {
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
    return productId;
  }

  async function openDraw(
    prefix: string,
    day: string,
  ): Promise<{ drawId: string; betTypeCode: string }> {
    const productId = await publishedProductFixture(prefix);

    const occurrence = {
      occurrenceIdentity: `${productId}-${day}`,
      localDate: day,
      openAt: new Date(`${day}T06:00:00.000Z`),
      cutoffAt: new Date(`${day}T11:00:00.000Z`),
      drawAt: new Date(`${day}T12:00:00.000Z`),
      provenance: "SCHEDULE_GENERATED" as const,
    };
    const summary = (
      await draws.generateDraws({
        productId,
        baseOccurrences: [occurrence],
        actor: actor(),
      })
    ).created[0]!;
    drawIds.push(summary.id);
    await draws.transition({
      id: summary.id,
      command: "SCHEDULE",
      expectedVersion: 1,
      actor: actor(),
    });
    await draws.transition({
      id: summary.id,
      command: "OPEN",
      expectedVersion: 2,
      actor: actor(),
    });
    const betType = await prisma.lotteryDrawBetType.findFirstOrThrow({
      where: { drawId: summary.id },
    });
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
      `race-test-funding:${randomUUID()}`,
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

  function orderServiceFor(gatedWallet: GatedWalletPort): BettingOrderService {
    return new BettingOrderService(
      prisma,
      new BettingQuoteDrawAdapter(prisma),
      gatedWallet,
      allowBetEligibility,
      admission,
    );
  }

  /** A QUOTED Bet Order (no Confirm yet) for the given Draw. */
  async function quotedOrder(
    drawId: string,
    betTypeCode: string,
    memberId: string,
    stakeMinor: bigint,
  ): Promise<string> {
    const quotes = new BettingQuoteService(
      prisma,
      new BettingQuoteDrawAdapter(prisma),
      allowBetEligibility,
    );
    const quote = await quotes.createQuote({
      memberId,
      drawId,
      currency: "THB",
      idempotencyKey: `q-${randomUUID()}`,
      lines: [{ betTypeCode, canonicalNumber: "42", stakeMinor }],
      now: new Date(),
    });
    const orders = orderServiceFor(wallet);
    const order = await orders.createOrder({
      memberId,
      quoteId: quote.id,
      idempotencyKey: `o-${randomUUID()}`,
    });
    orderIds.push(order.id);
    return order.id;
  }

  async function orderRow(orderId: string) {
    return prisma.betOrder.findUniqueOrThrow({ where: { id: orderId } });
  }

  async function committeeMoneyMovementCount(orderId: string): Promise<number> {
    return prisma.financialTransaction.count({
      where: { businessTransactionId: orderId },
    });
  }

  async function refundCountForOrder(orderId: string, memberId: string): Promise<number> {
    const refunds = await prisma.financialTransaction.findMany({
      where: { operationType: "BET_STAKE_REFUND" },
      include: { postings: { include: { account: true } } },
    });
    return refunds.filter(
      (tx) =>
        tx.domainReferences !== null &&
        (tx.domainReferences as { orderId?: string }).orderId === orderId &&
        tx.postings.some((posting) => posting.account.memberId === memberId),
    ).length;
  }

  /**
   * The PostgreSQL fact behind "this writer is waiting": the Draw's advisory
   * lock, as the database itself reports it. `granted` counts the holders,
   * `waiting` counts the transactions queued on the same lock.
   */
  async function advisoryLockState(
    drawId: string,
  ): Promise<{ granted: number; waiting: number }> {
    const key = drawAdmissionLockKey(drawId);
    const rows = await prisma.$queryRaw<
      Array<{ granted: boolean; classid: bigint; objid: bigint; objsubid: number }>
    >`SELECT granted, classid::bigint AS classid, objid::bigint AS objid, objsubid
        FROM pg_locks WHERE locktype = 'advisory'`;
    const asSignedInt4 = (value: bigint): number =>
      Number(value > 2147483647n ? value - 4294967296n : value);
    // Matched on the namespace + key pair this boundary owns. `objsubid` is
    // reported for the same lock in the driver's plan, so it is not part of the
    // filter.
    const mine = rows.filter(
      (row) =>
        Number(row.classid) === DRAW_ADMISSION_LOCK_NAMESPACE &&
        asSignedInt4(BigInt(row.objid)) === key,
    );
    return {
      granted: mine.filter((row) => row.granted).length,
      waiting: mine.filter((row) => !row.granted).length,
    };
  }

  /** Polls pg_locks until the Draw's lock has a holder and a waiter. */
  async function waitForLockWaiter(drawId: string): Promise<{ granted: number; waiting: number }> {
    const deadline = Date.now() + 15_000;
    let observed = { granted: 0, waiting: 0 };
    while (Date.now() < deadline) {
      observed = await advisoryLockState(drawId);
      if (observed.granted >= 1 && observed.waiting >= 1) return observed;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `no advisory-lock waiter appeared for Draw ${drawId}: ${JSON.stringify(observed)}`,
    );
  }

  it("a CONFIRMING order cannot commit after COMPLETE_CANCELLATION: it waits on the Draw boundary, then is refused with zero money moved", async () => {
    const scansBefore = refundPort.scanStarted;
    const { drawId, betTypeCode } = await openDraw("RACE_LATE", "2099-09-05");
    const memberId = await newMember();
    const startingCash = 1_000n;
    const stakeMinor = 300n;
    await fundCash(memberId, startingCash);
    const orderId = await quotedOrder(drawId, betTypeCode, memberId, stakeMinor);

    // The Confirm is gated just BEFORE it enters the boundary: it has already
    // passed its Draw-is-OPEN check, which is exactly the pre-fix race window.
    const confirmGate = gate();
    admission.holdBeforeLock = async () => {
      confirmGate.signal();
      await confirmGate.wait();
    };
    const confirmPromise = orderServiceFor(wallet).confirmOrder({
      memberId,
      orderId,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: new Date(),
    });
    await confirmGate.arrived;

    // Durable proof the race window is open: the Order is in-flight CONFIRMING
    // and holds no committed stake, so a refund scan cannot see it.
    const inFlight = await orderRow(orderId);
    expect(inFlight.state).toBe("CONFIRMING");
    expect(inFlight.stakeTransactionId).toBeNull();
    expect(await cashAvailable(memberId)).toBe(startingCash);

    // The cancellation takes the Draw boundary first and holds it across the
    // whole scan -> complete sequence.
    const scanGate = gate();
    refundPort.holdScan = async () => {
      scanGate.signal();
      await scanGate.wait();
    };
    await draws.transition({
      id: drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });
    const cancellationPromise = orchestrator.completeDrawCancellation({
      drawId,
      expectedVersion: 4,
      actor: actor(),
    });
    await scanGate.arrived;

    // Now let the Confirm contend for the same boundary while the cancellation
    // still holds it. PostgreSQL reports the waiter, so "the confirm waits" is
    // a database fact rather than a timing assumption.
    confirmGate.release();
    const contention = await waitForLockWaiter(drawId);
    expect(contention.granted).toBeGreaterThanOrEqual(1);
    expect(contention.waiting).toBeGreaterThanOrEqual(1);
    expect(refundPort.scanStarted).toBe(scansBefore + 1);
    expect(await cashAvailable(memberId)).toBe(startingCash);

    // Release the cancellation: the Draw terminalizes CANCELLED with nothing to
    // refund, because the in-flight Order never committed its stake.
    scanGate.release();
    const cancellation = await cancellationPromise;
    expect(cancellation.draw.state).toBe("CANCELLED");
    expect(cancellation.refund.considered).toBe(0);
    expect(cancellation.refund.refunded).toBe(0);
    expect(cancellation.refund.obligationsSatisfied).toBe(true);

    // The late Confirm is then admitted, re-reads the Draw INSIDE the boundary,
    // and is refused: no stake commit, no reservation, no ledger posting.
    const confirmView = await confirmPromise;
    expect(confirmView.state).toBe("REJECTED");
    expect(confirmView.rejectionReason).toBe("DRAW_NOT_OPEN");
    expect(confirmView.stakeTransactionId).toBeNull();
    expect(confirmView.reservationId).toBeNull();

    const settled = await orderRow(orderId);
    expect(settled.state).toBe("REJECTED");
    expect(settled.stakeTransactionId).toBeNull();
    expect(settled.refundTransactionId).toBeNull();
    expect(await committeeMoneyMovementCount(orderId)).toBe(0);
    expect(
      await prisma.reservation.count({ where: { businessReference: orderId } }),
    ).toBe(0);
    expect(await cashAvailable(memberId)).toBe(startingCash);

    const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: drawId } });
    expect(draw.state).toBe("CANCELLED");

    // The boundary was released on every path (no lock leaked into the pool).
    await expect(admission.admit(drawId, async () => "released")).resolves.toBe(
      "released",
    );
  }, TEST_TIMEOUT_MS);

  it("a confirm that holds the boundary first is waited out, and its stake is refunded by the cancellation scan it could not escape", async () => {
    const scansBefore = refundPort.scanStarted;
    const { drawId, betTypeCode } = await openDraw("RACE_FIRST", "2099-09-06");
    const memberId = await newMember();
    const startingCash = 1_000n;
    const stakeMinor = 400n;
    await fundCash(memberId, startingCash);
    const orderId = await quotedOrder(drawId, betTypeCode, memberId, stakeMinor);

    // Hold Confirm INSIDE the boundary (its stake commit is the boundary work).
    const commitGate = gate();
    wallet.holdInsideCommit = async () => {
      commitGate.signal();
      await commitGate.wait();
    };
    const confirmPromise = orderServiceFor(wallet).confirmOrder({
      memberId,
      orderId,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: new Date(),
    });
    await commitGate.arrived;

    // The Confirm holds the Draw's advisory lock, and no money has moved yet.
    const held = await advisoryLockState(drawId);
    expect(held.granted).toBeGreaterThanOrEqual(1);
    expect((await orderRow(orderId)).state).toBe("CONFIRMING");
    expect(await cashAvailable(memberId)).toBe(startingCash);

    await draws.transition({
      id: drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });
    const cancellationPromise = orchestrator.completeDrawCancellation({
      drawId,
      expectedVersion: 4,
      actor: actor(),
    });

    // The cancellation waits on the same boundary BEFORE touching money: its
    // refund scan has not started (since the previous test's run) and the Draw
    // is still CANCELLING.
    const contention = await waitForLockWaiter(drawId);
    expect(contention.waiting).toBeGreaterThanOrEqual(1);
    expect(refundPort.scanStarted).toBe(scansBefore);
    expect(
      (await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: drawId } })).state,
    ).toBe("CANCELLING");

    // Release the Confirm: it commits its stake and leaves CONFIRMED.
    commitGate.release();
    const confirmed = await confirmPromise;
    expect(confirmed.state).toBe("CONFIRMED");
    expect(confirmed.stakeTransactionId).not.toBeNull();

    // The Draw order was CONFIRMED before the scan ran, so the scan sees it and
    // refunds it. The stake cannot fall between the two writers.
    const cancellation = await cancellationPromise;
    expect(cancellation.draw.state).toBe("CANCELLED");
    expect(cancellation.refund.considered).toBe(1);
    expect(cancellation.refund.refunded).toBe(1);
    expect(cancellation.refund.outstanding).toBe(0);
    expect(cancellation.refund.obligationsSatisfied).toBe(true);

    const settled = await orderRow(orderId);
    expect(settled.state).toBe("CANCELLED");
    expect(settled.refundTransactionId).not.toBeNull();
    expect(await refundCountForOrder(orderId, memberId)).toBe(1);
    // Committed stake then refunded: the Member is exactly whole.
    expect(await cashAvailable(memberId)).toBe(startingCash);

    await expect(admission.admit(drawId, async () => "released")).resolves.toBe(
      "released",
    );
  }, TEST_TIMEOUT_MS);

  it("the boundary is per Draw: a cancellation holding Draw A does not block a Confirm against Draw B", async () => {
    const first = await openDraw("RACE_SCOPE_A", "2099-09-07");
    const second = await openDraw("RACE_SCOPE_B", "2099-09-08");
    const memberA = await newMember();
    const memberB = await newMember();
    await fundCash(memberA, 1_000n);
    await fundCash(memberB, 1_000n);
    const orderA = await quotedOrder(first.drawId, first.betTypeCode, memberA, 200n);
    const orderB = await quotedOrder(second.drawId, second.betTypeCode, memberB, 200n);
    void orderA;

    // Draw A's cancellation holds its own boundary open.
    const scanGate = gate();
    refundPort.holdScan = async () => {
      scanGate.signal();
      await scanGate.wait();
    };
    await draws.transition({
      id: first.drawId,
      command: "REQUEST_CANCELLATION",
      expectedVersion: 3,
      actor: actor(),
    });
    const cancellationPromise = orchestrator.completeDrawCancellation({
      drawId: first.drawId,
      expectedVersion: 4,
      actor: actor(),
    });
    await scanGate.arrived;

    // A Confirm against Draw B proceeds while Draw A's boundary is held.
    const confirmedB = await orderServiceFor(wallet).confirmOrder({
      memberId: memberB,
      orderId: orderB,
      expectedVersion: 1,
      idempotencyKey: `c-${randomUUID()}`,
      now: new Date(),
    });
    expect(confirmedB.state).toBe("CONFIRMED");
    expect(confirmedB.stakeTransactionId).not.toBeNull();

    scanGate.release();
    const cancellation = await cancellationPromise;
    expect(cancellation.draw.state).toBe("CANCELLED");
  }, TEST_TIMEOUT_MS);
});

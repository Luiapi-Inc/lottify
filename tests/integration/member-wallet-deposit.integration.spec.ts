import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DepositService } from "../../src/contexts/payments/application/deposit.service";
import { PrismaDepositRepository } from "../../src/contexts/payments/infrastructure/prisma-deposit.repository";
import { DeterministicPaymentProviderFake } from "../../src/contexts/payments/infrastructure/deterministic-payment-provider.adapter";
import { DepositLedgerAdapter } from "../../src/platform/integration/deposit-ledger.adapter";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { MemberWalletService } from "../../src/contexts/wallet-ledger/application/member-wallet.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const phonePrefix = "+6698"; // wallet/deposit integration namespace

describe.runIf(runIntegration)("Member Wallet + Deposit vertical integration", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let depositLedger: DepositLedgerAdapter;
  let wallet: MemberWalletService;
  const memberIds: string[] = [];
  const depositLedgerTransactionIds: string[] = [];

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(prisma, new DatabaseAccountingPeriodTransactionClock()),
    );
    depositLedger = new DepositLedgerAdapter(ledger);
    wallet = new MemberWalletService(ledger);
  });

  afterAll(async () => {
    const deposits = await prisma.paymentDeposit.findMany({
      where: { memberId: { in: memberIds } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    await prisma.paymentDeposit.deleteMany({ where: { memberId: { in: memberIds } } });

    await prisma.ledgerPosting.deleteMany({
      where: { transactionId: { in: depositLedgerTransactionIds } },
    });
    await prisma.financialTransaction.deleteMany({
      where: { id: { in: depositLedgerTransactionIds } },
    });
    await prisma.ledgerAccount.deleteMany({
      where: {
        OR: [
          { memberId: { in: memberIds } },
          // provider clearing accounts created via DEPOSIT_CREDIT adapters
          ...depositTransactionsProviderCodes().map((code) => ({
            systemCode: `payment-provider:${code}`,
          })),
        ],
      },
    });

    // Accounting period coverage created automatically for the posting window.
    const periods = await prisma.financialTransaction.findMany({
      where: { id: { in: depositLedgerTransactionIds } },
      select: { accountingPeriodId: true },
      distinct: ["accountingPeriodId"],
    });
    await prisma.accountingPeriod.deleteMany({
      where: { id: { in: periods.map((period) => period.accountingPeriodId) } },
    });

    await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
    await prisma.$disconnect();
  });

  // provider codes used across the run for cleaning up provider clearing accounts
  const providerCodes = new Set<string>();
  function depositTransactionsProviderCodes(): string[] {
    return [...providerCodes];
  }

  async function createMember(): Promise<string> {
    const phone = `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 8)}`;
    const member = await prisma.member.create({ data: { phone } });
    memberIds.push(member.id);
    return member.id;
  }

  function depositServiceFor(
    scenarios: Record<string, unknown>,
  ): { service: DepositService; provider: DeterministicPaymentProviderFake } {
    const provider = new DeterministicPaymentProviderFake(scenarios as never);
    const service = new DepositService(
      new PrismaDepositRepository(prisma),
      depositLedger,
      provider,
    );
    return { service, provider };
  }

  const baseCommand = {
    providerCode: "corridor",
    methodCode: "bank-transfer",
    amountMinor: 100_00n,
    currency: "THB" as const,
  };

  async function creditedDeposit(memberId: string, amountMinor: bigint, providerCode: string) {
    providerCodes.add(providerCode);
    const { service } = depositServiceFor({ [providerCode]: { outcome: "APPROVED" } });
    const deposit = await service.initiateDeposit(
      memberId,
      { providerCode, methodCode: "bank-transfer", amountMinor, currency: "THB", idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(deposit.status).toBe("COMPLETED");
    if (deposit.ledgerTransactionId) {
      depositLedgerTransactionIds.push(deposit.ledgerTransactionId);
    }
    return deposit;
  }

  async function cashBalance(memberId: string) {
    const projection = await wallet.getBalance(memberId);
    return projection.buckets.find((bucket) => bucket.bucket === "CASH");
  }

  it("credits a deposit to the Wallet and reads a bounded balance without fabricated buckets", async () => {
    const memberId = await createMember();
    await creditedDeposit(memberId, 100_00n, "happy");
    await creditedDeposit(memberId, 50_00n, "happy2");

    const projection = await wallet.getBalance(memberId);
    expect(projection.memberId).toBe(memberId);
    expect(projection.currency).toBe("THB");
    expect(projection.buckets.map((bucket) => bucket.bucket)).toEqual(["CASH", "BONUS", "LOCKED"]);
    const cash = await cashBalance(memberId);
    expect(cash?.postedMinor).toBe(150_00n);
    expect(cash?.reservedMinor).toBe(0n);
    expect(cash?.availableMinor).toBe(150_00n);
    // BONUS/LOCKED never appear as fabricated non-zero values.
    const bonus = projection.buckets.find((bucket) => bucket.bucket === "BONUS")!;
    const locked = projection.buckets.find((bucket) => bucket.bucket === "LOCKED")!;
    expect(bonus.postedMinor).toBe(0n);
    expect(locked.postedMinor).toBe(0n);
  });

  it("returns the prior result on a same-key retry and conflicts on a changed payload", async () => {
    const memberId = await createMember();
    const key = randomUUID();
    const { service } = depositServiceFor({ corridor: { outcome: "APPROVED" } });

    const first = await service.initiateDeposit(
      memberId,
      { ...baseCommand, idempotencyKey: key },
      randomUUID(),
    );
    expect(first.status).toBe("COMPLETED");
    if (first.ledgerTransactionId) depositLedgerTransactionIds.push(first.ledgerTransactionId);

    const replay = await service.initiateDeposit(
      memberId,
      { ...baseCommand, idempotencyKey: key },
      randomUUID(),
    );
    expect(replay.id).toBe(first.id);

    await expect(
      service.initiateDeposit(
        memberId,
        { ...baseCommand, amountMinor: 200_00n, idempotencyKey: key },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    // the single credited effect, returned on replay, not duplicated
    const cash = await cashBalance(memberId);
    expect(cash?.availableMinor).toBe(100_00n);
    expect(
      await prisma.financialTransaction.count({
        where: {
          businessTransactionId: first.id,
          operationType: "DEPOSIT_CREDIT",
        },
      }),
    ).toBe(1);
  });

  it("keeps a denied deposit REJECTED with no Wallet credit", async () => {
    const memberId = await createMember();
    const providerCode = "denied";
    providerCodes.add(providerCode);
    const { service } = depositServiceFor({
      [providerCode]: {
        startFailure: { category: "BUSINESS_REJECTION", retryable: false, evidenceRefs: [] },
      },
    });
    const deposit = await service.initiateDeposit(
      memberId,
      { ...baseCommand, providerCode, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(deposit.status).toBe("REJECTED");
    const cash = await cashBalance(memberId);
    expect(cash?.availableMinor).toBe(0n);
    expect(deposit.ledgerTransactionId).toBeNull();
  });

  it("never credits an ambiguous deposit and recovers once through the status seam", async () => {
    const memberId = await createMember();
    const providerCode = "ambiguous";
    providerCodes.add(providerCode);
    const { service } = depositServiceFor({
      [providerCode]: {
        startFailure: { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
        resolveOutcome: "APPROVED",
      },
    });

    const initiated = await service.initiateDeposit(
      memberId,
      { ...baseCommand, providerCode, methodCode: "bank-transfer", idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(initiated.status).toBe("REVIEW_REQUIRED");
    expect(initiated.ledgerTransactionId).toBeNull();
    expect((await cashBalance(memberId))?.availableMinor).toBe(0n);

    const recovered = await service.reconcileDeposit(memberId, initiated.id, randomUUID());
    expect(recovered.status).toBe("COMPLETED");
    expect(recovered.ledgerTransactionId).not.toBeNull();
    expect((await cashBalance(memberId))?.availableMinor).toBe(100_00n);
    if (recovered.ledgerTransactionId) {
      depositLedgerTransactionIds.push(recovered.ledgerTransactionId);
    }
    // a second reconcile does not double-credit
    const again = await service.reconcileDeposit(memberId, initiated.id, randomUUID());
    expect(again.ledgerTransactionId).toBe(recovered.ledgerTransactionId);
    expect((await cashBalance(memberId))?.availableMinor).toBe(100_00n);
  });

  it("serializes concurrent same-key deposits into a single deposit and a single credit", async () => {
    const memberId = await createMember();
    const key = randomUUID();
    const providerCode = "concurrent";
    providerCodes.add(providerCode);
    const make = () =>
      depositServiceFor({ [providerCode]: { outcome: "APPROVED" } }).service;

    const [left, right] = await Promise.all([
      make().initiateDeposit(
        memberId,
        { ...baseCommand, providerCode, idempotencyKey: key },
        randomUUID(),
      ),
      make().initiateDeposit(
        memberId,
        { ...baseCommand, providerCode, idempotencyKey: key },
        randomUUID(),
      ),
    ]);

    expect(left.id).toBe(right.id);
    expect(left.status).toBe("COMPLETED");
    expect(right.status).toBe("COMPLETED");
    const credited = left.ledgerTransactionId ?? right.ledgerTransactionId;
    expect(credited).not.toBeNull();
    if (credited) depositLedgerTransactionIds.push(credited);

    expect(
      await prisma.financialTransaction.count({
        where: { businessTransactionId: left.id, operationType: "DEPOSIT_CREDIT" },
      }),
    ).toBe(1);
    expect((await cashBalance(memberId))?.availableMinor).toBe(100_00n);
  });

  it("lists Ledger-backed transaction history with stable cursor pagination", async () => {
    const memberId = await createMember();
    await creditedDeposit(memberId, 30_00n, "history-a");
    await creditedDeposit(memberId, 70_00n, "history-b");

    const page = await wallet.listTransactions(memberId, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(page.items[0]!.netImpactMinor).toBe(70_00n);
    expect(page.items[0]!.operationType).toBe("DEPOSIT_CREDIT");

    const next = await wallet.listTransactions(memberId, { limit: 1, cursor: page.nextCursor });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]!.netImpactMinor).toBe(30_00n);
    expect(next.nextCursor).toBeNull();

    // no duplicate rows across the two pages
    const ids = [...page.items, ...next.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(2);

    // the cumulative net equals the ledger balance
    const cash = await cashBalance(memberId);
    const totalNet = [...page.items, ...next.items].reduce(
      (sum, item) => sum + item.netImpactMinor,
      0n,
    );
    expect(totalNet).toBe(cash?.postedMinor ?? 0n);
  });
});
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WithdrawalService } from "../../src/contexts/payments/application/withdrawal.service";
import { PayoutDestinationService } from "../../src/contexts/payments/application/payout-destination.service";
import { PrismaWithdrawalRepository } from "../../src/contexts/payments/infrastructure/prisma-withdrawal.repository";
import { PrismaPayoutDestinationRepository } from "../../src/contexts/payments/infrastructure/prisma-payout-destination.repository";
import { DeterministicPayoutProviderFake } from "../../src/contexts/payments/infrastructure/deterministic-payout-provider.adapter";
import { DeterministicPayoutDestinationVerificationFake } from "../../src/contexts/payments/infrastructure/deterministic-payout-destination-verification.adapter";
import { UnrestrictedMemberWithdrawalRestrictionAdapter } from "../../src/contexts/payments/infrastructure/unrestricted-member-withdrawal-restriction.adapter";
import { WithdrawalLedgerAdapter } from "../../src/platform/integration/withdrawal-ledger.adapter";
import { DepositLedgerAdapter } from "../../src/platform/integration/deposit-ledger.adapter";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { MemberWalletService } from "../../src/contexts/wallet-ledger/application/member-wallet.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const phonePrefix = "+6699"; // withdrawal integration namespace
const PAYOUT_PROVIDER_ID = "payout-rail";
// `decided_by_admin_id` is an opaque UUID column, so the reviewer identity used
// in this suite must be a real Admin identity shape.
const rejectionAdminId = "5b1c1a1e-0000-4000-8000-000000000001";

describe.runIf(runIntegration)("Member Withdrawal vertical integration", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let depositLedger: DepositLedgerAdapter;
  let withdrawalLedger: WithdrawalLedgerAdapter;
  let wallet: MemberWalletService;
  let destinations: PayoutDestinationService;
  let withdrawals: PrismaWithdrawalRepository;
  let payoutDestinations: PrismaPayoutDestinationRepository;
  const memberIds: string[] = [];
  const ledgerTransactionIds: string[] = [];

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(prisma, new DatabaseAccountingPeriodTransactionClock()),
    );
    depositLedger = new DepositLedgerAdapter(ledger);
    withdrawalLedger = new WithdrawalLedgerAdapter(ledger);
    wallet = new MemberWalletService(ledger);
    payoutDestinations = new PrismaPayoutDestinationRepository(prisma);
    destinations = new PayoutDestinationService(
      payoutDestinations,
      new DeterministicPayoutDestinationVerificationFake(),
    );
    withdrawals = new PrismaWithdrawalRepository(prisma);
  });

  afterAll(async () => {
    // Include rows left behind by an interrupted earlier run in this namespace.
    const namespaceMembers = await prisma.member.findMany({
      where: { phone: { startsWith: phonePrefix } },
      select: { id: true },
    });
    const ids = [...new Set([...memberIds, ...namespaceMembers.map((member) => member.id)])];

    await prisma.paymentWithdrawalEvent.deleteMany({
      where: { withdrawal: { memberId: { in: ids } } },
    });
    await prisma.paymentWithdrawal.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.payoutDestination.deleteMany({ where: { memberId: { in: ids } } });

    // The Reservation consumes (references) a Financial Transaction, so the
    // Reservation rows are removed with their allocations before the
    // authoritative Ledger rows themselves.
    const reservations = await prisma.reservation.findMany({
      where: { memberId: { in: ids } },
      select: { id: true },
    });
    await prisma.reservationAllocation.deleteMany({
      where: { reservationId: { in: reservations.map((reservation) => reservation.id) } },
    });
    await prisma.reservation.deleteMany({ where: { memberId: { in: ids } } });

    const accounts = await prisma.ledgerAccount.findMany({
      where: { memberId: { in: ids } },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    const memberPostings = await prisma.ledgerPosting.findMany({
      where: { accountId: { in: accountIds } },
      select: { transactionId: true },
    });
    const transactionIds = [
      ...new Set([...ledgerTransactionIds, ...memberPostings.map((posting) => posting.transactionId)]),
    ];

    const periods = await prisma.financialTransaction.findMany({
      where: { id: { in: transactionIds } },
      select: { accountingPeriodId: true },
      distinct: ["accountingPeriodId"],
    });

    await prisma.ledgerPosting.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await prisma.financialTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    await prisma.ledgerAccount.deleteMany({ where: { id: { in: accountIds } } });
    // Accounting Periods are shared calendar rows: only remove the ones nothing
    // else references any more.
    await prisma.accountingPeriod.deleteMany({
      where: {
        id: { in: periods.map((period) => period.accountingPeriodId) },
        financialTransactions: { none: {} },
      },
    });

    // System/counterparty accounts are shared across verticals: only remove them
    // once nothing references them.
    for (const systemCode of [
      "payment-provider:withdrawal-integration",
      `payout-provider:${PAYOUT_PROVIDER_ID}`,
    ]) {
      await prisma.ledgerAccount.deleteMany({
        where: { systemCode, postings: { none: {} } },
      });
    }

    await prisma.member.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  async function createMember(): Promise<string> {
    const phone = `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 8)}`;
    const member = await prisma.member.create({ data: { phone } });
    memberIds.push(member.id);
    return member.id;
  }

  function serviceWith(
    scenarios: ConstructorParameters<typeof DeterministicPayoutProviderFake>[0],
  ): { service: WithdrawalService; provider: DeterministicPayoutProviderFake } {
    const provider = new DeterministicPayoutProviderFake(scenarios);
    const service = new WithdrawalService(
      withdrawals,
      payoutDestinations,
      withdrawalLedger,
      provider,
      new UnrestrictedMemberWithdrawalRestrictionAdapter(),
    );
    return { service, provider };
  }

  async function fundedMember(amountMinor: bigint): Promise<string> {
    const memberId = await createMember();
    const ledgerTransactionId = await depositLedger.creditDeposit({
      depositId: randomUUID(),
      memberId,
      providerId: "withdrawal-integration",
      amountMinor,
      currency: "THB",
      correlationId: randomUUID(),
    });
    ledgerTransactionIds.push(ledgerTransactionId);
    return memberId;
  }

  async function verifiedDestination(memberId: string): Promise<string> {
    const destination = await destinations.addDestination(memberId, {
      type: "BANK_ACCOUNT",
      bankCode: "KBANK",
      accountNumber: `12345${randomUUID().replace(/\D/g, "").slice(0, 6)}`,
      accountHolderName: "Somchai Test",
    });
    const verified = await destinations.verifyDestination(memberId, destination.id, randomUUID());
    expect(verified.status).toBe("VERIFIED");
    return destination.id;
  }

  async function availableCash(memberId: string): Promise<bigint> {
    const projection = await wallet.getBalance(memberId);
    return projection.buckets.find((bucket) => bucket.bucket === "CASH")?.availableMinor ?? 0n;
  }

  async function postedCash(memberId: string): Promise<bigint> {
    const projection = await wallet.getBalance(memberId);
    return projection.buckets.find((bucket) => bucket.bucket === "CASH")?.postedMinor ?? 0n;
  }

  it("runs request -> reserve -> approve -> payout -> finalize with one Ledger effect", async () => {
    const memberId = await fundedMember(100_00n);
    const destinationId = await verifiedDestination(memberId);
    const { service, provider } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

    const created = await service.createWithdrawal(
      memberId,
      { payoutDestinationId: destinationId, amountMinor: 40_00n, currency: "THB", idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(created.state).toBe("APPROVED");
    expect(created.reservationId).not.toBeNull();
    expect(created.feeMinor).toBe(0n);
    // The Ledger is the only balance authority: 100.00 posted, 40.00 reserved.
    expect(await postedCash(memberId)).toBe(100_00n);
    expect(await availableCash(memberId)).toBe(60_00n);

    const paid = await service.requestPayout(created.id, { adminId: "admin-1" }, randomUUID());
    expect(paid.state).toBe("PAYOUT_CONFIRMED");
    expect(paid.payoutEvidenceRef).not.toBeNull();
    expect(await availableCash(memberId)).toBe(60_00n);

    const completed = await service.finalizeWithdrawal(
      created.id,
      { adminId: "admin-1" },
      randomUUID(),
    );
    expect(completed.state).toBe("COMPLETED");
    expect(completed.ledgerTransactionId).not.toBeNull();
    expect(completed.completedAt).not.toBeNull();
    ledgerTransactionIds.push(completed.ledgerTransactionId!);

    // Exactly one authoritative WITHDRAWAL_FINALIZE posting consumed the hold.
    const finalizeTransactions = await prisma.financialTransaction.count({
      where: { businessTransactionId: created.id, operationType: "WITHDRAWAL_FINALIZE" },
    });
    expect(finalizeTransactions).toBe(1);

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: created.reservationId! },
      select: { consumedAt: true, releasedAt: true, purpose: true, amountMinor: true },
    });
    expect(reservation.purpose).toBe("WITHDRAWAL");
    expect(reservation.consumedAt).not.toBeNull();
    expect(reservation.releasedAt).toBeNull();
    expect(BigInt(reservation.amountMinor)).toBe(40_00n);

    expect(await postedCash(memberId)).toBe(60_00n);
    expect(await availableCash(memberId)).toBe(60_00n);
    // Finalization is idempotent: a replay leaves exactly one effect.
    await expect(
      service.finalizeWithdrawal(created.id, { adminId: "admin-1" }, randomUUID()),
    ).resolves.toMatchObject({ state: "COMPLETED" });
    expect(
      await prisma.financialTransaction.count({
        where: { businessTransactionId: created.id, operationType: "WITHDRAWAL_FINALIZE" },
      }),
    ).toBe(1);
    expect(provider.initiateCallCount).toBe(1);
  });

  it("denies a withdrawal to an unverified destination without creating a hold", async () => {
    const memberId = await fundedMember(50_00n);
    const pending = await destinations.addDestination(memberId, {
      type: "BANK_ACCOUNT",
      bankCode: "KBANK",
      accountNumber: `98765${randomUUID().replace(/\D/g, "").slice(0, 6)}`,
      accountHolderName: "Somchai Test",
    });
    const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

    const denied = await service.createWithdrawal(
      memberId,
      { payoutDestinationId: pending.id, amountMinor: 10_00n, currency: "THB", idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(denied.state).toBe("REJECTED");
    expect(denied.eligibilityReasonCodes).toContain("PAYOUT_DESTINATION_NOT_VERIFIED");
    expect(denied.reservationId).toBeNull();
    expect(await availableCash(memberId)).toBe(50_00n);
    expect(await prisma.reservation.count({ where: { memberId } })).toBe(0);
  });

  it("refuses to exceed the authoritative available balance", async () => {
    const memberId = await fundedMember(30_00n);
    const destinationId = await verifiedDestination(memberId);
    const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

    await expect(
      service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: 31_00n, currency: "THB", idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });

    expect(await availableCash(memberId)).toBe(30_00n);
    expect(await prisma.reservation.count({ where: { memberId } })).toBe(0);
    const rejected = await prisma.paymentWithdrawal.findFirstOrThrow({ where: { memberId } });
    expect(rejected.state).toBe("REJECTED");
    expect(rejected.failureReason).toBe("INSUFFICIENT_FUNDS");
  });

  it("serializes a concurrent same-key create into one withdrawal and one hold", async () => {
    const memberId = await fundedMember(100_00n);
    const destinationId = await verifiedDestination(memberId);
    const key = randomUUID();
    const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

    const [left, right] = await Promise.all([
      service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: 25_00n, currency: "THB", idempotencyKey: key },
        randomUUID(),
      ),
      service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: 25_00n, currency: "THB", idempotencyKey: key },
        randomUUID(),
      ),
    ]);

    expect(left.id).toBe(right.id);
    expect(await prisma.paymentWithdrawal.count({ where: { memberId } })).toBe(1);
    expect(await prisma.reservation.count({ where: { memberId } })).toBe(1);
    expect(await availableCash(memberId)).toBe(75_00n);

    await expect(
      service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: 26_00n, currency: "THB", idempotencyKey: key },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await prisma.reservation.count({ where: { memberId } })).toBe(1);
  });

  it("keeps an ambiguous payout reserved and recovers exactly once through reconciliation", async () => {
    const memberId = await fundedMember(80_00n);
    const destinationId = await verifiedDestination(memberId);
    const { service, provider } = serviceWith({
      [PAYOUT_PROVIDER_ID]: {
        startFailure: { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
        resolveOutcome: "APPROVED",
      },
    });

    const created = await service.createWithdrawal(
      memberId,
      { payoutDestinationId: destinationId, amountMinor: 30_00n, currency: "THB", idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(created.state).toBe("APPROVED");

    const ambiguous = await service.requestPayout(created.id, { adminId: "admin-1" }, randomUUID());
    expect(ambiguous.state).toBe("RECONCILING");
    expect(ambiguous.incomingProviderError).toBe("AMBIGUOUS_OUTCOME");
    // Funds remain reserved until the payout outcome is proven.
    expect(await availableCash(memberId)).toBe(50_00n);
    expect(await postedCash(memberId)).toBe(80_00n);

    const recovered = await service.reconcileWithdrawal(
      created.id,
      { adminId: "admin-1" },
      randomUUID(),
    );
    expect(recovered.state).toBe("PAYOUT_CONFIRMED");
    expect(recovered.reconciliationAttempts).toBe(1);
    // Reconciliation never blind-retries the external payout.
    expect(provider.initiateCallCount).toBe(1);

    const completed = await service.finalizeWithdrawal(
      created.id,
      { adminId: "admin-1" },
      randomUUID(),
    );
    expect(completed.state).toBe("COMPLETED");
    ledgerTransactionIds.push(completed.ledgerTransactionId!);
    expect(await postedCash(memberId)).toBe(50_00n);
    expect(await availableCash(memberId)).toBe(50_00n);
    expect(
      await prisma.financialTransaction.count({
        where: { businessTransactionId: created.id, operationType: "WITHDRAWAL_FINALIZE" },
      }),
    ).toBe(1);
  });

  it("releases the hold through the Ledger on Member cancellation and on review rejection", async () => {
    const cancellingMember = await fundedMember(60_00n);
    const cancellingDestination = await verifiedDestination(cancellingMember);
    const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

    const toCancel = await service.createWithdrawal(
      cancellingMember,
      {
        payoutDestinationId: cancellingDestination,
        amountMinor: 20_00n,
        currency: "THB",
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    expect(await availableCash(cancellingMember)).toBe(40_00n);

    const cancelled = await service.cancelWithdrawal(
      cancellingMember,
      toCancel.id,
      randomUUID(),
    );
    expect(cancelled.state).toBe("CANCELLED");
    expect(await availableCash(cancellingMember)).toBe(60_00n);
    const releasedReservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: toCancel.reservationId! },
      select: { releasedAt: true, consumedAt: true },
    });
    expect(releasedReservation.releasedAt).not.toBeNull();
    expect(releasedReservation.consumedAt).toBeNull();

    const rejectedMember = await fundedMember(60_00n);
    const rejectedDestination = await verifiedDestination(rejectedMember);
    const toReject = await service.createWithdrawal(
      rejectedMember,
      {
        payoutDestinationId: rejectedDestination,
        amountMinor: 15_00n,
        currency: "THB",
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    expect(await availableCash(rejectedMember)).toBe(45_00n);

    const rejected = await service.rejectWithdrawal(
      toReject.id,
      { adminId: rejectionAdminId, reason: "Evidence insufficient" },
      randomUUID(),
    );
    expect(rejected.state).toBe("REJECTED");
    expect(rejected.decidedByAdminId).toBe(rejectionAdminId);
    expect(await availableCash(rejectedMember)).toBe(60_00n);
    expect(
      await prisma.reservation.findUniqueOrThrow({
        where: { id: toReject.reservationId! },
        select: { releasedAt: true },
      }),
    ).toMatchObject({ releasedAt: expect.any(Date) });
  });

  it("records the durable workflow timeline for the withdrawal", async () => {
    const memberId = await fundedMember(40_00n);
    const destinationId = await verifiedDestination(memberId);
    const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

    const created = await service.createWithdrawal(
      memberId,
      { payoutDestinationId: destinationId, amountMinor: 10_00n, currency: "THB", idempotencyKey: randomUUID() },
      randomUUID(),
    );
    await service.cancelWithdrawal(memberId, created.id, randomUUID());

    const events = await service.listEvents(created.id);
    expect(events[0]).toMatchObject({ fromState: null, toState: "REQUESTED", actorType: "MEMBER" });
    expect(events.map((event) => event.toState)).toContain("RESERVING");
    expect(events.at(-1)).toMatchObject({ toState: "CANCELLED", actorType: "MEMBER" });
  });
});

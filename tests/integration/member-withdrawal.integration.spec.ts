import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WithdrawalService } from "../../src/contexts/payments/application/withdrawal.service";
import { PayoutDestinationService } from "../../src/contexts/payments/application/payout-destination.service";
import { PrismaWithdrawalRepository } from "../../src/contexts/payments/infrastructure/prisma-withdrawal.repository";
import { PrismaPayoutDestinationRepository } from "../../src/contexts/payments/infrastructure/prisma-payout-destination.repository";
import { DeterministicPayoutProviderFake } from "../../src/contexts/payments/infrastructure/deterministic-payout-provider.adapter";
import { DeterministicPayoutDestinationVerificationFake } from "../../src/contexts/payments/infrastructure/deterministic-payout-destination-verification.adapter";
import { UnrestrictedMemberWithdrawalRestrictionAdapter } from "../../src/contexts/payments/infrastructure/unrestricted-member-withdrawal-restriction.adapter";
import type { MemberWithdrawalRestrictionPort } from "../../src/contexts/payments/application/withdrawal-restriction.port";
import { WithdrawalLedgerAdapter } from "../../src/platform/integration/withdrawal-ledger.adapter";
import { DepositLedgerAdapter } from "../../src/platform/integration/deposit-ledger.adapter";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { MemberWalletService } from "../../src/contexts/wallet-ledger/application/member-wallet.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import {
  DUAL_CONTROL_APPROVAL_EVIDENCE_REF,
  DUAL_CONTROL_APPROVAL_REASON_CODE,
} from "../../src/contexts/payments/domain/dual-control-approval";
import {
  getWithdrawalApprovalThresholdMinor,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";
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
    restriction: MemberWithdrawalRestrictionPort = new UnrestrictedMemberWithdrawalRestrictionAdapter(),
  ): { service: WithdrawalService; provider: DeterministicPayoutProviderFake } {
    const provider = new DeterministicPayoutProviderFake(scenarios);
    const service = new WithdrawalService(
      withdrawals,
      payoutDestinations,
      withdrawalLedger,
      provider,
      restriction,
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

  it("rejects an unknown or foreign destination reference without persisting a withdrawal", async () => {
    const memberId = await fundedMember(50_00n);
    const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

    // An identity that exists but belongs to another Member.
    const otherMemberId = await fundedMember(10_00n);
    const foreignDestinationId = await verifiedDestination(otherMemberId);

    for (const payoutDestinationId of [randomUUID(), foreignDestinationId]) {
      await expect(
        service.createWithdrawal(
          memberId,
          { payoutDestinationId, amountMinor: 10_00n, currency: "THB", idempotencyKey: randomUUID() },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "PAYOUT_DESTINATION_NOT_ELIGIBLE" });
    }

    // No orchestration row and no hold: the request itself was refused, so the
    // caller never sees an unmapped persistence failure.
    expect(await prisma.paymentWithdrawal.count({ where: { memberId } })).toBe(0);
    expect(await prisma.reservation.count({ where: { memberId } })).toBe(0);
    expect(await availableCash(memberId)).toBe(50_00n);
  });

  it("partitions the admin review and approval queues by requiresApproval", async () => {
    const memberId = await fundedMember(60_00n);
    const destinationId = await verifiedDestination(memberId);
    // One withdrawal that needs an approval decision, created through the real
    // review-required path.
    const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } }, {
      evaluate: async () => ({
        withdrawalBlocked: false,
        reviewRequired: true,
        reasonCodes: ["APPROVAL_THRESHOLD"],
        evidenceRefs: [],
      }),
    });
    const needsApproval = await service.createWithdrawal(
      memberId,
      { payoutDestinationId: destinationId, amountMinor: 10_00n, currency: "THB", idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(needsApproval.state).toBe("REVIEWING");
    expect(needsApproval.requiresApproval).toBe(true);

    // And one REVIEWING withdrawal that does not, inserted directly so the
    // partition is proven to be on the flag rather than on the creation path.
    const noApproval = await prisma.paymentWithdrawal.create({
      data: {
        memberId,
        payoutDestinationId: destinationId,
        amountMinor: 5_00n,
        feeMinor: 0n,
        currency: "THB",
        state: "REVIEWING",
        version: 3,
        eligibilityOutcome: "REVIEW_REQUIRED",
        eligibilityPolicyVersion: "withdrawal-eligibility-v1",
        eligibilityReasonCodes: ["REVIEW_REQUIRED"],
        eligibilityEvidenceRefs: [],
        requiresApproval: false,
        idempotencyScope: `WITHDRAWAL_CREATE:${memberId}`,
        idempotencyKey: randomUUID(),
        fingerprint: randomUUID(),
        reservationId: randomUUID(),
        providerId: PAYOUT_PROVIDER_ID,
        providerReferenceKey: `wdr:${randomUUID()}`,
        correlationId: randomUUID(),
      },
    });

    const reviewQueue = await withdrawals.list({ memberId, queue: "REVIEW", limit: 50 });
    const approvalQueue = await withdrawals.list({ memberId, queue: "APPROVAL", limit: 50 });

    expect(reviewQueue.items.map((item) => item.id)).toEqual([noApproval.id]);
    expect(approvalQueue.items.map((item) => item.id)).toEqual([needsApproval.id]);
    expect(reviewQueue.items.every((item) => !item.requiresApproval)).toBe(true);
    expect(approvalQueue.items.every((item) => item.requiresApproval)).toBe(true);
  });

  it("keeps a pending payout observable in place and counts a still-pending reconciliation", async () => {
    const memberId = await fundedMember(80_00n);
    const destinationId = await verifiedDestination(memberId);
    const { service, provider } = serviceWith({
      [PAYOUT_PROVIDER_ID]: {
        startFailure: { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
        resolveOutcome: "PENDING",
      },
    });

    const created = await service.createWithdrawal(
      memberId,
      { payoutDestinationId: destinationId, amountMinor: 20_00n, currency: "THB", idempotencyKey: randomUUID() },
      randomUUID(),
    );

    const ambiguous = await service.requestPayout(created.id, { adminId: "admin-1" }, randomUUID());
    expect(ambiguous.state).toBe("RECONCILING");
    expect(ambiguous.reconciliationAttempts).toBe(1);
    expect(await availableCash(memberId)).toBe(60_00n);

    // A reconcile that is still pending stays ambiguous, holds the Reservation and
    // records the attempt instead of inventing a workflow step.
    const stillPending = await service.reconcileWithdrawal(
      created.id,
      { adminId: "admin-1" },
      randomUUID(),
    );
    expect(stillPending.state).toBe("RECONCILING");
    expect(stillPending.reconciliationAttempts).toBe(2);
    expect(stillPending.reservationId).toBe(ambiguous.reservationId);
    expect(await availableCash(memberId)).toBe(60_00n);
    expect(provider.initiateCallCount).toBe(1);

    const events = await service.listEvents(created.id);
    expect(events.at(-1)).toMatchObject({
      fromState: "RECONCILING",
      toState: "RECONCILING",
      reason: "PAYOUT_IN_FLIGHT",
    });
  });

  it("records an in-flight payout observation when the provider only accepts the request", async () => {
    const memberId = await fundedMember(70_00n);
    const destinationId = await verifiedDestination(memberId);
    const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "PENDING" } });

    const created = await service.createWithdrawal(
      memberId,
      { payoutDestinationId: destinationId, amountMinor: 20_00n, currency: "THB", idempotencyKey: randomUUID() },
      randomUUID(),
    );
    const inFlight = await service.requestPayout(created.id, { adminId: "admin-1" }, randomUUID());

    expect(inFlight.state).toBe("PAYOUT_PROCESSING");
    expect(inFlight.reservationId).toBe(created.reservationId);
    expect(await availableCash(memberId)).toBe(50_00n);
    const events = await service.listEvents(created.id);
    expect(events.at(-1)).toMatchObject({
      fromState: "PAYOUT_PROCESSING",
      toState: "PAYOUT_PROCESSING",
      reason: "PAYOUT_IN_FLIGHT",
    });
  });

  /**
   * G2→G3 cutover decision D11: `WITHDRAWAL_APPROVAL_THRESHOLD_MINOR`
   * (`src/platform/config/env.ts`, default 5,000,000 minor = 50,000.00 THB, the
   * G2 `system_settings.withdrawal.dual_control_threshold` value) is a
   * *creation-time* dual-control gate: an amount at or above it routes to
   * `REVIEW_REQUIRED` (admin `APPROVAL` queue, `APPROVAL_THRESHOLD` signal,
   * Reservation held) instead of fast-pathing to `APPROVED`.
   *
   * How the threshold reaches this integration context: the spec adds no
   * configuration source. It reads the value the process environment resolves to
   * through `getWithdrawalApprovalThresholdMinor()`, and the integration run
   * exports the shared `.env` (`set -a && . ./.env && set +a`) which does not set
   * the variable — so the built-in default (the G2 cutover value) applies. Every
   * amount below is derived from the *resolved* threshold (exact / +1 / -1
   * satang) rather than hard-coded, so the boundary evidence holds whether an
   * operator sets the variable explicitly or leaves it unset.
   *
   * The unit suite (`tests/unit/withdrawal.service.spec.ts`) proves the pure
   * comparison only; these cases are the deterministic PostgreSQL evidence
   * Ticket 16 requires for the reservation/state invariants at the exact
   * boundary.
   */
  describe("dual-control approval threshold at the exact boundary (D11)", () => {
    // `decided_by_admin_id` is a uuid column, so the Admin identity used for a
    // governed decision must be a real Admin identity shape.
    const BOUNDARY_ADMIN_ID = "7d2f0c1a-9b6e-4a11-8f0d-0000000000d1";

    function thresholdMinor(): bigint {
      return getWithdrawalApprovalThresholdMinor();
    }

    it("resolves the threshold from configuration with no new config source", () => {
      const configured = process.env.WITHDRAWAL_APPROVAL_THRESHOLD_MINOR;
      expect(thresholdMinor()).toBe(configured ? BigInt(configured) : 5_000_000n);
      expect(thresholdMinor()).toBeGreaterThan(0n);
      if (!configured) {
        // Unset in this environment: the G2 cutover value must survive.
        expect(thresholdMinor()).toBe(50_000_00n);
      }
    });

    it("holds an amount exactly at the threshold for dual control, then approves, pays out and finalizes once", async () => {
      const amount = thresholdMinor();
      const memberId = await fundedMember(amount);
      const destinationId = await verifiedDestination(memberId);
      const { service, provider } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

      const created = await service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: amount, currency: "THB", idempotencyKey: randomUUID() },
        randomUUID(),
      );
      expect(created.state).toBe("REVIEWING");
      expect(created.requiresApproval).toBe(true);
      expect(created.eligibilityOutcome).toBe("REVIEW_REQUIRED");
      expect(created.eligibilityReasonCodes).toContain(DUAL_CONTROL_APPROVAL_REASON_CODE);
      expect(created.eligibilityEvidenceRefs).toContain(DUAL_CONTROL_APPROVAL_EVIDENCE_REF);
      expect(created.reservationId).not.toBeNull();
      // The Reservation is HELD: nothing is posted and the spendable balance is gone.
      expect(await postedCash(memberId)).toBe(amount);
      expect(await availableCash(memberId)).toBe(0n);
      const held = await prisma.reservation.findUniqueOrThrow({
        where: { id: created.reservationId! },
        select: { purpose: true, amountMinor: true, releasedAt: true, consumedAt: true },
      });
      expect(held.purpose).toBe("WITHDRAWAL");
      expect(BigInt(held.amountMinor)).toBe(amount);
      expect(held.releasedAt).toBeNull();
      expect(held.consumedAt).toBeNull();
      expect(
        (await withdrawals.list({ memberId, queue: "APPROVAL", limit: 50 })).items.map((item) => item.id),
      ).toEqual([created.id]);

      // Payout stays unreachable until the second control acts.
      await expect(
        service.requestPayout(created.id, { adminId: BOUNDARY_ADMIN_ID }, randomUUID()),
      ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

      const approved = await service.approveWithdrawal(
        created.id,
        { adminId: BOUNDARY_ADMIN_ID, reason: "Dual-control approval at the threshold" },
        randomUUID(),
      );
      expect(approved.state).toBe("APPROVED");
      expect(approved.decidedByAdminId).toBe(BOUNDARY_ADMIN_ID);

      const paid = await service.requestPayout(created.id, { adminId: BOUNDARY_ADMIN_ID }, randomUUID());
      expect(paid.state).toBe("PAYOUT_CONFIRMED");
      expect(paid.payoutEvidenceRef).not.toBeNull();
      expect(await availableCash(memberId)).toBe(0n);

      const completed = await service.finalizeWithdrawal(
        created.id,
        { adminId: BOUNDARY_ADMIN_ID },
        randomUUID(),
      );
      expect(completed.state).toBe("COMPLETED");
      expect(completed.completedAt).not.toBeNull();
      ledgerTransactionIds.push(completed.ledgerTransactionId!);

      // Exactly one authoritative WITHDRAWAL_FINALIZE consumed the hold, and the
      // Wallet & Ledger projection agrees with the single effect.
      expect(
        await prisma.financialTransaction.count({
          where: { businessTransactionId: created.id, operationType: "WITHDRAWAL_FINALIZE" },
        }),
      ).toBe(1);
      const consumed = await prisma.reservation.findUniqueOrThrow({
        where: { id: created.reservationId! },
        select: { consumedAt: true, releasedAt: true },
      });
      expect(consumed.consumedAt).not.toBeNull();
      expect(consumed.releasedAt).toBeNull();
      expect(await postedCash(memberId)).toBe(0n);
      expect(await availableCash(memberId)).toBe(0n);
      expect(provider.initiateCallCount).toBe(1);
    });

    it("one satang above the threshold takes the same dual-control path (the boundary is >=)", async () => {
      const amount = thresholdMinor() + 1n;
      const memberId = await fundedMember(amount);
      const destinationId = await verifiedDestination(memberId);
      const { service, provider } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

      const created = await service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: amount, currency: "THB", idempotencyKey: randomUUID() },
        randomUUID(),
      );
      expect(created.state).toBe("REVIEWING");
      expect(created.requiresApproval).toBe(true);
      expect(created.eligibilityOutcome).toBe("REVIEW_REQUIRED");
      expect(created.eligibilityReasonCodes).toContain(DUAL_CONTROL_APPROVAL_REASON_CODE);
      expect(created.eligibilityEvidenceRefs).toContain(DUAL_CONTROL_APPROVAL_EVIDENCE_REF);
      expect(created.reservationId).not.toBeNull();
      expect(await postedCash(memberId)).toBe(amount);
      expect(await availableCash(memberId)).toBe(0n);

      const approved = await service.approveWithdrawal(
        created.id,
        { adminId: BOUNDARY_ADMIN_ID, reason: "Dual-control approval one satang above the threshold" },
        randomUUID(),
      );
      expect(approved.state).toBe("APPROVED");

      const paid = await service.requestPayout(created.id, { adminId: BOUNDARY_ADMIN_ID }, randomUUID());
      expect(paid.state).toBe("PAYOUT_CONFIRMED");

      // Still only a hold: the Reservation is neither released nor consumed and no
      // Ledger posting exists for this withdrawal before finalization.
      const stillHeld = await prisma.reservation.findUniqueOrThrow({
        where: { id: created.reservationId! },
        select: { consumedAt: true, releasedAt: true },
      });
      expect(stillHeld.consumedAt).toBeNull();
      expect(stillHeld.releasedAt).toBeNull();
      expect(
        await prisma.financialTransaction.count({ where: { businessTransactionId: created.id } }),
      ).toBe(0);
      expect(await availableCash(memberId)).toBe(0n);
      expect(provider.initiateCallCount).toBe(1);
    });

    it("one satang below the threshold fast-paths to APPROVED with no approval signal and pays out without an Admin decision", async () => {
      const amount = thresholdMinor() - 1n;
      const memberId = await fundedMember(amount);
      const destinationId = await verifiedDestination(memberId);
      const { service } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

      const created = await service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: amount, currency: "THB", idempotencyKey: randomUUID() },
        randomUUID(),
      );
      expect(created.state).toBe("APPROVED");
      expect(created.requiresApproval).toBe(false);
      expect(created.eligibilityOutcome).toBe("ALLOW");
      expect(created.eligibilityReasonCodes).not.toContain(DUAL_CONTROL_APPROVAL_REASON_CODE);
      expect(created.eligibilityEvidenceRefs).not.toContain(DUAL_CONTROL_APPROVAL_EVIDENCE_REF);
      expect(created.reservationId).not.toBeNull();
      expect(await postedCash(memberId)).toBe(amount);
      expect(await availableCash(memberId)).toBe(0n);
      // The approval path is not involved at all: the item is payout-eligible as created.
      expect((await withdrawals.list({ memberId, queue: "APPROVAL", limit: 50 })).items).toEqual([]);
      expect((await withdrawals.list({ memberId, queue: "REVIEW", limit: 50 })).items).toEqual([]);
      expect(
        (await withdrawals.list({ memberId, queue: "PAYOUT", limit: 50 })).items.map((item) => item.id),
      ).toEqual([created.id]);

      // No `approveWithdrawal` call is made anywhere in this case.
      const paid = await service.requestPayout(created.id, { adminId: BOUNDARY_ADMIN_ID }, randomUUID());
      expect(paid.state).toBe("PAYOUT_CONFIRMED");
      expect(paid.decidedByAdminId).toBeNull();
      expect(await availableCash(memberId)).toBe(0n);
    });

    it("releases the Reservation through the authoritative release path when an Admin rejects at the threshold", async () => {
      const amount = thresholdMinor();
      const memberId = await fundedMember(amount);
      const destinationId = await verifiedDestination(memberId);
      const { service, provider } = serviceWith({ [PAYOUT_PROVIDER_ID]: { outcome: "APPROVED" } });

      const created = await service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: amount, currency: "THB", idempotencyKey: randomUUID() },
        randomUUID(),
      );
      expect(created.state).toBe("REVIEWING");
      expect(await availableCash(memberId)).toBe(0n);

      const rejected = await service.rejectWithdrawal(
        created.id,
        { adminId: BOUNDARY_ADMIN_ID, reason: "Boundary withdrawal rejected by review" },
        randomUUID(),
      );
      expect(rejected.state).toBe("REJECTED");
      expect(rejected.decidedByAdminId).toBe(BOUNDARY_ADMIN_ID);
      expect(rejected.failureReason).toBe("REJECTED_BY_REVIEW");

      // The Reservation is RELEASED, never consumed, and the hold stops reducing
      // the available balance: the restoration is the Ledger projection's, not a
      // Payments-side balance edit.
      const released = await prisma.reservation.findUniqueOrThrow({
        where: { id: created.reservationId! },
        select: { releasedAt: true, consumedAt: true, amountMinor: true },
      });
      expect(released.releasedAt).not.toBeNull();
      expect(released.consumedAt).toBeNull();
      expect(BigInt(released.amountMinor)).toBe(amount);
      expect(await availableCash(memberId)).toBe(amount);
      expect(await postedCash(memberId)).toBe(amount);
      // A release is not a posting: no WITHDRAWAL_FINALIZE or other Ledger effect
      // was fabricated for the rejected withdrawal.
      expect(
        await prisma.financialTransaction.count({ where: { businessTransactionId: created.id } }),
      ).toBe(0);
      await expect(
        service.requestPayout(created.id, { adminId: BOUNDARY_ADMIN_ID }, randomUUID()),
      ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
      expect(provider.initiateCallCount).toBe(0);

      // The restored balance is genuinely spendable again.
      const retried = await service.createWithdrawal(
        memberId,
        { payoutDestinationId: destinationId, amountMinor: amount, currency: "THB", idempotencyKey: randomUUID() },
        randomUUID(),
      );
      expect(retried.state).toBe("REVIEWING");
      expect(await availableCash(memberId)).toBe(0n);
    });
  });
});

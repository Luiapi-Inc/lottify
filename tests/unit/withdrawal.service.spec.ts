import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WithdrawalService } from "../../src/contexts/payments/application/withdrawal.service";
import { requiresDualControlApproval } from "../../src/contexts/payments/domain/dual-control-approval";
import {
  getWithdrawalApprovalThresholdMinor,
  resetEnvironmentForTests,
} from "../../src/platform/config/env";
import type {
  CreateWithdrawalInput,
  WithdrawalListPage,
  WithdrawalListQuery,
  WithdrawalRecord,
  WithdrawalRepository,
  WithdrawalTransitionInput,
} from "../../src/contexts/payments/domain/withdrawal.repository";
import type { WithdrawalEventRecord } from "../../src/contexts/payments/domain/withdrawal.repository";
import { withdrawalCanTransition } from "../../src/contexts/payments/domain/withdrawal";
import type {
  CreatePayoutDestinationInput,
  PayoutDestinationRepository,
} from "../../src/contexts/payments/domain/payout-destination.repository";
import type { PayoutDestination } from "../../src/contexts/payments/domain/payout-destination";
import type { WithdrawalLedgerPort } from "../../src/contexts/payments/application/withdrawal-ledger.port";
import { WithdrawalFundsUnavailableError } from "../../src/contexts/payments/application/withdrawal-ledger.port";
import { DeterministicPayoutProviderFake } from "../../src/contexts/payments/infrastructure/deterministic-payout-provider.adapter";
import type { MemberWithdrawalRestrictionPort } from "../../src/contexts/payments/application/withdrawal-restriction.port";
import { UnrestrictedMemberWithdrawalRestrictionAdapter } from "../../src/contexts/payments/infrastructure/unrestricted-member-withdrawal-restriction.adapter";

class InMemoryWithdrawalRepository implements WithdrawalRepository {
  readonly rows = new Map<string, WithdrawalRecord>();
  readonly events: WithdrawalEventRecord[] = [];

  async create(input: CreateWithdrawalInput): Promise<WithdrawalRecord | null> {
    for (const row of this.rows.values()) {
      if (
        row.idempotencyScope === input.idempotencyScope &&
        row.idempotencyKey === input.idempotencyKey
      ) {
        return null;
      }
    }
    const now = new Date();
    const record: WithdrawalRecord = {
      id: input.id,
      memberId: input.memberId,
      payoutDestinationId: input.payoutDestinationId,
      amountMinor: input.amountMinor,
      feeMinor: input.feeMinor,
      currency: input.currency,
      state: "REQUESTED",
      version: 1,
      eligibilityOutcome: input.eligibilityOutcome,
      eligibilityPolicyVersion: input.eligibilityPolicyVersion,
      eligibilityReasonCodes: input.eligibilityReasonCodes,
      eligibilityEvidenceRefs: input.eligibilityEvidenceRefs,
      requiresApproval: input.requiresApproval,
      idempotencyScope: input.idempotencyScope,
      idempotencyKey: input.idempotencyKey,
      fingerprint: input.fingerprint,
      reservationId: null,
      providerId: input.providerId,
      providerReferenceKey: input.providerReferenceKey,
      providerTransactionId: null,
      payoutEvidenceRef: null,
      ledgerTransactionId: null,
      reconciliationAttempts: 0,
      decidedByAdminId: null,
      decisionReason: null,
      failureReason: null,
      incomingProviderError: null,
      correlationId: input.correlationId,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(record.id, record);
    this.events.push({
      id: randomUUID(),
      withdrawalId: record.id,
      fromState: null,
      toState: "REQUESTED",
      actorType: "MEMBER",
      actorId: input.memberId,
      reason: null,
      evidenceRef: null,
      correlationId: input.correlationId,
      createdAt: now,
    });
    return record;
  }

  async findById(id: string): Promise<WithdrawalRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async findByIdempotency(scope: string, key: string): Promise<WithdrawalRecord | null> {
    for (const row of this.rows.values()) {
      if (row.idempotencyScope === scope && row.idempotencyKey === key) return row;
    }
    return null;
  }

  async transition(input: WithdrawalTransitionInput): Promise<WithdrawalRecord | null> {
    const row = this.rows.get(input.id);
    if (!row) return null;
    if (row.state !== input.from || row.version !== input.expectedVersion) return null;
    if (!withdrawalCanTransition(input.from, input.to)) return null;
    const patch = input.patch ?? {};
    const next: WithdrawalRecord = {
      ...row,
      state: input.to,
      version: row.version + 1,
      reservationId: patch.reservationId ?? row.reservationId,
      providerTransactionId:
        patch.providerTransactionId === undefined
          ? row.providerTransactionId
          : patch.providerTransactionId,
      payoutEvidenceRef:
        patch.payoutEvidenceRef === undefined ? row.payoutEvidenceRef : patch.payoutEvidenceRef,
      ledgerTransactionId:
        patch.ledgerTransactionId === undefined
          ? row.ledgerTransactionId
          : patch.ledgerTransactionId,
      decidedByAdminId:
        patch.decidedByAdminId === undefined ? row.decidedByAdminId : patch.decidedByAdminId,
      decisionReason:
        patch.decisionReason === undefined ? row.decisionReason : patch.decisionReason,
      failureReason: patch.failureReason === undefined ? row.failureReason : patch.failureReason,
      incomingProviderError:
        patch.incomingProviderError === undefined
          ? row.incomingProviderError
          : patch.incomingProviderError,
      completedAt: patch.completedAt === undefined ? row.completedAt : patch.completedAt,
      reconciliationAttempts:
        row.reconciliationAttempts + (patch.countReconciliationAttempt ? 1 : 0),
    };
    this.rows.set(next.id, next);
    this.events.push({
      id: randomUUID(),
      withdrawalId: next.id,
      fromState: input.from,
      toState: input.to,
      actorType: input.event.actorType,
      actorId: input.event.actorId ?? null,
      reason: input.event.reason ?? null,
      evidenceRef: input.event.evidenceRef ?? null,
      correlationId: input.event.correlationId,
      createdAt: new Date(),
    });
    return next;
  }

  async list(query: WithdrawalListQuery): Promise<WithdrawalListPage> {
    const items = [...this.rows.values()].filter(
      (row) =>
        (!query.memberId || row.memberId === query.memberId) &&
        (!query.state || row.state === query.state),
    );
    return { items: items.slice(0, query.limit), nextCursor: null };
  }

  async listEvents(withdrawalId: string): Promise<readonly WithdrawalEventRecord[]> {
    return this.events.filter((event) => event.withdrawalId === withdrawalId);
  }
}

class InMemoryPayoutDestinationRepository implements PayoutDestinationRepository {
  constructor(private readonly rows: Map<string, PayoutDestination>) {}

  async create(input: CreatePayoutDestinationInput): Promise<PayoutDestination | null> {
    const now = new Date();
    const destination: PayoutDestination = {
      ...input,
      status: "PENDING",
      verificationEvidenceRef: null,
      verifiedAt: null,
      disabledAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(destination.id, destination);
    return destination;
  }

  async findById(id: string): Promise<PayoutDestination | null> {
    return this.rows.get(id) ?? null;
  }

  async findByAccountDigest(digest: string): Promise<readonly PayoutDestination[]> {
    return [...this.rows.values()].filter((row) => row.accountDigest === digest);
  }

  async listByMember(memberId: string): Promise<readonly PayoutDestination[]> {
    return [...this.rows.values()].filter((row) => row.memberId === memberId);
  }

  async resolveVerification(
    id: string,
    input: { status: PayoutDestination["status"]; expectedVersion: number; verifiedAt: Date | null },
  ): Promise<PayoutDestination | null> {
    const row = this.rows.get(id);
    if (!row || row.version !== input.expectedVersion) return null;
    const next = { ...row, status: input.status, verifiedAt: input.verifiedAt, version: row.version + 1 };
    this.rows.set(id, next);
    return next;
  }
}

class RecordingLedger implements WithdrawalLedgerPort {
  readonly reservations = new Map<string, string>();
  readonly releases: string[] = [];
  readonly finalizations: string[] = [];
  fundsUnavailableFor = new Set<string>();
  availableMinor = 1_000_00n;

  async getWithdrawalAvailableMinor(): Promise<bigint> {
    return this.availableMinor;
  }

  async reserveWithdrawal(input: {
    withdrawalId: string;
    memberId: string;
    amountMinor: bigint;
  }): Promise<string> {
    if (this.fundsUnavailableFor.has(input.memberId)) {
      throw new WithdrawalFundsUnavailableError("Reservation would exceed available spendable balance");
    }
    const existing = this.reservations.get(input.withdrawalId);
    if (existing) return existing;
    const reservationId = randomUUID();
    this.reservations.set(input.withdrawalId, reservationId);
    return reservationId;
  }

  async releaseWithdrawal(input: { withdrawalId: string; reservationId: string }): Promise<void> {
    this.releases.push(input.reservationId);
  }

  async finalizeWithdrawal(input: { withdrawalId: string; reservationId: string }): Promise<string> {
    this.finalizations.push(input.reservationId);
    return `ledger-txn:${input.withdrawalId}`;
  }
}

function destination(overrides: Partial<PayoutDestination> = {}): PayoutDestination {
  const now = new Date();
  return {
    id: randomUUID(),
    memberId: "member-1",
    type: "BANK_ACCOUNT",
    bankCode: "KBANK",
    accountNumberMasked: "******7890",
    accountDigest: "digest-1",
    accountHolderName: "Somchai",
    currency: "THB",
    status: "VERIFIED",
    verificationEvidenceRef: "destination-verification:abc",
    verifiedAt: now,
    disabledAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("WithdrawalService", () => {
  let withdrawals: InMemoryWithdrawalRepository;
  let destinationRows: Map<string, PayoutDestination>;
  let ledger: RecordingLedger;
  let provider: DeterministicPayoutProviderFake;
  let restrictions: MemberWithdrawalRestrictionPort;
  let service: WithdrawalService;
  let payoutTarget: PayoutDestination;

  beforeEach(() => {
    withdrawals = new InMemoryWithdrawalRepository();
    payoutTarget = destination();
    destinationRows = new Map([[payoutTarget.id, payoutTarget]]);
    ledger = new RecordingLedger();
    provider = new DeterministicPayoutProviderFake({ "payout-rail": { outcome: "APPROVED" } });
    restrictions = new UnrestrictedMemberWithdrawalRestrictionAdapter();
    service = new WithdrawalService(
      withdrawals,
      new InMemoryPayoutDestinationRepository(destinationRows),
      ledger,
      provider,
      restrictions,
    );
  });

  function create(amountMinor = 100_00n, key = randomUUID()) {
    return service.createWithdrawal(
      "member-1",
      {
        payoutDestinationId: payoutTarget.id,
        amountMinor,
        currency: "THB",
        idempotencyKey: key,
      },
      "corr-1",
    );
  }

  it("preflights withdrawal eligibility and authoritative balance without side effects", async () => {
    ledger.availableMinor = 50_00n;

    const decision = await service.preflightWithdrawal("member-1", {
      payoutDestinationId: payoutTarget.id,
      amountMinor: 60_00n,
      currency: "THB",
    });

    expect(decision).toMatchObject({
      balanceReady: false,
      availableMinor: 50_00n,
      minValid: true,
      maxValid: true,
      outcome: "DENY",
    });
    expect(decision.reasonCodes).toContain("INSUFFICIENT_FUNDS");
    expect(withdrawals.rows.size).toBe(0);
    expect(ledger.reservations.size).toBe(0);
  });

  it("reserves the authoritative funds and fast-paths an eligible withdrawal to APPROVED", async () => {
    const withdrawal = await create();

    expect(withdrawal.state).toBe("APPROVED");
    expect(withdrawal.version).toBe(3);
    expect(withdrawal.eligibilityOutcome).toBe("ALLOW");
    expect(withdrawal.reservationId).toBe(ledger.reservations.get(withdrawal.id));
    expect(withdrawals.events.map((event) => event.toState)).toEqual([
      "REQUESTED",
      "RESERVING",
      "APPROVED",
    ]);
  });

  it("routes an additional-review withdrawal to the APPROVAL queue after reserving", async () => {
    restrictions = {
      evaluate: async () => ({
        withdrawalBlocked: false,
        reviewRequired: true,
        reasonCodes: ["APPROVAL_THRESHOLD"],
        evidenceRefs: [],
      }),
    };
    service = new WithdrawalService(
      withdrawals,
      new InMemoryPayoutDestinationRepository(destinationRows),
      ledger,
      provider,
      restrictions,
    );

    const withdrawal = await create();
    expect(withdrawal.state).toBe("REVIEWING");
    expect(withdrawal.requiresApproval).toBe(true);
    expect(withdrawal.reservationId).not.toBeNull();
  });

  it("denies an unverified destination without creating a Reservation", async () => {
    payoutTarget = destination({ status: "PENDING", verifiedAt: null });
    destinationRows.set(payoutTarget.id, payoutTarget);

    const withdrawal = await create();
    expect(withdrawal.state).toBe("REJECTED");
    expect(withdrawal.failureReason).toBe("PAYOUT_DESTINATION_NOT_VERIFIED");
    expect(withdrawal.reservationId).toBeNull();
    expect(ledger.reservations.size).toBe(0);
  });

  it("refuses to exceed the available balance and never invents a Reservation", async () => {
    ledger.fundsUnavailableFor.add("member-1");

    await expect(create()).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    const only = [...withdrawals.rows.values()][0];
    expect(only?.state).toBe("REJECTED");
    expect(only?.reservationId).toBeNull();
    expect(ledger.reservations.size).toBe(0);
  });

  it("blocks a withdrawal capability restriction before reserving", async () => {
    restrictions = {
      evaluate: async () => ({
        withdrawalBlocked: true,
        reviewRequired: false,
        reasonCodes: ["WITHDRAWAL_BLOCKED"],
        evidenceRefs: ["restriction:1"],
      }),
    };
    service = new WithdrawalService(
      withdrawals,
      new InMemoryPayoutDestinationRepository(destinationRows),
      ledger,
      provider,
      restrictions,
    );

    const withdrawal = await create();
    expect(withdrawal.state).toBe("REJECTED");
    expect(withdrawal.eligibilityReasonCodes).toContain("CAPABILITY_RESTRICTION");
    expect(ledger.reservations.size).toBe(0);
  });

  it("replays the same Idempotency-Key and rejects a changed payload", async () => {
    const key = randomUUID();
    const first = await create(100_00n, key);
    const replay = await create(100_00n, key);

    expect(replay.id).toBe(first.id);
    expect(withdrawals.rows.size).toBe(1);
    expect(ledger.reservations.size).toBe(1);

    await expect(create(200_00n, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("cancels before payout and releases the Reservation", async () => {
    const withdrawal = await create();
    const cancelled = await service.cancelWithdrawal("member-1", withdrawal.id, "corr-2");

    expect(cancelled.state).toBe("CANCELLED");
    expect(ledger.releases).toEqual([withdrawal.reservationId]);
    await expect(
      service.cancelWithdrawal("member-1", withdrawal.id, "corr-3"),
    ).resolves.toMatchObject({ state: "CANCELLED" });
  });

  it("releases the Reservation when review rejects the withdrawal", async () => {
    const withdrawal = await create();
    const rejected = await service.rejectWithdrawal(
      withdrawal.id,
      { adminId: "admin-1", reason: "Evidence insufficient" },
      "corr-4",
    );

    expect(rejected.state).toBe("REJECTED");
    expect(ledger.releases).toEqual([withdrawal.reservationId]);
  });

  it("refuses to cancel once payout is in flight", async () => {
    const withdrawal = await create();
    await service.requestPayout(withdrawal.id, { adminId: "admin-1" }, "corr-5");

    await expect(
      service.cancelWithdrawal("member-1", withdrawal.id, "corr-6"),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("retains the Reservation on an ambiguous payout and recovers only by reconciliation", async () => {
    provider = new DeterministicPayoutProviderFake({
      "payout-rail": {
        startFailure: { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
        resolveOutcome: "APPROVED",
      },
    });
    service = new WithdrawalService(
      withdrawals,
      new InMemoryPayoutDestinationRepository(destinationRows),
      ledger,
      provider,
      restrictions,
    );

    const withdrawal = await create();
    const ambiguous = await service.requestPayout(withdrawal.id, { adminId: "admin-1" }, "corr-7");
    expect(ambiguous.state).toBe("RECONCILING");
    expect(ambiguous.incomingProviderError).toBe("AMBIGUOUS_OUTCOME");
    expect(ambiguous.reservationId).toBe(withdrawal.reservationId);
    expect(provider.initiateCallCount).toBe(1);
    expect(ledger.releases).toEqual([]);

    const recovered = await service.reconcileWithdrawal(
      withdrawal.id,
      { adminId: "admin-1" },
      "corr-8",
    );
    expect(recovered.state).toBe("PAYOUT_CONFIRMED");
    expect(recovered.reconciliationAttempts).toBe(1);
    // Reconciliation never re-initiates the external payout.
    expect(provider.initiateCallCount).toBe(1);

    const completed = await service.finalizeWithdrawal(
      withdrawal.id,
      { adminId: "admin-1" },
      "corr-9",
    );
    expect(completed.state).toBe("COMPLETED");
    expect(completed.ledgerTransactionId).toBe(`ledger-txn:${withdrawal.id}`);
    expect(ledger.finalizations).toEqual([withdrawal.reservationId]);
  });

  it("treats a proven payout rejection as FAILED and releases the Reservation", async () => {
    provider = new DeterministicPayoutProviderFake({
      "payout-rail": { outcome: "REJECTED" },
    });
    service = new WithdrawalService(
      withdrawals,
      new InMemoryPayoutDestinationRepository(destinationRows),
      ledger,
      provider,
      restrictions,
    );

    const withdrawal = await create();
    const failed = await service.requestPayout(withdrawal.id, { adminId: "admin-1" }, "corr-10");

    expect(failed.state).toBe("FAILED");
    expect(ledger.releases).toEqual([withdrawal.reservationId]);
  });

  it("refuses finalization without proven payout confirmation", async () => {
    const withdrawal = await create();
    await expect(
      service.finalizeWithdrawal(withdrawal.id, { adminId: "admin-1" }, "corr-11"),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(ledger.finalizations).toEqual([]);
  });

  it("rechecks destination eligibility before payout and releases on denial", async () => {
    const withdrawal = await create();
    const stale = { ...payoutTarget, status: "REJECTED" as const, verifiedAt: null };
    destinationRows.set(payoutTarget.id, stale);

    const rejected = await service.requestPayout(withdrawal.id, { adminId: "admin-1" }, "corr-12");
    expect(rejected.state).toBe("REJECTED");
    expect(ledger.releases).toEqual([withdrawal.reservationId]);
    expect(provider.initiateCallCount).toBe(0);
  });

  it("refuses an approval decision without a reason", async () => {
    const withdrawal = await create();
    await expect(
      service.approveWithdrawal(withdrawal.id, { adminId: "admin-1", reason: "  " }, "corr-13"),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("rejects a request for a destination that is not this Member's without persisting a withdrawal", async () => {
    const foreign = destination({ memberId: "member-2" });
    destinationRows.set(foreign.id, foreign);

    await expect(
      service.createWithdrawal(
        "member-1",
        {
          payoutDestinationId: foreign.id,
          amountMinor: 10_00n,
          currency: "THB",
          idempotencyKey: randomUUID(),
        },
        "corr-14",
      ),
    ).rejects.toMatchObject({ code: "PAYOUT_DESTINATION_NOT_ELIGIBLE" });
    expect(withdrawals.rows.size).toBe(0);
    expect(ledger.reservations.size).toBe(0);
  });

  it("reports an unknown destination identity identically to a foreign one", async () => {
    await expect(
      service.createWithdrawal(
        "member-1",
        {
          payoutDestinationId: randomUUID(),
          amountMinor: 10_00n,
          currency: "THB",
          idempotencyKey: randomUUID(),
        },
        "corr-15",
      ),
    ).rejects.toMatchObject({
      code: "PAYOUT_DESTINATION_NOT_ELIGIBLE",
      message: "Payout Destination is not linked to this Member",
    });
    expect(withdrawals.rows.size).toBe(0);
  });

  it("keeps a pending payout outcome in flight without inventing a workflow step", async () => {
    provider = new DeterministicPayoutProviderFake({ "payout-rail": { outcome: "PENDING" } });
    service = new WithdrawalService(
      withdrawals,
      new InMemoryPayoutDestinationRepository(destinationRows),
      ledger,
      provider,
      restrictions,
    );

    const withdrawal = await create();
    const inFlight = await service.requestPayout(withdrawal.id, { adminId: "admin-1" }, "corr-16");

    expect(inFlight.state).toBe("PAYOUT_PROCESSING");
    expect(inFlight.reservationId).toBe(withdrawal.reservationId);
    expect(ledger.releases).toEqual([]);
    // The observation is recorded as an in-flight payout event, not a transition.
    expect(withdrawals.events.at(-1)).toMatchObject({
      fromState: "PAYOUT_PROCESSING",
      toState: "PAYOUT_PROCESSING",
      reason: "PAYOUT_IN_FLIGHT",
    });
  });

  it("keeps an ambiguous withdrawal reconciling when the provider is still pending", async () => {
    provider = new DeterministicPayoutProviderFake({
      "payout-rail": {
        startFailure: { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
        resolveOutcome: "PENDING",
      },
    });
    service = new WithdrawalService(
      withdrawals,
      new InMemoryPayoutDestinationRepository(destinationRows),
      ledger,
      provider,
      restrictions,
    );

    const withdrawal = await create();
    const ambiguous = await service.requestPayout(withdrawal.id, { adminId: "admin-1" }, "corr-17");
    expect(ambiguous.state).toBe("RECONCILING");

    const stillReconciling = await service.reconcileWithdrawal(
      withdrawal.id,
      { adminId: "admin-1" },
      "corr-18",
    );
    expect(stillReconciling.state).toBe("RECONCILING");
    expect(stillReconciling.reconciliationAttempts).toBe(2);
    expect(stillReconciling.reservationId).toBe(withdrawal.reservationId);
    // A still-pending reconciliation never re-initiates the external payout.
    expect(provider.initiateCallCount).toBe(1);
    expect(ledger.releases).toEqual([]);
  });

  /**
   * G2→G3 cutover decision D11: the G2 `system_settings.
   * withdrawal.dual_control_threshold` (50,000.00 THB) has no G3 settings table, so
   * the value travels as configuration and gates the withdrawal at creation.
   */
  describe("dual-control approval threshold (D11)", () => {
    const THRESHOLD_VAR = "WITHDRAWAL_APPROVAL_THRESHOLD_MINOR";
    const G2_CUTOVER_THRESHOLD_MINOR = "5000000";
    const REQUIRED_ENVIRONMENT: Record<string, string> = {
      APP_ENV: "test",
      DATABASE_URL: "postgresql://user:***@localhost:5432/lottify",
      REDIS_URL: "redis://localhost:6379",
      JWT_ACCESS_SECRET: "01234567890123456789012345678901",
    };
    const originalThreshold = process.env[THRESHOLD_VAR];

    beforeEach(() => {
      // The threshold is read from configuration, so the environment is part of
      // the fixture: an unset value must fall back to the G2 cutover value.
      delete process.env[THRESHOLD_VAR];
      for (const [key, value] of Object.entries(REQUIRED_ENVIRONMENT)) {
        process.env[key] = value;
      }
      resetEnvironmentForTests();
      ledger.availableMinor = 500_000_00n;
    });

    afterEach(() => {
      if (originalThreshold === undefined) delete process.env[THRESHOLD_VAR];
      else process.env[THRESHOLD_VAR] = originalThreshold;
      resetEnvironmentForTests();
    });

    it("reads the threshold from configuration and never invents it in the domain", () => {
      expect(requiresDualControlApproval(5_000_000n, 5_000_000n)).toBe(true);
      expect(requiresDualControlApproval(4_999_999n, 5_000_000n)).toBe(false);
    });

    it("falls back to the G2 cutover value when the environment leaves it unset", () => {
      expect(getWithdrawalApprovalThresholdMinor()).toBe(
        BigInt(G2_CUTOVER_THRESHOLD_MINOR),
      );
      expect(getWithdrawalApprovalThresholdMinor()).toBe(50_000_00n);
    });

    it("honours an explicit configured threshold", () => {
      process.env[THRESHOLD_VAR] = "10000";
      resetEnvironmentForTests();

      expect(getWithdrawalApprovalThresholdMinor()).toBe(10_000n);
    });

    it("routes a withdrawal at or above the threshold to the APPROVAL queue", async () => {
      const withdrawal = await create(50_000_00n);

      expect(withdrawal.state).toBe("REVIEWING");
      expect(withdrawal.requiresApproval).toBe(true);
      expect(withdrawal.eligibilityOutcome).toBe("REVIEW_REQUIRED");
      expect(withdrawal.eligibilityReasonCodes).toContain("APPROVAL_THRESHOLD");
      expect(withdrawal.eligibilityEvidenceRefs).toContain(
        "policy:withdrawal.dual-control-threshold",
      );
      // The funds are still held authoritatively while the approval is pending.
      expect(withdrawal.reservationId).not.toBeNull();
    });

    it("fast-paths a withdrawal below the threshold", async () => {
      const withdrawal = await create(49_999_00n);

      expect(withdrawal.state).toBe("APPROVED");
      expect(withdrawal.requiresApproval).toBe(false);
      expect(withdrawal.eligibilityOutcome).toBe("ALLOW");
      expect(withdrawal.eligibilityReasonCodes).not.toContain("APPROVAL_THRESHOLD");
    });

    it("applies a configured threshold instead of the default", async () => {
      process.env[THRESHOLD_VAR] = "100000";
      resetEnvironmentForTests();

      const withdrawal = await create(1_000_00n);

      expect(withdrawal.state).toBe("REVIEWING");
      expect(withdrawal.requiresApproval).toBe(true);
    });

    it("clears the creation gate once an Admin approves, so payout is not rejected", async () => {
      const created = await create(60_000_00n);
      expect(created.state).toBe("REVIEWING");

      const approved = await service.approveWithdrawal(
        created.id,
        { adminId: "admin-1", reason: "dual-control review" },
        "corr-19",
      );
      expect(approved.state).toBe("APPROVED");

      // The pre-payout recheck must not re-apply the creation-time gate: a
      // REVIEW_REQUIRED verdict there is terminal (APPROVED -> REJECTED).
      const processing = await service.requestPayout(
        approved.id,
        { adminId: "admin-2" },
        "corr-20",
      );
      expect(processing.state).not.toBe("REJECTED");
      expect(["PAYOUT_PROCESSING", "PAYOUT_CONFIRMED"]).toContain(processing.state);
      expect(ledger.releases).toEqual([]);
    });
  });
});

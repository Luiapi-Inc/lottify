import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DepositError, type Deposit, type DepositStatus } from "../../src/contexts/payments/domain/deposit";
import type { CreateDepositInput, ResolveDepositInput } from "../../src/contexts/payments/domain/deposit.repository";
import { DepositService } from "../../src/contexts/payments/application/deposit.service";
import { DeterministicPaymentProviderFake } from "../../src/contexts/payments/infrastructure/deterministic-payment-provider.adapter";
import type { DepositLedgerPort } from "../../src/contexts/payments/application/deposit-ledger.port";

class InMemoryDepositRepository {
  private readonly rows = new Map<string, Deposit>();
  private readonly byIdempotency = new Map<string, Deposit>();

  async create(input: CreateDepositInput): Promise<Deposit | null> {
    const key = idempotencyKeyOf(input.idempotencyScope, input.idempotencyKey);
    if (this.byIdempotency.has(key)) return null;
    const now = new Date();
    const deposit: Deposit = {
      ...input,
      status: "INITIATED",
      providerTransactionId: null,
      requestAttemptId: null,
      ledgerTransactionId: null,
      incomingProviderError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(input.id, deposit);
    this.byIdempotency.set(key, deposit);
    return deposit;
  }

  async findById(id: string): Promise<Deposit | null> {
    return this.rows.get(id) ?? null;
  }

  async findByIdempotency(scope: string, key: string): Promise<Deposit | null> {
    return this.byIdempotency.get(idempotencyKeyOf(scope, key)) ?? null;
  }

  async resolve(id: string, input: ResolveDepositInput): Promise<Deposit> {
    const current = this.rows.get(id);
    if (!current) throw new Error("missing");
    const updated: Deposit = {
      ...current,
      status: input.status as DepositStatus,
      providerTransactionId: input.providerTransactionId ?? current.providerTransactionId,
      incomingProviderError: input.incomingProviderError ?? null,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    this.byIdempotency.set(idempotencyKeyOf(updated.idempotencyScope, updated.idempotencyKey), updated);
    return updated;
  }

  async markCredited(id: string, ledgerTransactionId: string): Promise<Deposit> {
    const current = this.rows.get(id)!;
    const updated: Deposit = {
      ...current,
      ledgerTransactionId,
      status: "COMPLETED",
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    this.byIdempotency.set(idempotencyKeyOf(updated.idempotencyScope, updated.idempotencyKey), updated);
    return updated;
  }

  /** Seeds a pre-existing row (e.g. one left COMPLETED-without-credit by a simulated crash). */
  seed(deposit: Deposit): void {
    this.rows.set(deposit.id, deposit);
    this.byIdempotency.set(idempotencyKeyOf(deposit.idempotencyScope, deposit.idempotencyKey), deposit);
  }
}

class RecordingLedgerPort implements DepositLedgerPort {
  readonly credits: Array<{ depositId: string; amountMinor: bigint }> = [];
  private next = 0;

  async creditDeposit(input: { depositId: string; amountMinor: bigint }): Promise<string> {
    this.credits.push({ depositId: input.depositId, amountMinor: input.amountMinor });
    return `ledger-txn-${++this.next}`;
  }
}

function idempotencyKeyOf(scope: string, key: string): string {
  return `${scope}:${key}`;
}

describe("DepositService", () => {
  function depositService(scenarios: Record<string, unknown>): {
    service: DepositService;
    ledger: RecordingLedgerPort;
    provider: DeterministicPaymentProviderFake;
    repository: InMemoryDepositRepository;
  } {
    const repository = new InMemoryDepositRepository();
    const ledger = new RecordingLedgerPort();
    const provider = new DeterministicPaymentProviderFake(scenarios as any);
    const service = new DepositService(
      repository as any,
      ledger,
      provider,
    );
    return { service, ledger, provider, repository };
  }

  const memberId = randomUUID();
  const baseCommand = {
    providerCode: "corridor",
    methodCode: "bank-transfer",
    amountMinor: 100_00n,
    currency: "THB" as const,
  };

  it("completes and credits exactly once on an APPROVED provider outcome", async () => {
    const { service, ledger } = depositService({ corridor: { outcome: "APPROVED" } });
    const deposit = await service.initiateDeposit(
      memberId,
      { ...baseCommand, idempotencyKey: randomUUID() },
      "corr-1",
    );
    expect(deposit.status).toBe("COMPLETED");
    expect(deposit.ledgerTransactionId).toBe("ledger-txn-1");
    expect(ledger.credits).toHaveLength(1);
    expect(ledger.credits[0]!.amountMinor).toBe(100_00n);
  });

  it("returns the prior result on a same-key retry without re-initiating or re-crediting", async () => {
    const { service, ledger, provider } = depositService({ corridor: { outcome: "APPROVED" } });
    const key = randomUUID();
    const first = await service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: key }, "corr-1");
    const replay = await service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: key }, "corr-2");
    expect(replay.id).toBe(first.id);
    expect(replay.status).toBe("COMPLETED");
    expect(ledger.credits).toHaveLength(1);
    // provider initiate happened strictly once (no fresh external side effect on retry)
    expect(provider.initiateCallCount).toBe(1);
  });

  it("rejects a changed payload under the same key as IDEMPOTENCY_CONFLICT", async () => {
    const { service } = depositService({ corridor: { outcome: "APPROVED" } });
    const key = randomUUID();
    await service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: key }, "corr-1");
    await expect(
      service.initiateDeposit(memberId, { ...baseCommand, amountMinor: 200_00n, idempotencyKey: key }, "corr-2"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("requires a non-empty Idempotency-Key", async () => {
    const { service } = depositService({ corridor: { outcome: "APPROVED" } });
    await expect(
      service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: "" }, "corr-1"),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("keeps a BUSINESS_REJECTION as REJECTED with no credit and never resolves to a refund", async () => {
    const { service, ledger } = depositService({
      corridor: {
        startFailure: { category: "BUSINESS_REJECTION", retryable: false, evidenceRefs: [] },
      },
    });
    const deposit = await service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: randomUUID() }, "corr-1");
    expect(deposit.status).toBe("REJECTED");
    expect(deposit.incomingProviderError).toBe("BUSINESS_REJECTION");
    expect(ledger.credits).toHaveLength(0);

    const reconciled = await service.reconcileDeposit(memberId, deposit.id, "corr-2");
    expect(reconciled.status).toBe("REJECTED");
    expect(ledger.credits).toHaveLength(0);
  });

  it("records AMBIGUOUS_OUTCOME as REVIEW_REQUIRED without crediting, then credits once after resolution", async () => {
    const { service, ledger } = depositService({
      corridor: {
        startFailure: { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
        resolveOutcome: "APPROVED",
      },
    });
    const deposit = await service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: randomUUID() }, "corr-1");
    expect(deposit.status).toBe("REVIEW_REQUIRED");
    expect(ledger.credits).toHaveLength(0);
    // blocking property: ambiguous initiation never posted money.
    expect(deposit.ledgerTransactionId).toBeNull();

    // recovery only happens through the reconciliation seam, using the same
    // provider reference key; no blind re-initiation of the side effect.
    const recovered = await service.reconcileDeposit(memberId, deposit.id, "corr-2");
    expect(recovered.status).toBe("COMPLETED");
    expect(ledger.credits).toHaveLength(1);

    // a second reconcile is idempotent at the ledger layer (no double credit).
    await service.reconcileDeposit(memberId, deposit.id, "corr-3");
    expect(ledger.credits).toHaveLength(1);
  });

  it("stays REVIEW_REQUIRED when an ambiguous provider never resolves", async () => {
    const { service, ledger } = depositService({
      corridor: {
        startFailure: { category: "AMBIGUOUS_OUTCOME", retryable: false, evidenceRefs: [] },
      },
    });
    const deposit = await service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: randomUUID() }, "corr-1");
    expect(deposit.status).toBe("REVIEW_REQUIRED");
    const reconciled = await service.reconcileDeposit(memberId, deposit.id, "corr-2");
    expect(reconciled.status).toBe("REVIEW_REQUIRED");
    expect(ledger.credits).toHaveLength(0);
  });

  it("never exposes another member's deposit", async () => {
    const { service } = depositService({ corridor: { outcome: "APPROVED" } });
    const deposit = await service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: randomUUID() }, "corr-1");
    await expect(service.getDeposit(randomUUID(), deposit.id)).rejects.toBeInstanceOf(DepositError);
  });

  it("conflicts when the same key changes providerCode (idempotency scope includes routing)", async () => {
    const { service } = depositService({ corridor: { outcome: "APPROVED" } });
    const key = randomUUID();
    await service.initiateDeposit(memberId, { ...baseCommand, idempotencyKey: key }, "corr-1");
    await expect(
      service.initiateDeposit(
        memberId,
        { ...baseCommand, providerCode: "another-provider", idempotencyKey: key },
        "corr-2",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("heals a deposit stranded COMPLETED-without-credit to exactly one ledger credit", async () => {
    const { service, ledger, repository } = depositService({});
    // Simulate the crash window: the COMPLETED resolve committed but the Ledger
    // credit + markCredited never ran, leaving a durably COMPLETED deposit with
    // no ledger reference and no posting.
    const depositId = randomUUID();
    repository.seed({
      id: depositId,
      memberId,
      providerId: "corridor",
      providerCode: "corridor",
      methodCode: "bank-transfer",
      amountMinor: 100_00n,
      currency: "THB",
      status: "COMPLETED",
      idempotencyScope: `DEPOSIT_INITIATE:${memberId}`,
      idempotencyKey: randomUUID(),
      fingerprint: "x",
      providerReferenceKey: `dep:${depositId}`,
      providerTransactionId: "provider-txn-1",
      requestAttemptId: null,
      correlationId: "corr-crash",
      ledgerTransactionId: null,
      incomingProviderError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const healed = await service.reconcileDeposit(memberId, depositId, "corr-heal");
    expect(healed.status).toBe("COMPLETED");
    expect(healed.ledgerTransactionId).toBe("ledger-txn-1");
    expect(ledger.credits).toHaveLength(1);
    expect(ledger.credits[0]!.depositId).toBe(depositId);
    expect(ledger.credits[0]!.amountMinor).toBe(100_00n);

    // a second reconcile is idempotent at the ledger layer: no double credit.
    const again = await service.reconcileDeposit(memberId, depositId, "corr-heal-2");
    expect(again.ledgerTransactionId).toBe("ledger-txn-1");
    expect(ledger.credits).toHaveLength(1);
  });
});
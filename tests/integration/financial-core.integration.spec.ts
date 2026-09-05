import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("financial core integration", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;

  beforeAll(async () => {
    prisma = new PrismaService();
    ledger = new FinancialLedgerService(new PrismaFinancialLedgerRepository(prisma));
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.reservationAllocation.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.ledgerPosting.deleteMany();
    await prisma.financialTransaction.deleteMany();
    await prisma.ledgerAccount.deleteMany();
    await prisma.$disconnect();
  });

  it("posts a balanced financial transaction once and replays the same idempotent result", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);
    const idempotencyKey = randomUUID();
    const input = {
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.deposit",
        key: idempotencyKey,
        fingerprint: "deposit:10000",
      },
      domainReferences: { depositId: randomUUID() },
      currency: "THB" as const,
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT" as const, amountMinor: 10_000n },
        { accountId: cashAccountId, side: "CREDIT" as const, amountMinor: 10_000n },
      ],
    };

    const first = await ledger.post(input);
    const replay = await ledger.post(input);

    expect(replay).toBe(first);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(10_000n);
    await expect(
      ledger.post({
        ...input,
        idempotency: { ...input.idempotency, fingerprint: "different-payload" },
      }),
    ).rejects.toThrow("idempotency conflict");
  });

  it("serializes concurrent reservations so available balance cannot be over-reserved", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.seed",
        key: randomUUID(),
        fingerprint: "seed:10000",
      },
      domainReferences: { test: "reservation-concurrency" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 10_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 10_000n },
      ],
    });

    const reserve = (suffix: string) =>
      ledger.reserve({
        purpose: "WITHDRAWAL",
        businessReference: `withdrawal:${randomUUID()}:${suffix}`,
        memberId,
        currency: "THB",
        amountMinor: 6_000n,
        correlationId: randomUUID(),
        idempotency: {
          scope: "financial.integration.withdrawal.reserve",
          key: randomUUID(),
          fingerprint: `withdrawal:${suffix}:6000`,
        },
        allocations: [{ accountId: cashAccountId, amountMinor: 6_000n }],
      });

    const results = await Promise.allSettled([reserve("a"), reserve("b")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(4_000n);
  });

  it("releases a Reservation idempotently and restores its held availability", async () => {
    const memberId = randomUUID();
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const providerAccountId = await ledger.ensureSystemAccount(`provider:${randomUUID()}`);

    await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.release.seed",
        key: randomUUID(),
        fingerprint: "seed:5000",
      },
      domainReferences: { test: "reservation-release" },
      currency: "THB",
      effectiveAt: new Date(),
      postings: [
        { accountId: providerAccountId, side: "DEBIT", amountMinor: 5_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 5_000n },
      ],
    });

    const reservationId = await ledger.reserve({
      purpose: "WITHDRAWAL",
      businessReference: `withdrawal:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 3_000n,
      correlationId: randomUUID(),
      idempotency: {
        scope: "financial.integration.release.reserve",
        key: randomUUID(),
        fingerprint: "withdrawal:3000",
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 3_000n }],
    });

    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(2_000n);
    const firstRelease = await ledger.releaseReservation(reservationId);
    const replayRelease = await ledger.releaseReservation(reservationId);
    expect(replayRelease).toEqual(firstRelease);
    expect(await ledger.getAvailableMinorUnits(cashAccountId)).toBe(5_000n);
  });
});

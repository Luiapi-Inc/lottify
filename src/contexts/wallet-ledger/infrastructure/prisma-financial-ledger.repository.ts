import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  type FinancialLedgerRepository,
  type PostFinancialTransactionInput,
  type ReserveFundsInput,
} from "../domain/financial-ledger.repository";
import {
  assertBalancedLedgerPostings,
  assertReservationCanBeCreated,
  calculateAvailableMinorUnits,
} from "../domain/financial-invariants";

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PrismaFinancialLedgerRepository implements FinancialLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensureMemberAccount(input: {
    memberId: string;
    bucket: "CASH" | "BONUS" | "LOCKED";
    currency: "THB";
  }): Promise<string> {
    const existing = await this.prisma.ledgerAccount.findFirst({
      where: {
        kind: "MEMBER",
        memberId: input.memberId,
        bucket: input.bucket,
        currency: input.currency,
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    try {
      const created = await this.prisma.ledgerAccount.create({
        data: {
          kind: "MEMBER",
          memberId: input.memberId,
          bucket: input.bucket,
          currency: input.currency,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.prisma.ledgerAccount.findFirstOrThrow({
        where: {
          kind: "MEMBER",
          memberId: input.memberId,
          bucket: input.bucket,
          currency: input.currency,
        },
        select: { id: true },
      });
      return raced.id;
    }
  }

  async ensureSystemAccount(input: {
    systemCode: string;
    currency: "THB";
  }): Promise<string> {
    const existing = await this.prisma.ledgerAccount.findFirst({
      where: {
        kind: "SYSTEM",
        systemCode: input.systemCode,
        currency: input.currency,
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    try {
      const created = await this.prisma.ledgerAccount.create({
        data: {
          kind: "SYSTEM",
          systemCode: input.systemCode,
          currency: input.currency,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.prisma.ledgerAccount.findFirstOrThrow({
        where: {
          kind: "SYSTEM",
          systemCode: input.systemCode,
          currency: input.currency,
        },
        select: { id: true },
      });
      return raced.id;
    }
  }

  async post(input: PostFinancialTransactionInput): Promise<string> {
    assertBalancedLedgerPostings(
      input.postings.map((posting) => ({
        side: posting.side,
        amountMinor: posting.amountMinor,
        currency: input.currency,
      })),
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const accountIds = uniqueSorted(input.postings.map((posting) => posting.accountId));
        await lockAccounts(tx, accountIds);
        await assertPostingAccounts(tx, accountIds, input.currency);

        const created = await tx.financialTransaction.create({
          data: {
            businessTransactionId: input.businessTransactionId,
            operationType: input.operationType,
            correlationId: input.correlationId,
            idempotencyScope: input.idempotency.scope,
            idempotencyKey: input.idempotency.key,
            fingerprint: input.idempotency.fingerprint,
            domainReferences: { ...input.domainReferences },
            currency: input.currency,
            effectiveAt: input.effectiveAt,
            correctionKind: input.correction?.kind,
            correctsTransactionId: input.correction?.correctsTransactionId,
            postings: {
              create: input.postings.map((posting) => ({
                accountId: posting.accountId,
                side: posting.side,
                amountMinor: posting.amountMinor,
              })),
            },
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.financialTransaction.findUnique({
        where: {
          idempotencyScope_idempotencyKey: {
            idempotencyScope: input.idempotency.scope,
            idempotencyKey: input.idempotency.key,
          },
        },
        select: { id: true, fingerprint: true },
      });
      if (existing?.fingerprint === input.idempotency.fingerprint) return existing.id;
      throw new Error("Financial transaction idempotency conflict");
    }
  }

  async reserve(input: ReserveFundsInput): Promise<string> {
    validateReservationInput(input);

    const existing = await this.findReplayableReservation(input);
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const accountIds = uniqueSorted(input.allocations.map((allocation) => allocation.accountId));
        await lockAccounts(tx, accountIds);

        const accounts = await tx.ledgerAccount.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, kind: true, memberId: true, bucket: true, currency: true },
        });
        if (accounts.length !== accountIds.length) {
          throw new Error("Reservation references an unknown Ledger account");
        }

        const accountById = new Map(accounts.map((account) => [account.id, account]));
        for (const allocation of input.allocations) {
          const account = accountById.get(allocation.accountId);
          if (!account || account.kind !== "MEMBER" || account.memberId !== input.memberId) {
            throw new Error("Reservation allocation must use the owning Member Ledger account");
          }
          if (account.currency !== input.currency) {
            throw new Error("Reservation currency must match the Ledger account currency");
          }
          if (input.purpose === "WITHDRAWAL" && account.bucket !== "CASH") {
            throw new Error("Withdrawal reservations may use Member CASH only");
          }

          const availability = await getAccountAvailability(tx, allocation.accountId);
          assertReservationCanBeCreated(
            availability.postedMinor,
            availability.activeReservationAmountsMinor,
            allocation.amountMinor,
          );
        }

        const created = await tx.reservation.create({
          data: {
            purpose: input.purpose,
            businessReference: input.businessReference,
            memberId: input.memberId,
            currency: input.currency,
            amountMinor: input.amountMinor,
            correlationId: input.correlationId,
            idempotencyScope: input.idempotency.scope,
            idempotencyKey: input.idempotency.key,
            fingerprint: input.idempotency.fingerprint,
            allocations: {
              create: input.allocations.map((allocation) => ({
                accountId: allocation.accountId,
                amountMinor: allocation.amountMinor,
              })),
            },
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replay = await this.findReplayableReservation(input);
      if (replay) return replay;
      throw new Error("Reservation identity conflict");
    }
  }

  async releaseReservation(reservationId: string): Promise<Date> {
    return this.prisma.$transaction(async (tx) => {
      await lockReservation(tx, reservationId);
      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
        select: { releasedAt: true, consumedAt: true },
      });
      if (!reservation) throw new Error("Reservation not found");
      if (reservation.consumedAt) throw new Error("Consumed Reservation cannot be released");
      if (reservation.releasedAt) return reservation.releasedAt;

      const releasedAt = new Date();
      await tx.reservation.update({
        where: { id: reservationId },
        data: { releasedAt },
      });
      return releasedAt;
    });
  }

  async getAvailableMinorUnits(accountId: string): Promise<bigint> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { id: accountId },
      select: { kind: true },
    });
    if (!account || account.kind !== "MEMBER") {
      throw new Error("Wallet availability requires a Member Ledger account");
    }

    const availability = await getAccountAvailability(this.prisma, accountId);
    const availableMinor = calculateAvailableMinorUnits(
      availability.postedMinor,
      availability.activeReservationAmountsMinor,
    );
    return availableMinor > 0n ? availableMinor : 0n;
  }

  private async findReplayableReservation(input: ReserveFundsInput): Promise<string | null> {
    const byIdempotency = await this.prisma.reservation.findUnique({
      where: {
        idempotencyScope_idempotencyKey: {
          idempotencyScope: input.idempotency.scope,
          idempotencyKey: input.idempotency.key,
        },
      },
      select: { id: true, fingerprint: true },
    });
    if (byIdempotency) {
      if (byIdempotency.fingerprint !== input.idempotency.fingerprint) {
        throw new Error("Reservation idempotency conflict");
      }
      return byIdempotency.id;
    }

    const byBusinessReference = await this.prisma.reservation.findUnique({
      where: {
        purpose_businessReference: {
          purpose: input.purpose,
          businessReference: input.businessReference,
        },
      },
      select: { id: true, fingerprint: true },
    });
    if (!byBusinessReference) return null;
    if (byBusinessReference.fingerprint !== input.idempotency.fingerprint) {
      throw new Error("Reservation business identity conflict");
    }
    return byBusinessReference.id;
  }
}

function validateReservationInput(input: ReserveFundsInput): void {
  if (input.amountMinor <= 0n) {
    throw new Error("Reservation amount must be positive integer minor units");
  }
  if (input.allocations.length === 0) {
    throw new Error("Reservation requires at least one source allocation");
  }

  const accountIds = input.allocations.map((allocation) => allocation.accountId);
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error("Reservation source allocations must use unique Ledger accounts");
  }

  const allocatedMinor = input.allocations.reduce((total, allocation) => {
    if (allocation.amountMinor <= 0n) {
      throw new Error("Reservation allocation must be positive integer minor units");
    }
    return total + allocation.amountMinor;
  }, 0n);
  if (allocatedMinor !== input.amountMinor) {
    throw new Error("Reservation allocations must equal the Reservation amount");
  }
}

async function assertPostingAccounts(
  tx: TransactionClient,
  accountIds: readonly string[],
  currency: "THB",
): Promise<void> {
  const accounts = await tx.ledgerAccount.findMany({
    where: { id: { in: [...accountIds] } },
    select: { id: true, currency: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new Error("Financial transaction references an unknown Ledger account");
  }
  if (accounts.some((account) => account.currency !== currency)) {
    throw new Error("Financial transaction must post within one currency");
  }
}

async function getAccountAvailability(
  tx: Pick<TransactionClient, "ledgerPosting" | "reservationAllocation">,
  accountId: string,
): Promise<{ postedMinor: bigint; activeReservationAmountsMinor: bigint[] }> {
  const [postings, activeAllocations] = await Promise.all([
    tx.ledgerPosting.findMany({
      where: { accountId },
      select: { side: true, amountMinor: true },
    }),
    tx.reservationAllocation.findMany({
      where: {
        accountId,
        reservation: { releasedAt: null, consumedAt: null },
      },
      select: { amountMinor: true },
    }),
  ]);

  const postedMinor = postings.reduce(
    (balance, posting) =>
      posting.side === "CREDIT" ? balance + posting.amountMinor : balance - posting.amountMinor,
    0n,
  );
  return {
    postedMinor,
    activeReservationAmountsMinor: activeAllocations.map((allocation) => allocation.amountMinor),
  };
}

async function lockAccounts(tx: TransactionClient, accountIds: readonly string[]): Promise<void> {
  if (accountIds.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "ledger_accounts" WHERE "id" IN (${Prisma.join(
      accountIds.map((id) => Prisma.sql`${id}::uuid`),
    )}) ORDER BY "id" FOR UPDATE`,
  );
}

async function lockReservation(tx: TransactionClient, reservationId: string): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId}::uuid FOR UPDATE`,
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

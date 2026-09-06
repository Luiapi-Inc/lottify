import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  type ConsumeReservationAndPostInput,
  type FinancialLedgerRepository,
  type PostFinancialTransactionInput,
  type ReserveFundsInput,
  type ReverseFinancialTransactionInput,
  type WalletProjection,
} from "../domain/financial-ledger.repository";
import {
  MEMBER_LEDGER_BUCKETS,
  assertBalancedLedgerPostings,
  assertReservationCanBeCreated,
  calculateAvailableMinorUnits,
  isDebtRecoveryRestricted,
} from "../domain/financial-invariants";
import {
  type AccountingPeriodTransactionClock,
  DatabaseAccountingPeriodTransactionClock,
  ensureAutomaticAccountingPeriodCoverage,
} from "./accounting-period-runtime";

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PrismaFinancialLedgerRepository implements FinancialLedgerRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(DatabaseAccountingPeriodTransactionClock)
    private readonly accountingPeriodClock: AccountingPeriodTransactionClock,
  ) {}

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
        const replay = await findReplayableFinancialPost(tx, input);
        if (replay) return replay;

        const accountIds = uniqueSorted(input.postings.map((posting) => posting.accountId));
        await lockAccounts(tx, accountIds);
        const accounts = await assertPostingAccounts(tx, accountIds, input.currency);
        assertOperationPostingSemantics(input, accounts);
        if (input.correction) {
          await assertCompensationTarget(
            tx,
            input.correction.correctsTransactionId,
            input.currency,
          );
        }
        const accountingPeriod = await resolveAuthoritativeAccountingPeriodForPosting(
          tx,
          this.accountingPeriodClock,
        );

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
            postedAt: accountingPeriod.postedAt,
            accountingPeriodId: accountingPeriod.id,
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
      const replay = await findReplayableFinancialPost(this.prisma, input);
      if (replay) return replay;
      throw new Error("Financial transaction idempotency conflict");
    }
  }

  async reverseTransaction(input: ReverseFinancialTransactionInput): Promise<string> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.financialTransaction.findUnique({
          where: {
            idempotencyScope_idempotencyKey: {
              idempotencyScope: input.idempotency.scope,
              idempotencyKey: input.idempotency.key,
            },
          },
          select: {
            id: true,
            fingerprint: true,
            correctionKind: true,
            correctsTransactionId: true,
          },
        });
        if (replay) {
          if (
            replay.fingerprint === input.idempotency.fingerprint &&
            replay.correctionKind === "REVERSAL" &&
            replay.correctsTransactionId === input.originalTransactionId
          ) {
            return replay.id;
          }
          throw new Error("Financial transaction idempotency conflict");
        }

        await lockFinancialTransaction(tx, input.originalTransactionId);
        const original = await tx.financialTransaction.findUnique({
          where: { id: input.originalTransactionId },
          select: {
            id: true,
            currency: true,
            postings: {
              select: { accountId: true, side: true, amountMinor: true },
              orderBy: { id: "asc" },
            },
          },
        });
        if (!original) throw new Error("Financial transaction to reverse not found");

        const existingReversal = await tx.financialTransaction.findFirst({
          where: {
            correctionKind: "REVERSAL",
            correctsTransactionId: input.originalTransactionId,
          },
          select: { id: true },
        });
        if (existingReversal) {
          throw new Error("Financial transaction already reversed");
        }

        if (original.currency !== "THB") {
          throw new Error("Financial reversal currency is unsupported");
        }

        const postings = original.postings.map((posting) => ({
          accountId: posting.accountId,
          side: posting.side === "DEBIT" ? ("CREDIT" as const) : ("DEBIT" as const),
          amountMinor: posting.amountMinor,
        }));
        assertBalancedLedgerPostings(
          postings.map((posting) => ({
            side: posting.side,
            amountMinor: posting.amountMinor,
            currency: "THB" as const,
          })),
        );

        const accountIds = uniqueSorted(postings.map((posting) => posting.accountId));
        await lockAccounts(tx, accountIds);
        await assertPostingAccounts(tx, accountIds, "THB");
        const accountingPeriod = await resolveAuthoritativeAccountingPeriodForPosting(
          tx,
          this.accountingPeriodClock,
        );

        const created = await tx.financialTransaction.create({
          data: {
            businessTransactionId: input.businessTransactionId,
            operationType: input.operationType,
            correlationId: input.correlationId,
            idempotencyScope: input.idempotency.scope,
            idempotencyKey: input.idempotency.key,
            fingerprint: input.idempotency.fingerprint,
            domainReferences: { ...input.domainReferences },
            currency: "THB",
            effectiveAt: input.effectiveAt,
            postedAt: accountingPeriod.postedAt,
            accountingPeriodId: accountingPeriod.id,
            correctionKind: "REVERSAL",
            correctsTransactionId: input.originalTransactionId,
            postings: { create: postings },
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      const replay = await this.prisma.financialTransaction.findUnique({
        where: {
          idempotencyScope_idempotencyKey: {
            idempotencyScope: input.idempotency.scope,
            idempotencyKey: input.idempotency.key,
          },
        },
        select: {
          id: true,
          fingerprint: true,
          correctionKind: true,
          correctsTransactionId: true,
        },
      });
      if (
        replay?.fingerprint === input.idempotency.fingerprint &&
        replay.correctionKind === "REVERSAL" &&
        replay.correctsTransactionId === input.originalTransactionId
      ) {
        return replay.id;
      }

      const existingReversal = await this.prisma.financialTransaction.findFirst({
        where: {
          correctionKind: "REVERSAL",
          correctsTransactionId: input.originalTransactionId,
        },
        select: { id: true },
      });
      if (existingReversal) throw new Error("Financial transaction already reversed");
      throw new Error("Financial transaction idempotency conflict");
    }
  }

  async reserve(input: ReserveFundsInput): Promise<string> {
    validateReservationInput(input);

    const existing = await this.findReplayableReservation(input);
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const allocationAccountIds = uniqueSorted(
          input.allocations.map((allocation) => allocation.accountId),
        );
        const cashAccount = await tx.ledgerAccount.findFirst({
          where: {
            kind: "MEMBER",
            memberId: input.memberId,
            bucket: "CASH",
            currency: input.currency,
          },
          select: { id: true },
        });
        const lockedAccountIds = uniqueSorted([
          ...allocationAccountIds,
          ...(cashAccount ? [cashAccount.id] : []),
        ]);
        await lockAccounts(tx, lockedAccountIds);

        const accounts = await tx.ledgerAccount.findMany({
          where: { id: { in: allocationAccountIds } },
          select: { id: true, kind: true, memberId: true, bucket: true, currency: true },
        });
        if (accounts.length !== allocationAccountIds.length) {
          throw new Error("Reservation references an unknown Ledger account");
        }

        if (cashAccount) {
          const postedCashMinor = await getAccountPostedMinor(tx, cashAccount.id);
          if (isDebtRecoveryRestricted(postedCashMinor)) {
            throw new Error("Member debt blocks betting and withdrawal availability");
          }
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
          if (
            input.purpose === "BET" &&
            account.bucket !== "CASH" &&
            account.bucket !== "BONUS"
          ) {
            throw new Error("Bet reservations may use Member CASH or BONUS only");
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

  async consumeReservationAndPost(input: ConsumeReservationAndPostInput): Promise<string> {
    validateReservationConsumptionInput(input);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockReservation(tx, input.reservationId);
        const reservation = await tx.reservation.findUnique({
          where: { id: input.reservationId },
          select: {
            id: true,
            purpose: true,
            memberId: true,
            currency: true,
            amountMinor: true,
            releasedAt: true,
            consumedAt: true,
            consumingTransactionId: true,
            allocations: {
              select: {
                accountId: true,
                amountMinor: true,
              },
            },
          },
        });
        if (!reservation) throw new Error("Reservation not found");

        assertReservationPurposeMatchesOperation(reservation.purpose, input.operationType);

        if (reservation.consumedAt) {
          if (!reservation.consumingTransactionId) {
            throw new Error("Consumed Reservation is missing its financial transaction");
          }
          return assertReplayableConsumption(
            tx,
            input,
            reservation.consumingTransactionId,
          );
        }
        if (reservation.releasedAt) {
          throw new Error("Released Reservation cannot be consumed");
        }
        if (reservation.currency !== input.currency) {
          throw new Error("Reservation consumption currency must match the Reservation currency");
        }

        const existingTransaction = await tx.financialTransaction.findUnique({
          where: {
            idempotencyScope_idempotencyKey: {
              idempotencyScope: input.idempotency.scope,
              idempotencyKey: input.idempotency.key,
            },
          },
          select: { id: true, fingerprint: true },
        });
        if (existingTransaction) {
          throw new Error(
            existingTransaction.fingerprint === input.idempotency.fingerprint
              ? "Financial transaction idempotency identity is already bound to another effect"
              : "Financial transaction idempotency conflict",
          );
        }

        const sourceAccountIds = reservation.allocations.map((allocation) => allocation.accountId);
        const destinationAccountIds = input.destinations.map((destination) => destination.accountId);
        const accountIds = uniqueSorted([...sourceAccountIds, ...destinationAccountIds]);
        await lockAccounts(tx, accountIds);

        const accounts = await tx.ledgerAccount.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, kind: true, memberId: true, currency: true },
        });
        if (accounts.length !== accountIds.length) {
          throw new Error("Reservation consumption references an unknown Ledger account");
        }

        const accountById = new Map(accounts.map((account) => [account.id, account]));
        let allocatedMinor = 0n;
        for (const allocation of reservation.allocations) {
          const account = accountById.get(allocation.accountId);
          if (!account || account.kind !== "MEMBER" || account.memberId !== reservation.memberId) {
            throw new Error("Reservation source allocation must remain on the owning Member Ledger account");
          }
          if (account.currency !== input.currency) {
            throw new Error("Reservation source allocation currency mismatch");
          }
          if (allocation.amountMinor <= 0n) {
            throw new Error("Reservation source allocation must be positive integer minor units");
          }
          allocatedMinor += allocation.amountMinor;
        }
        if (allocatedMinor !== reservation.amountMinor) {
          throw new Error("Reservation source allocations must equal the Reservation amount");
        }

        for (const destination of input.destinations) {
          const account = accountById.get(destination.accountId);
          if (!account || account.kind !== "SYSTEM") {
            throw new Error("Reservation consumption destination must be a system/counterparty Ledger account");
          }
          if (account.currency !== input.currency) {
            throw new Error("Reservation consumption destination currency mismatch");
          }
        }

        const postings = [
          ...reservation.allocations.map((allocation) => ({
            accountId: allocation.accountId,
            side: "DEBIT" as const,
            amountMinor: allocation.amountMinor,
          })),
          ...input.destinations.map((destination) => ({
            accountId: destination.accountId,
            side: "CREDIT" as const,
            amountMinor: destination.amountMinor,
          })),
        ];
        assertBalancedLedgerPostings(
          postings.map((posting) => ({
            side: posting.side,
            amountMinor: posting.amountMinor,
            currency: input.currency,
          })),
        );
        const accountingPeriod = await resolveAuthoritativeAccountingPeriodForPosting(
          tx,
          this.accountingPeriodClock,
        );

        const created = await tx.financialTransaction.create({
          data: {
            businessTransactionId: input.businessTransactionId,
            operationType: input.operationType,
            correlationId: input.correlationId,
            idempotencyScope: input.idempotency.scope,
            idempotencyKey: input.idempotency.key,
            fingerprint: input.idempotency.fingerprint,
            domainReferences: { ...input.domainReferences, reservationId: input.reservationId },
            currency: input.currency,
            effectiveAt: input.effectiveAt,
            postedAt: accountingPeriod.postedAt,
            accountingPeriodId: accountingPeriod.id,
            postings: {
              create: postings,
            },
          },
          select: { id: true },
        });

        await tx.reservation.update({
          where: { id: input.reservationId },
          data: {
            consumedAt: new Date(),
            consumingTransactionId: created.id,
          },
        });
        return created.id;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const reservation = await this.prisma.reservation.findUnique({
        where: { id: input.reservationId },
        select: { consumingTransactionId: true },
      });
      if (reservation?.consumingTransactionId) {
        return assertReplayableConsumption(
          this.prisma,
          input,
          reservation.consumingTransactionId,
        );
      }
      throw new Error("Financial transaction idempotency conflict");
    }
  }

  async getAvailableMinorUnits(accountId: string): Promise<bigint> {
    return this.prisma.$transaction(
      async (tx) => {
        const account = await tx.ledgerAccount.findUnique({
          where: { id: accountId },
          select: { kind: true, bucket: true, memberId: true, currency: true },
        });
        if (!account || account.kind !== "MEMBER" || !account.memberId) {
          throw new Error("Wallet availability requires a Member Ledger account");
        }
        if (account.bucket === "LOCKED") return 0n;

        const cashAccount = await tx.ledgerAccount.findFirst({
          where: {
            kind: "MEMBER",
            memberId: account.memberId,
            bucket: "CASH",
            currency: account.currency,
          },
          select: { id: true },
        });
        if (
          cashAccount &&
          isDebtRecoveryRestricted(await getAccountPostedMinor(tx, cashAccount.id))
        ) {
          return 0n;
        }

        const availability = await getAccountAvailability(tx, accountId);
        const availableMinor = calculateAvailableMinorUnits(
          availability.postedMinor,
          availability.activeReservationAmountsMinor,
        );
        return availableMinor > 0n ? availableMinor : 0n;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getWalletProjection(memberId: string, currency: "THB"): Promise<WalletProjection> {
    return this.prisma.$transaction(
      async (tx) => {
        const clocks = await tx.$queryRaw<Array<{ dataAsOf: Date }>>(
          Prisma.sql`SELECT transaction_timestamp() AS "dataAsOf"`,
        );
        const dataAsOf = clocks[0]?.dataAsOf;
        if (!dataAsOf) {
          throw new Error("Wallet projection dataAsOf is unavailable");
        }
        const accounts = await tx.ledgerAccount.findMany({
          where: { kind: "MEMBER", memberId, currency },
          select: { id: true, bucket: true },
        });
        const accountByBucket = new Map(accounts.map((account) => [account.bucket, account.id]));

        const buckets = await Promise.all(
          MEMBER_LEDGER_BUCKETS.map(async (bucket) => {
            const accountId = accountByBucket.get(bucket);
            if (!accountId) {
              return { bucket, postedMinor: 0n, reservedMinor: 0n, availableMinor: 0n };
            }

            const availability = await getAccountAvailability(tx, accountId);
            const reservedMinor = availability.activeReservationAmountsMinor.reduce(
              (total, amountMinor) => total + amountMinor,
              0n,
            );
            const derivedAvailableMinor = calculateAvailableMinorUnits(
              availability.postedMinor,
              availability.activeReservationAmountsMinor,
            );
            return {
              bucket,
              postedMinor: availability.postedMinor,
              reservedMinor,
              availableMinor:
                bucket === "LOCKED" || derivedAvailableMinor < 0n ? 0n : derivedAvailableMinor,
            };
          }),
        );

        const postedCashMinor =
          buckets.find((bucket) => bucket.bucket === "CASH")?.postedMinor ?? 0n;
        const projectedBuckets = isDebtRecoveryRestricted(postedCashMinor)
          ? buckets.map((bucket) => ({ ...bucket, availableMinor: 0n }))
          : buckets;

        return { memberId, currency, dataAsOf, buckets: projectedBuckets };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
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

function validateReservationConsumptionInput(input: ConsumeReservationAndPostInput): void {
  if (input.destinations.length === 0) {
    throw new Error("Reservation consumption requires at least one destination posting");
  }

  const accountIds = input.destinations.map((destination) => destination.accountId);
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error("Reservation consumption destinations must use unique Ledger accounts");
  }

  for (const destination of input.destinations) {
    if (destination.amountMinor <= 0n) {
      throw new Error("Reservation consumption destination must be positive integer minor units");
    }
  }
}

async function assertReplayableConsumption(
  tx: Pick<TransactionClient, "financialTransaction">,
  input: ConsumeReservationAndPostInput,
  consumingTransactionId: string,
): Promise<string> {
  const transaction = await tx.financialTransaction.findUnique({
    where: { id: consumingTransactionId },
    select: {
      id: true,
      idempotencyScope: true,
      idempotencyKey: true,
      fingerprint: true,
      consumedReservations: {
        where: { id: input.reservationId },
        select: { id: true },
      },
    },
  });
  if (!transaction || transaction.consumedReservations.length !== 1) {
    throw new Error("Consumed Reservation financial transaction linkage is invalid");
  }
  if (
    transaction.idempotencyScope === input.idempotency.scope &&
    transaction.idempotencyKey === input.idempotency.key &&
    transaction.fingerprint === input.idempotency.fingerprint
  ) {
    return transaction.id;
  }
  if (
    transaction.idempotencyScope === input.idempotency.scope &&
    transaction.idempotencyKey === input.idempotency.key
  ) {
    throw new Error("Financial transaction idempotency conflict");
  }
  throw new Error("Reservation already consumed by another financial transaction");
}

type PostingAccount = {
  id: string;
  kind: string;
  memberId: string | null;
  bucket: string | null;
  currency: string;
};

async function assertPostingAccounts(
  tx: TransactionClient,
  accountIds: readonly string[],
  currency: "THB",
): Promise<PostingAccount[]> {
  const accounts = await tx.ledgerAccount.findMany({
    where: { id: { in: [...accountIds] } },
    select: { id: true, kind: true, memberId: true, bucket: true, currency: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new Error("Financial transaction references an unknown Ledger account");
  }
  if (accounts.some((account) => account.currency !== currency)) {
    throw new Error("Financial transaction must post within one currency");
  }
  return accounts;
}

function assertOperationPostingSemantics(
  input: PostFinancialTransactionInput,
  accounts: readonly PostingAccount[],
): void {
  if (input.operationType !== "DEPOSIT_CREDIT") return;

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const memberPostings = input.postings.filter(
    (posting) => accountById.get(posting.accountId)?.kind === "MEMBER",
  );
  if (
    memberPostings.some(
      (posting) => accountById.get(posting.accountId)?.bucket !== "CASH",
    )
  ) {
    throw new Error("DEPOSIT_CREDIT may post Member value only to CASH");
  }

  if (!memberPostings.some((posting) => posting.side === "CREDIT")) {
    throw new Error("DEPOSIT_CREDIT must include a Member CASH credit");
  }
}

function assertReservationPurposeMatchesOperation(
  purpose: string,
  operationType: string,
): void {
  if (operationType === "BET_STAKE_COMMIT" && purpose !== "BET") {
    throw new Error("BET_STAKE_COMMIT requires a BET Reservation");
  }
  if (operationType === "WITHDRAWAL_FINALIZE" && purpose !== "WITHDRAWAL") {
    throw new Error("WITHDRAWAL_FINALIZE requires a WITHDRAWAL Reservation");
  }
}

async function assertCompensationTarget(
  tx: Pick<TransactionClient, "financialTransaction">,
  transactionId: string,
  currency: "THB",
): Promise<void> {
  const target = await tx.financialTransaction.findUnique({
    where: { id: transactionId },
    select: { currency: true },
  });
  if (!target) throw new Error("Financial compensation target not found");
  if (target.currency !== currency) {
    throw new Error("Financial compensation must use the corrected transaction currency");
  }
}

function correctionIdentityMatches(
  existing: { correctionKind: string | null; correctsTransactionId: string | null },
  correction: PostFinancialTransactionInput["correction"],
): boolean {
  if (!correction) {
    return existing.correctionKind === null && existing.correctsTransactionId === null;
  }
  return (
    existing.correctionKind === correction.kind &&
    existing.correctsTransactionId === correction.correctsTransactionId
  );
}

async function findReplayableFinancialPost(
  tx: Pick<TransactionClient, "financialTransaction">,
  input: PostFinancialTransactionInput,
): Promise<string | null> {
  const existing = await tx.financialTransaction.findUnique({
    where: {
      idempotencyScope_idempotencyKey: {
        idempotencyScope: input.idempotency.scope,
        idempotencyKey: input.idempotency.key,
      },
    },
    select: {
      id: true,
      fingerprint: true,
      correctionKind: true,
      correctsTransactionId: true,
    },
  });
  if (!existing) return null;
  if (
    existing.fingerprint === input.idempotency.fingerprint &&
    correctionIdentityMatches(existing, input.correction)
  ) {
    return existing.id;
  }
  throw new Error("Financial transaction idempotency conflict");
}

async function resolveAuthoritativeAccountingPeriodForPosting(
  tx: TransactionClient,
  clock: AccountingPeriodTransactionClock,
): Promise<{ id: string; postedAt: Date }> {
  const postedAt = await clock.now(tx);
  const coverage = await ensureAutomaticAccountingPeriodCoverage(tx, postedAt);
  return { id: coverage.current.id, postedAt };
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

  const postedMinor = calculatePostedMinor(postings);
  return {
    postedMinor,
    activeReservationAmountsMinor: activeAllocations.map((allocation) => allocation.amountMinor),
  };
}

async function getAccountPostedMinor(
  tx: Pick<TransactionClient, "ledgerPosting">,
  accountId: string,
): Promise<bigint> {
  const postings = await tx.ledgerPosting.findMany({
    where: { accountId },
    select: { side: true, amountMinor: true },
  });
  return calculatePostedMinor(postings);
}

function calculatePostedMinor(
  postings: readonly { side: string; amountMinor: bigint }[],
): bigint {
  return postings.reduce(
    (balance, posting) =>
      posting.side === "CREDIT" ? balance + posting.amountMinor : balance - posting.amountMinor,
    0n,
  );
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

async function lockFinancialTransaction(
  tx: TransactionClient,
  transactionId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "financial_transactions" WHERE "id" = ${transactionId}::uuid FOR UPDATE`,
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

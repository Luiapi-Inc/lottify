import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type {
  CreateDepositInput,
  DepositRepository,
  ResolveDepositInput,
} from "../domain/deposit.repository";
import type { Deposit, DepositStatus } from "../domain/deposit";

@Injectable()
export class PrismaDepositRepository implements DepositRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateDepositInput): Promise<Deposit | null> {
    try {
      const row = await this.prisma.paymentDeposit.create({
        data: {
          id: input.id,
          memberId: input.memberId,
          providerId: input.providerId,
          providerCode: input.providerCode,
          methodCode: input.methodCode,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: "INITIATED",
          idempotencyScope: input.idempotencyScope,
          idempotencyKey: input.idempotencyKey,
          fingerprint: input.fingerprint,
          providerReferenceKey: input.providerReferenceKey,
          correlationId: input.correlationId,
        },
      });
      return mapRow(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  findById(id: string): Promise<Deposit | null> {
    return this.prisma.paymentDeposit
      .findUnique({ where: { id } })
      .then((row) => (row ? mapRow(row) : null));
  }

  async findByIdempotency(scope: string, key: string): Promise<Deposit | null> {
    const row = await this.prisma.paymentDeposit.findUnique({
      where: { idempotencyScope_idempotencyKey: { idempotencyScope: scope, idempotencyKey: key } },
    });
    return row ? mapRow(row) : null;
  }

  async resolve(id: string, input: ResolveDepositInput): Promise<Deposit> {
    const row = await this.prisma.paymentDeposit.update({
      where: { id },
      data: {
        status: input.status as string,
        providerTransactionId: input.providerTransactionId ?? null,
        incomingProviderError: input.incomingProviderError ?? null,
      },
    });
    return mapRow(row);
  }

  async markCredited(id: string, ledgerTransactionId: string): Promise<Deposit> {
    const row = await this.prisma.paymentDeposit.update({
      where: { id },
      data: { ledgerTransactionId },
    });
    return mapRow(row);
  }
}

type PaymentDepositRow = import("@prisma/client").PaymentDeposit;

function mapRow(row: PaymentDepositRow): Deposit {
  if (!row) throw new Error("Payment Deposit row is missing");
  return {
    id: row.id,
    memberId: row.memberId,
    providerId: row.providerId,
    providerCode: row.providerCode,
    methodCode: row.methodCode,
    amountMinor: BigInt(row.amountMinor),
    currency: row.currency as Deposit["currency"],
    status: row.status as DepositStatus,
    idempotencyScope: row.idempotencyScope,
    idempotencyKey: row.idempotencyKey,
    fingerprint: row.fingerprint,
    providerReferenceKey: row.providerReferenceKey,
    providerTransactionId: row.providerTransactionId,
    requestAttemptId: row.requestAttemptId,
    correlationId: row.correlationId,
    ledgerTransactionId: row.ledgerTransactionId,
    incomingProviderError: row.incomingProviderError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
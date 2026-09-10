import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type {
  CreatePayoutDestinationInput,
  PayoutDestinationRepository,
  ResolvePayoutDestinationVerificationInput,
} from "../domain/payout-destination.repository";
import type {
  PayoutDestination,
  PayoutDestinationStatus,
  PayoutDestinationType,
} from "../domain/payout-destination";

@Injectable()
export class PrismaPayoutDestinationRepository implements PayoutDestinationRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreatePayoutDestinationInput): Promise<PayoutDestination | null> {
    try {
      const row = await this.prisma.payoutDestination.create({
        data: {
          id: input.id,
          memberId: input.memberId,
          type: input.type,
          bankCode: input.bankCode,
          accountNumberMasked: input.accountNumberMasked,
          accountDigest: input.accountDigest,
          accountHolderName: input.accountHolderName,
          currency: input.currency,
          status: "PENDING",
        },
      });
      return mapRow(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  findById(id: string): Promise<PayoutDestination | null> {
    return this.prisma.payoutDestination
      .findUnique({ where: { id } })
      .then((row) => (row ? mapRow(row) : null));
  }

  async findByAccountDigest(accountDigest: string): Promise<readonly PayoutDestination[]> {
    const rows = await this.prisma.payoutDestination.findMany({ where: { accountDigest } });
    return rows.map(mapRow);
  }

  async listByMember(memberId: string): Promise<readonly PayoutDestination[]> {
    const rows = await this.prisma.payoutDestination.findMany({
      where: { memberId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(mapRow);
  }

  async resolveVerification(
    id: string,
    input: ResolvePayoutDestinationVerificationInput,
  ): Promise<PayoutDestination | null> {
    const updated = await this.prisma.payoutDestination.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        status: input.status,
        verificationEvidenceRef: input.verificationEvidenceRef,
        verifiedAt: input.verifiedAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    const row = await this.prisma.payoutDestination.findUnique({ where: { id } });
    return row ? mapRow(row) : null;
  }
}

type PayoutDestinationRow = import("@prisma/client").PayoutDestination;

function mapRow(row: PayoutDestinationRow): PayoutDestination {
  return {
    id: row.id,
    memberId: row.memberId,
    type: row.type as PayoutDestinationType,
    bankCode: row.bankCode,
    accountNumberMasked: row.accountNumberMasked,
    accountDigest: row.accountDigest,
    accountHolderName: row.accountHolderName,
    currency: row.currency as PayoutDestination["currency"],
    status: row.status as PayoutDestinationStatus,
    verificationEvidenceRef: row.verificationEvidenceRef,
    verifiedAt: row.verifiedAt,
    disabledAt: row.disabledAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

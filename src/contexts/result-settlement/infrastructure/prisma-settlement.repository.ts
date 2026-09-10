// Prisma/PostgreSQL infrastructure for the Result & Settlement context.
//
// Persists Result revisions (immutable chain), Settlement Batches (durable
// execution unit) and Settlement Orders (per-Order checkpoint that makes a
// crashed batch resumable without re-posting a payout).

import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  RESULT_REVISION_STATES,
  type ResultRevisionState,
} from "../domain/result-revision";
import { SETTLEMENT_BATCH_STATES, type SettlementBatchState } from "../domain/settlement-batch";
import {
  SETTLEMENT_REPOSITORY,
  type CreateResultRevisionInput,
  type CreateSettlementBatchInput,
  type ResultRevisionRecord,
  type SettlementBatchRecord,
  type SettlementOrderRecord,
  type SettlementRepository,
  type UpsertSettlementOrderInput,
} from "../application/settlement.repository";

type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaSettlementRepository implements SettlementRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Result revisions
  // ---------------------------------------------------------------------

  async createResultRevision(
    input: CreateResultRevisionInput,
  ): Promise<ResultRevisionRecord> {
    const row = await this.prisma.resultRevision.create({
      data: {
        id: input.id,
        drawId: input.drawId,
        revision: input.revision,
        state: input.state,
        resultSchemaVersionRef: input.resultSchemaVersionRef,
        resultSourceRef: input.resultSourceRef,
        resultData: input.resultData as Prisma.InputJsonValue,
        winningNumbers: input.winningNumbers as Prisma.InputJsonValue,
        supersedesRevisionId: input.supersedesRevisionId,
        correlationId: input.correlationId,
      },
    });
    return toResultRevisionRecord(row);
  }

  async updateResultRevisionState(
    revisionId: string,
    state: ResultRevisionState,
    extra: { confirmedAt?: Date; confirmedByAdminId?: string | null } = {},
  ): Promise<ResultRevisionRecord> {
    const row = await this.prisma.resultRevision.update({
      where: { id: revisionId },
      data: {
        state,
        ...(extra.confirmedAt !== undefined ? { confirmedAt: extra.confirmedAt } : {}),
        ...(extra.confirmedByAdminId !== undefined
          ? { confirmedByAdminId: extra.confirmedByAdminId }
          : {}),
      },
    });
    return toResultRevisionRecord(row);
  }

  async findLatestRevision(drawId: string): Promise<ResultRevisionRecord | null> {
    const row = await this.prisma.resultRevision.findFirst({
      where: { drawId },
      orderBy: { revision: "desc" },
    });
    return row ? toResultRevisionRecord(row) : null;
  }

  async findRevision(
    drawId: string,
    revision: number,
  ): Promise<ResultRevisionRecord | null> {
    const row = await this.prisma.resultRevision.findUnique({
      where: { drawId_revision: { drawId, revision } },
    });
    return row ? toResultRevisionRecord(row) : null;
  }

  async findActiveConfirmedRevision(
    drawId: string,
  ): Promise<ResultRevisionRecord | null> {
    const row = await this.prisma.resultRevision.findFirst({
      where: {
        drawId,
        state: "CONFIRMED",
        supersededBy: null,
      },
    });
    return row ? toResultRevisionRecord(row) : null;
  }

  async findMaxRevisionNumber(drawId: string): Promise<number> {
    const aggregate = await this.prisma.resultRevision.aggregate({
      where: { drawId },
      _max: { revision: true },
    });
    return aggregate._max.revision ?? 0;
  }

  // ---------------------------------------------------------------------
  // Settlement batches
  // ---------------------------------------------------------------------

  async createSettlementBatch(
    input: CreateSettlementBatchInput,
  ): Promise<SettlementBatchRecord> {
    const row = await this.prisma.settlementBatch.create({
      data: {
        id: input.id,
        drawId: input.drawId,
        resultRevisionId: input.resultRevisionId,
        state: "PENDING",
        version: 1,
        correlationId: input.correlationId,
        idempotencyScope: input.idempotencyScope,
        idempotencyKey: input.idempotencyKey,
        fingerprint: input.fingerprint,
      },
    });
    return toSettlementBatchRecord(row);
  }

  async findSettlementBatchByCorrelation(
    scope: string,
    key: string,
  ): Promise<SettlementBatchRecord | null> {
    const row = await this.prisma.settlementBatch.findUnique({
      where: { idempotencyScope_idempotencyKey: { idempotencyScope: scope, idempotencyKey: key } },
    });
    return row ? toSettlementBatchRecord(row) : null;
  }

  async findBatchById(batchId: string): Promise<SettlementBatchRecord | null> {
    const row = await this.prisma.settlementBatch.findUnique({
      where: { id: batchId },
    });
    return row ? toSettlementBatchRecord(row) : null;
  }

  async findActiveBatch(drawId: string): Promise<SettlementBatchRecord | null> {
    const row = await this.prisma.settlementBatch.findFirst({
      where: { drawId, state: { in: ["PENDING", "CALCULATING", "POSTING", "COMMITTING", "COMPLETED"] } },
      orderBy: { createdAt: "desc" },
    });
    return row ? toSettlementBatchRecord(row) : null;
  }

  async updateBatchState(
    batchId: string,
    state: SettlementBatchState,
    extra: {
      totalPayoutMinor?: bigint;
      winningOrderCount?: number;
      losingOrderCount?: number;
      completedAt?: Date | null;
    } = {},
  ): Promise<SettlementBatchRecord> {
    const row = await this.prisma.settlementBatch.update({
      where: { id: batchId },
      data: {
        state,
        version: { increment: 1 },
        ...(extra.totalPayoutMinor !== undefined
          ? { totalPayoutMinor: extra.totalPayoutMinor }
          : {}),
        ...(extra.winningOrderCount !== undefined
          ? { winningOrderCount: extra.winningOrderCount }
          : {}),
        ...(extra.losingOrderCount !== undefined
          ? { losingOrderCount: extra.losingOrderCount }
          : {}),
        ...(extra.completedAt !== undefined ? { completedAt: extra.completedAt } : {}),
      },
    });
    return toSettlementBatchRecord(row);
  }

  // ---------------------------------------------------------------------
  // Settlement orders
  // ---------------------------------------------------------------------

  async listBatchOrders(batchId: string): Promise<readonly SettlementOrderRecord[]> {
    const rows = await this.prisma.settlementOrder.findMany({
      where: { batchId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toSettlementOrderRecord);
  }

  async listPostedOrderIds(batchId: string): Promise<readonly string[]> {
    const rows = await this.prisma.settlementOrder.findMany({
      where: { batchId, status: "POSTED" },
      select: { orderId: true },
    });
    return rows.map((row) => row.orderId);
  }

  async findSettlementOrderByOrderId(
    orderId: string,
  ): Promise<SettlementOrderRecord | null> {
    const row = await this.prisma.settlementOrder.findUnique({
      where: { orderId },
    });
    return row ? toSettlementOrderRecord(row) : null;
  }

  async upsertSettlementOrder(
    batchId: string,
    input: UpsertSettlementOrderInput,
  ): Promise<void> {
    await this.prisma.settlementOrder.upsert({
      where: { orderId: input.orderId },
      create: {
        id: input.orderId,
        batchId,
        orderId: input.orderId,
        memberId: input.memberId,
        outcome: input.outcome,
        stakeMinor: input.stakeMinor,
        payoutMinor: input.payoutMinor,
        status: input.status,
        payoutTransactionId: input.payoutTransactionId,
      },
      update: {
        batchId,
        memberId: input.memberId,
        outcome: input.outcome,
        stakeMinor: input.stakeMinor,
        payoutMinor: input.payoutMinor,
        status: input.status,
        payoutTransactionId: input.payoutTransactionId,
      },
    });
  }
}

function toResultRevisionRecord(
  row: {
    id: string;
    drawId: string;
    revision: number;
    state: string;
    resultSchemaVersionRef: string;
    resultSourceRef: string | null;
    resultData: Prisma.JsonValue;
    winningNumbers: Prisma.JsonValue;
    supersedesRevisionId: string | null;
    correlationId: string;
    confirmedAt: Date | null;
    confirmedByAdminId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
): ResultRevisionRecord {
  if (!RESULT_REVISION_STATES.includes(row.state as ResultRevisionState)) {
    throw new Error(`Result revision is in an unknown state ${row.state}`);
  }
  return {
    id: row.id,
    drawId: row.drawId,
    revision: row.revision,
    state: row.state as ResultRevisionState,
    resultSchemaVersionRef: row.resultSchemaVersionRef,
    resultSourceRef: row.resultSourceRef,
    resultData: (row.resultData ?? {}) as Readonly<Record<string, unknown>>,
    winningNumbers: (row.winningNumbers ?? {}) as Readonly<Record<string, string>>,
    supersedesRevisionId: row.supersedesRevisionId,
    correlationId: row.correlationId,
    confirmedAt: row.confirmedAt ? new Date(row.confirmedAt.getTime()) : null,
    confirmedByAdminId: row.confirmedByAdminId,
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
  };
}

function toSettlementBatchRecord(
  row: {
    id: string;
    drawId: string;
    resultRevisionId: string;
    state: string;
    version: number;
    correlationId: string;
    totalStakeMinor: bigint;
    totalPayoutMinor: bigint;
    winningOrderCount: number;
    losingOrderCount: number;
    idempotencyScope: string;
    idempotencyKey: string;
    fingerprint: string;
    startedAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
): SettlementBatchRecord {
  if (!SETTLEMENT_BATCH_STATES.includes(row.state as SettlementBatchState)) {
    throw new Error(`Settlement Batch is in an unknown state ${row.state}`);
  }
  return {
    id: row.id,
    drawId: row.drawId,
    resultRevisionId: row.resultRevisionId,
    state: row.state as SettlementBatchState,
    version: row.version,
    correlationId: row.correlationId,
    totalStakeMinor: row.totalStakeMinor,
    totalPayoutMinor: row.totalPayoutMinor,
    winningOrderCount: row.winningOrderCount,
    losingOrderCount: row.losingOrderCount,
    idempotencyScope: row.idempotencyScope,
    idempotencyKey: row.idempotencyKey,
    fingerprint: row.fingerprint,
    startedAt: new Date(row.startedAt.getTime()),
    completedAt: row.completedAt ? new Date(row.completedAt.getTime()) : null,
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
  };
}

function toSettlementOrderRecord(
  row: {
    id: string;
    batchId: string;
    orderId: string;
    memberId: string;
    outcome: string;
    stakeMinor: bigint;
    payoutMinor: bigint;
    status: string;
    payoutTransactionId: string | null;
    createdAt: Date;
  },
): SettlementOrderRecord {
  return {
    id: row.id,
    batchId: row.batchId,
    orderId: row.orderId,
    memberId: row.memberId,
    outcome: row.outcome as "WIN" | "LOSE",
    stakeMinor: row.stakeMinor,
    payoutMinor: row.payoutMinor,
    status: row.status as "EVALUATED" | "POSTED",
    payoutTransactionId: row.payoutTransactionId,
    createdAt: new Date(row.createdAt.getTime()),
  };
}

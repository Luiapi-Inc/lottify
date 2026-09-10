// Result & Settlement persistence port. The application service persists
// Result revisions and Settlement Batches/Orders through this repository; the
// infrastructure implements it with Prisma/PostgreSQL. Settlement Order rows
// are the durable per-Order checkpoints that make a crashed batch resumable
// without duplicating a payout.

import type { ResultRevisionState } from "../domain/result-revision";
import type { SettlementBatchState } from "../domain/settlement-batch";

export const SETTLEMENT_REPOSITORY = Symbol("SETTLEMENT_REPOSITORY");

export interface CreateResultRevisionInput {
  readonly id: string;
  readonly drawId: string;
  readonly revision: number;
  readonly state: ResultRevisionState;
  readonly resultSchemaVersionRef: string;
  readonly resultSourceRef: string | null;
  readonly resultData: Readonly<Record<string, unknown>>;
  readonly winningNumbers: Readonly<Record<string, string>>;
  readonly supersedesRevisionId: string | null;
  readonly correlationId: string;
}

export interface ResultRevisionRecord {
  readonly id: string;
  readonly drawId: string;
  readonly revision: number;
  readonly state: ResultRevisionState;
  readonly resultSchemaVersionRef: string;
  readonly resultSourceRef: string | null;
  readonly resultData: Readonly<Record<string, unknown>>;
  readonly winningNumbers: Readonly<Record<string, string>>;
  readonly supersedesRevisionId: string | null;
  readonly correlationId: string;
  readonly confirmedAt: Date | null;
  readonly confirmedByAdminId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateSettlementBatchInput {
  readonly id: string;
  readonly drawId: string;
  readonly resultRevisionId: string;
  readonly correlationId: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
}

export interface SettlementOrderRecord {
  readonly id: string;
  readonly batchId: string;
  readonly orderId: string;
  readonly memberId: string;
  readonly outcome: "WIN" | "LOSE";
  readonly stakeMinor: bigint;
  readonly payoutMinor: bigint;
  readonly status: "EVALUATED" | "POSTED";
  readonly payoutTransactionId: string | null;
  readonly createdAt: Date;
}

export interface SettlementBatchRecord {
  readonly id: string;
  readonly drawId: string;
  readonly resultRevisionId: string;
  readonly state: SettlementBatchState;
  readonly version: number;
  readonly correlationId: string;
  readonly totalStakeMinor: bigint;
  readonly totalPayoutMinor: bigint;
  readonly winningOrderCount: number;
  readonly losingOrderCount: number;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UpsertSettlementOrderInput {
  readonly orderId: string;
  readonly memberId: string;
  readonly outcome: "WIN" | "LOSE";
  readonly stakeMinor: bigint;
  readonly payoutMinor: bigint;
  readonly status: "EVALUATED" | "POSTED";
  readonly payoutTransactionId: string | null;
}

export interface SettlementRepository {
  // Result revisions
  createResultRevision(input: CreateResultRevisionInput): Promise<ResultRevisionRecord>;
  updateResultRevisionState(
    revisionId: string,
    state: ResultRevisionState,
    extra?: { confirmedAt?: Date; confirmedByAdminId?: string | null },
  ): Promise<ResultRevisionRecord>;
  findLatestRevision(drawId: string): Promise<ResultRevisionRecord | null>;
  findRevision(drawId: string, revision: number): Promise<ResultRevisionRecord | null>;
  findActiveConfirmedRevision(drawId: string): Promise<ResultRevisionRecord | null>;
  findMaxRevisionNumber(drawId: string): Promise<number>;

  // Settlement batches
  createSettlementBatch(input: CreateSettlementBatchInput): Promise<SettlementBatchRecord>;
  findSettlementBatchByCorrelation(
    scope: string,
    key: string,
  ): Promise<SettlementBatchRecord | null>;
  findBatchById(batchId: string): Promise<SettlementBatchRecord | null>;
  findActiveBatch(drawId: string): Promise<SettlementBatchRecord | null>;
  updateBatchState(
    batchId: string,
    state: SettlementBatchState,
    extra?: {
      totalPayoutMinor?: bigint;
      winningOrderCount?: number;
      losingOrderCount?: number;
      completedAt?: Date | null;
    },
  ): Promise<SettlementBatchRecord>;

  // Settlement orders (durable per-Order checkpoint)
  listBatchOrders(batchId: string): Promise<readonly SettlementOrderRecord[]>;
  listPostedOrderIds(batchId: string): Promise<readonly string[]>;
  findSettlementOrderByOrderId(
    orderId: string,
  ): Promise<SettlementOrderRecord | null>;
  upsertSettlementOrder(batchId: string, input: UpsertSettlementOrderInput): Promise<void>;
}

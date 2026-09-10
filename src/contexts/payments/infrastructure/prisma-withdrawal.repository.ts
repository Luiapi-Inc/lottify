import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type {
  CreateWithdrawalInput,
  WithdrawalCursor,
  WithdrawalEventRecord,
  WithdrawalListPage,
  WithdrawalListQuery,
  WithdrawalRepository,
  WithdrawalTransitionInput,
} from "../domain/withdrawal.repository";
import type { WithdrawalRecord } from "../domain/withdrawal.repository";
import {
  withdrawalQueueFilter,
  type WithdrawalActorType,
  type WithdrawalEligibilityOutcome,
  type WithdrawalState,
} from "../domain/withdrawal";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class PrismaWithdrawalRepository implements WithdrawalRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateWithdrawalInput): Promise<WithdrawalRecord | null> {
    try {
      const row = await this.prisma.paymentWithdrawal.create({
        data: {
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
          eligibilityReasonCodes: [...input.eligibilityReasonCodes] as Prisma.InputJsonValue,
          eligibilityEvidenceRefs: [...input.eligibilityEvidenceRefs] as Prisma.InputJsonValue,
          requiresApproval: input.requiresApproval,
          idempotencyScope: input.idempotencyScope,
          idempotencyKey: input.idempotencyKey,
          fingerprint: input.fingerprint,
          providerId: input.providerId,
          providerReferenceKey: input.providerReferenceKey,
          correlationId: input.correlationId,
          events: {
            create: {
              fromState: null,
              toState: "REQUESTED",
              actorType: "MEMBER",
              actorId: input.memberId,
              correlationId: input.correlationId,
            },
          },
        },
      });
      return mapRow(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  findById(id: string): Promise<WithdrawalRecord | null> {
    return this.prisma.paymentWithdrawal
      .findUnique({ where: { id } })
      .then((row) => (row ? mapRow(row) : null));
  }

  async findByIdempotency(scope: string, key: string): Promise<WithdrawalRecord | null> {
    const row = await this.prisma.paymentWithdrawal.findUnique({
      where: {
        idempotencyScope_idempotencyKey: { idempotencyScope: scope, idempotencyKey: key },
      },
    });
    return row ? mapRow(row) : null;
  }

  /**
   * Exact optimistic guard: the transition only applies when the persisted state
   * and version still match what the caller observed, and the durable workflow
   * event is appended in the same transaction. A lost guard returns `null` so the
   * caller surfaces a conflict instead of silently overwriting another actor.
   */
  async transition(input: WithdrawalTransitionInput): Promise<WithdrawalRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const patch = input.patch ?? {};
      const updated = await tx.paymentWithdrawal.updateMany({
        where: { id: input.id, state: input.from, version: input.expectedVersion },
        data: {
          state: input.to,
          version: { increment: 1 },
          ...(patch.reservationId !== undefined ? { reservationId: patch.reservationId } : {}),
          ...(patch.providerTransactionId !== undefined
            ? { providerTransactionId: patch.providerTransactionId }
            : {}),
          ...(patch.payoutEvidenceRef !== undefined
            ? { payoutEvidenceRef: patch.payoutEvidenceRef }
            : {}),
          ...(patch.ledgerTransactionId !== undefined
            ? { ledgerTransactionId: patch.ledgerTransactionId }
            : {}),
          ...(patch.decidedByAdminId !== undefined
            ? { decidedByAdminId: patch.decidedByAdminId }
            : {}),
          ...(patch.decisionReason !== undefined
            ? { decisionReason: patch.decisionReason }
            : {}),
          ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
          ...(patch.incomingProviderError !== undefined
            ? { incomingProviderError: patch.incomingProviderError }
            : {}),
          ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
          ...(patch.countReconciliationAttempt
            ? { reconciliationAttempts: { increment: 1 } }
            : {}),
        },
      });
      if (updated.count !== 1) return null;

      await tx.paymentWithdrawalEvent.create({
        data: {
          withdrawalId: input.id,
          fromState: input.from,
          toState: input.to,
          actorType: input.event.actorType,
          actorId: input.event.actorId ?? null,
          reason: input.event.reason ?? null,
          evidenceRef: input.event.evidenceRef ?? null,
          correlationId: input.event.correlationId,
        },
      });

      const row = await tx.paymentWithdrawal.findUnique({ where: { id: input.id } });
      return row ? mapRow(row) : null;
    });
  }

  async list(query: WithdrawalListQuery): Promise<WithdrawalListPage> {
    const limit = clampLimit(query.limit);
    const queueFilter = query.queue ? withdrawalQueueFilter(query.queue) : null;
    const states = query.state ? [query.state] : (queueFilter?.states ?? null);
    // `REVIEW` and `APPROVAL` share the REVIEWING state, so the queue filter also
    // constrains the approval flag; an explicit caller filter always wins.
    const requiresApproval =
      query.requiresApproval === undefined
        ? (queueFilter?.requiresApproval ?? null)
        : query.requiresApproval;
    const rows = await this.prisma.paymentWithdrawal.findMany({
      where: {
        ...(query.memberId ? { memberId: query.memberId } : {}),
        ...(states ? { state: { in: [...states] } } : {}),
        ...(requiresApproval === null ? {} : { requiresApproval }),
        ...(query.cursor
          ? {
              OR: [
                { createdAt: { lt: query.cursor.createdAt } },
                { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(mapRow),
      nextCursor:
        rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  async listEvents(withdrawalId: string): Promise<readonly WithdrawalEventRecord[]> {
    const rows = await this.prisma.paymentWithdrawalEvent.findMany({
      where: { withdrawalId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      withdrawalId: row.withdrawalId,
      fromState: (row.fromState as WithdrawalState | null) ?? null,
      toState: row.toState as WithdrawalState,
      actorType: row.actorType as WithdrawalActorType,
      actorId: row.actorId,
      reason: row.reason,
      evidenceRef: row.evidenceRef,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
    }));
  }
}

function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

type PaymentWithdrawalRow = import("@prisma/client").PaymentWithdrawal;

function mapRow(row: PaymentWithdrawalRow): WithdrawalRecord {
  return {
    id: row.id,
    memberId: row.memberId,
    payoutDestinationId: row.payoutDestinationId,
    amountMinor: BigInt(row.amountMinor),
    feeMinor: BigInt(row.feeMinor),
    currency: row.currency as WithdrawalRecord["currency"],
    state: row.state as WithdrawalState,
    version: row.version,
    eligibilityOutcome: row.eligibilityOutcome as WithdrawalEligibilityOutcome,
    eligibilityPolicyVersion: row.eligibilityPolicyVersion,
    eligibilityReasonCodes: jsonStringArray(row.eligibilityReasonCodes),
    eligibilityEvidenceRefs: jsonStringArray(row.eligibilityEvidenceRefs),
    requiresApproval: row.requiresApproval,
    idempotencyScope: row.idempotencyScope,
    idempotencyKey: row.idempotencyKey,
    fingerprint: row.fingerprint,
    reservationId: row.reservationId,
    providerId: row.providerId,
    providerReferenceKey: row.providerReferenceKey,
    providerTransactionId: row.providerTransactionId,
    payoutEvidenceRef: row.payoutEvidenceRef,
    ledgerTransactionId: row.ledgerTransactionId,
    reconciliationAttempts: row.reconciliationAttempts,
    decidedByAdminId: row.decidedByAdminId,
    decisionReason: row.decisionReason,
    failureReason: row.failureReason,
    incomingProviderError: row.incomingProviderError,
    correlationId: row.correlationId,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function jsonStringArray(value: Prisma.JsonValue): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service";

export interface ClaimedOutboxEvent {
  id: string;
  topic: string;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: Prisma.JsonValue;
  correlationId: string | null;
  attempts: number;
  createdAt: Date;
}

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(
    tx: Prisma.TransactionClient,
    event: {
      topic: string;
      aggregateType?: string;
      aggregateId?: string;
      payload: Prisma.InputJsonValue;
      correlationId?: string;
    },
  ): Promise<string> {
    const created = await tx.outboxEvent.create({ data: event, select: { id: true } });
    return created.id;
  }

  async claimBatch(workerId: string, limit: number, lockTtlSeconds: number): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$transaction(async (tx) => {
      return tx.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
        WITH candidates AS (
          SELECT id
          FROM outbox_events
          WHERE published_at IS NULL
            AND (locked_at IS NULL OR locked_at < NOW() - (${lockTtlSeconds} * INTERVAL '1 second'))
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE outbox_events AS o
        SET locked_at = NOW(), lock_owner = ${workerId}, attempts = o.attempts + 1
        FROM candidates AS c
        WHERE o.id = c.id
        RETURNING
          o.id,
          o.topic,
          o.aggregate_type AS "aggregateType",
          o.aggregate_id AS "aggregateId",
          o.payload,
          o.correlation_id AS "correlationId",
          o.attempts,
          o.created_at AS "createdAt"
      `);
    });
  }

  async markPublished(id: string, workerId: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id, lockOwner: workerId, publishedAt: null },
      data: { publishedAt: new Date(), lockedAt: null, lockOwner: null, lastError: null },
    });
  }

  async markFailed(id: string, workerId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.outboxEvent.updateMany({
      where: { id, lockOwner: workerId, publishedAt: null },
      data: { lockedAt: null, lockOwner: null, lastError: message.slice(0, 2_000) },
    });
  }
}

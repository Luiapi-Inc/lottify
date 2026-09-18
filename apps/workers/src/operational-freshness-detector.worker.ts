// Operational freshness detectors for alert families F4 (stuck/reconciling
// Withdrawal) and F6 (queue / DLQ lag) — GH #92 / W5 follow-up.
//
// Families 2-5 and 7 are observed on the request path where the signal occurs
// (see `src/platform/observability/operational-metrics.ts`). F4 and F6 have no
// request-path signal: they are states of durable data (a Withdrawal that is
// still RECONCILING, an Outbox event that is still unpublished, a BullMQ
// dead-letter queue that is filling up). Their detectors therefore run as a
// periodic worker loop that:
//   1. reads the durable state,
//   2. publishes the gauges the committed Prometheus rules evaluate
//      (`lottify_withdrawals_stuck_reconciling`, `lottify_outbox_lag`,
//      `lottify_queue_dlq_lag`), and
//   3. raises the family alert through the OPERATIONAL_ALERT_SINK pipeline when
//      the state crosses its threshold.
//
// The loop reads only; it never mutates financial state.

import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import {
  OUTBOX_LAG_ALERT_THRESHOLD_SECONDS,
  QUEUE_DLQ_LAG_ALERT_THRESHOLD,
  WITHDRAWAL_RECONCILING_SLO_MS,
  recordQueueLag,
  recordWithdrawalsStuckReconciling,
} from "../../../src/platform/observability/operational-metrics";
import { createQueue } from "../../../src/platform/queue/queue.factory";
import { QUEUE_NAMES } from "../../../src/platform/queue/queue-routing";
import { PrismaService } from "../../../src/platform/persistence/prisma.service";

export const OPERATIONAL_FRESHNESS_INTERVAL_MS = 60_000;

/** Withdrawal states that are in-flight towards a durable payout outcome. */
export const RECONCILING_WITHDRAWAL_STATES = ["PAYOUT_PROCESSING", "RECONCILING"] as const;

export const QUEUE_DLQ_READER = Symbol("QUEUE_DLQ_READER");

export interface QueueDlqReader {
  readDlqDepth(): Promise<Record<string, number>>;
}

/**
 * Reads the failed-job depth of every known queue. A failure to talk to Redis
 * is reported as an empty reading rather than a fabricated zero: a missing
 * scrape is a data gap, not an "all clear", and the gauges keep their last
 * observed value in that case.
 */
@Injectable()
export class BullMqQueueDlqReader implements QueueDlqReader {
  private readonly logger = new Logger(BullMqQueueDlqReader.name);

  async readDlqDepth(): Promise<Record<string, number>> {
    const depths: Record<string, number> = {};
    for (const queueName of Object.values(QUEUE_NAMES)) {
      let queue: Queue | undefined;
      try {
        queue = createQueue(queueName);
        const counts = await queue.getJobCounts("failed");
        depths[queueName] = counts.failed ?? 0;
      } catch (error) {
        this.logger.error(
          `Could not read the dead-letter depth of ${queueName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        await queue?.close().catch(() => undefined);
      }
    }
    return depths;
  }
}

@Injectable()
export class OperationalFreshnessDetectorWorker {
  private readonly logger = new Logger(OperationalFreshnessDetectorWorker.name);
  private stopped = false;
  private wake?: () => void;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QUEUE_DLQ_READER) private readonly dlq: QueueDlqReader,
  ) {}

  async run(): Promise<void> {
    while (!this.stopped) {
      const startedAt = Date.now();
      try {
        await this.runCycle(new Date());
      } catch (error) {
        this.logger.error(
          "Operational freshness detection cycle failed",
          error instanceof Error ? error.stack : String(error),
        );
      }
      const elapsed = Date.now() - startedAt;
      await this.waitForNextRun(Math.max(0, OPERATIONAL_FRESHNESS_INTERVAL_MS - elapsed));
    }
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  async runCycle(now: Date): Promise<void> {
    await this.detectStuckWithdrawals(now);
    await this.detectQueueLag(now);
  }

  /** F4 — withdrawals still in-flight beyond the reconciling SLO. */
  async detectStuckWithdrawals(now: Date): Promise<{ count: number; oldestAgeMs: number | null }> {
    const staleBefore = new Date(now.getTime() - WITHDRAWAL_RECONCILING_SLO_MS);
    const stuck = await this.prisma.paymentWithdrawal.findMany({
      where: {
        state: { in: [...RECONCILING_WITHDRAWAL_STATES] },
        updatedAt: { lt: staleBefore },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { state: true, updatedAt: true },
    });

    const oldest = stuck[0];
    const oldestAgeMs = oldest ? now.getTime() - oldest.updatedAt.getTime() : null;
    recordWithdrawalsStuckReconciling({
      count: stuck.length,
      oldestState: oldest?.state ?? null,
      oldestAgeMs,
      occurredAt: now,
    });
    return { count: stuck.length, oldestAgeMs };
  }

  /** F6 — unpublished Outbox lag and per-queue dead-letter depth. */
  async detectQueueLag(now: Date): Promise<{
    outboxLagSeconds: number;
    dlqDepth: Record<string, number>;
  }> {
    const oldestUnpublished = await this.prisma.outboxEvent.findFirst({
      where: { publishedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
    });
    const outboxLagSeconds = oldestUnpublished
      ? Math.max(0, Math.floor((now.getTime() - oldestUnpublished.createdAt.getTime()) / 1_000))
      : 0;

    const dlqDepth = await this.dlq.readDlqDepth();
    recordQueueLag({
      queueDlqDepth: dlqDepth,
      oldestUnpublishedAgeSeconds: outboxLagSeconds,
      occurredAt: now,
    });
    return { outboxLagSeconds, dlqDepth };
  }

  private waitForNextRun(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, delayMs);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }
}

export { OUTBOX_LAG_ALERT_THRESHOLD_SECONDS, QUEUE_DLQ_LAG_ALERT_THRESHOLD };

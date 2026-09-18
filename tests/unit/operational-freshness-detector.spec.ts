import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { register } from "prom-client";
import {
  BullMqQueueDlqReader,
  OperationalFreshnessDetectorWorker,
  RECONCILING_WITHDRAWAL_STATES,
  type QueueDlqReader,
} from "../../apps/workers/src/operational-freshness-detector.worker";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import {
  OUTBOX_LAG_ALERT_THRESHOLD_SECONDS,
  QUEUE_DLQ_LAG_ALERT_THRESHOLD,
  WITHDRAWAL_RECONCILING_SLO_MS,
  resetOperationalMetrics,
} from "../../src/platform/observability/operational-metrics";
import {
  setOperationalAlertSink,
  type OperationalAlert,
  type OperationalAlertSink,
} from "../../src/platform/observability/operational-alert.sink";

class CaptureSink implements OperationalAlertSink {
  readonly alerts: OperationalAlert[] = [];

  emit(alert: OperationalAlert): void {
    this.alerts.push(alert);
  }
}

interface WithdrawalQuery {
  where: {
    state: { in: string[] };
    updatedAt: { lt: Date };
  };
}

class FakePrisma {
  withdrawalRows: Array<{ state: string; updatedAt: Date }> = [];
  oldestUnpublished: { createdAt: Date } | null = null;
  lastWithdrawalQuery: WithdrawalQuery | null = null;

  paymentWithdrawal = {
    findMany: async (query: WithdrawalQuery) => {
      this.lastWithdrawalQuery = query;
      return this.withdrawalRows;
    },
  };

  outboxEvent = {
    findFirst: async () => this.oldestUnpublished,
  };
}

class FakeDlqReader implements QueueDlqReader {
  depths: Record<string, number> = {};
  calls = 0;

  async readDlqDepth(): Promise<Record<string, number>> {
    this.calls += 1;
    return this.depths;
  }
}

const NOW = new Date("2026-09-16T10:00:00.000Z");

let sink: CaptureSink;
let prisma: FakePrisma;
let dlq: FakeDlqReader;
let worker: OperationalFreshnessDetectorWorker;

beforeEach(() => {
  resetOperationalMetrics();
  sink = new CaptureSink();
  setOperationalAlertSink(sink);
  prisma = new FakePrisma();
  dlq = new FakeDlqReader();
  worker = new OperationalFreshnessDetectorWorker(
    prisma as unknown as PrismaService,
    dlq as unknown as QueueDlqReader,
  );
});

afterEach(() => {
  setOperationalAlertSink(undefined);
  resetOperationalMetrics();
});

describe("F4 — stuck withdrawing detector", () => {
  it("queries only in-flight withdrawals older than the SLO and publishes the gauge", async () => {
    prisma.withdrawalRows = [{ state: "RECONCILING", updatedAt: new Date(NOW.getTime() - 45 * 60_000) }];

    const result = await worker.detectStuckWithdrawals(NOW);

    expect(result.count).toBe(1);
    expect(result.oldestAgeMs).toBe(45 * 60_000);
    const query = prisma.lastWithdrawalQuery!;
    expect(query.where.state.in).toEqual([...RECONCILING_WITHDRAWAL_STATES]);
    expect(query.where.updatedAt.lt.getTime()).toBe(NOW.getTime() - WITHDRAWAL_RECONCILING_SLO_MS);

    const exposed = await register.metrics();
    expect(exposed).toContain("lottify_withdrawals_stuck_reconciling 1");
    expect(sink.alerts.map((a) => a.code)).toContain("WITHDRAWAL_STUCK_RECONCILING");
  });

  it("reports zero and does not alert when nothing is stuck", async () => {
    prisma.withdrawalRows = [];

    await worker.detectStuckWithdrawals(NOW);

    expect(sink.alerts).toHaveLength(0);
    const exposed = await register.metrics();
    expect(exposed).toContain("lottify_withdrawals_stuck_reconciling 0");
  });
});

describe("F6 — outbox / DLQ lag detector", () => {
  it("publishes the outbox age and per-queue dead-letter depth", async () => {
    prisma.oldestUnpublished = { createdAt: new Date(NOW.getTime() - 30_000) };
    dlq.depths = { "lottify.settlement": 2 };

    const result = await worker.detectQueueLag(NOW);

    expect(result.outboxLagSeconds).toBe(30);
    expect(result.dlqDepth).toEqual({ "lottify.settlement": 2 });
    const exposed = await register.metrics();
    expect(exposed).toContain("lottify_outbox_lag 30");
    expect(exposed).toContain('lottify_queue_dlq_lag{queue="lottify.settlement"} 2');
    expect(sink.alerts).toHaveLength(0);
  });

  it("alerts when the outbox lags past the threshold and when a DLQ is deep", async () => {
    prisma.oldestUnpublished = {
      createdAt: new Date(NOW.getTime() - (OUTBOX_LAG_ALERT_THRESHOLD_SECONDS + 120) * 1_000),
    };
    dlq.depths = { "lottify.notification": QUEUE_DLQ_LAG_ALERT_THRESHOLD };

    await worker.detectQueueLag(NOW);

    expect(sink.alerts).toHaveLength(1);
    expect(sink.alerts[0]!.code).toBe("QUEUE_DLQ_LAG");
    expect(sink.alerts[0]!.details.deepDlqQueues).toBe("lottify.notification");
  });

  it("runs both family evaluations from one cycle", async () => {
    prisma.withdrawalRows = [{ state: "PAYOUT_PROCESSING", updatedAt: new Date(NOW.getTime() - 60 * 60_000) }];
    prisma.oldestUnpublished = null;

    await worker.runCycle(NOW);

    expect(dlq.calls).toBe(1);
    // No unpublished event means zero lag, not an unknown value.
    expect(sink.alerts.map((a) => a.code)).toEqual(["WITHDRAWAL_STUCK_RECONCILING"]);
  });
});

describe("BullMqQueueDlqReader", () => {
  it("is constructible without dependencies (read is exercised against Redis in the runtime drill)", () => {
    expect(new BullMqQueueDlqReader()).toBeInstanceOf(BullMqQueueDlqReader);
  });
});

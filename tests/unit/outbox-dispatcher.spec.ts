import type { Queue } from "bullmq";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OUTBOX_CORRELATION_ATTRIBUTE,
  OutboxDispatcher,
  outboxDispatchAttributes,
  outboxDispatchLogRecord,
} from "../../apps/workers/src/outbox-dispatcher";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import type { ClaimedOutboxEvent, OutboxService } from "../../src/platform/outbox/outbox.service";
import { QUEUE_NAMES } from "../../src/platform/queue/queue-routing";

interface AddedJob {
  queueName: string;
  jobName: string;
  data: Record<string, unknown>;
  options: Record<string, unknown>;
}

class FakeOutbox {
  events: ClaimedOutboxEvent[] = [];
  readonly published: string[] = [];
  readonly failed: { id: string; error: unknown }[] = [];

  async claimBatch(): Promise<ClaimedOutboxEvent[]> {
    const batch = this.events;
    this.events = [];
    return batch;
  }

  async markPublished(id: string): Promise<void> {
    this.published.push(id);
  }

  async markFailed(id: string, _workerId: string, error: unknown): Promise<void> {
    this.failed.push({ id, error });
  }
}

function claimedEvent(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: "8b0f0e0a-0000-4000-8000-000000000001",
    topic: "withdrawal.reserved",
    aggregateType: "PaymentWithdrawal",
    aggregateId: "1f2e3d4c-0000-4000-8000-000000000002",
    payload: { withdrawalId: "1f2e3d4c-0000-4000-8000-000000000002" },
    correlationId: "W5-E2E-OUTBOX-1",
    attempts: 1,
    createdAt: new Date("2026-09-16T12:00:00.000Z"),
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the dispatcher loop");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("OutboxDispatcher worker hop", () => {
  const original = { ...process.env };
  let added: AddedJob[];
  let failingJobNames: Set<string>;
  let queueFactory: (name: string) => Queue;

  beforeEach(() => {
    Object.assign(process.env, {
      APP_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/lottify",
      REDIS_URL: "redis://localhost:6379",
      JWT_ACCESS_SECRET: "01234567890123456789012345678901",
      OUTBOX_POLL_INTERVAL_MS: "5",
    });
    resetEnvironmentForTests();
    added = [];
    failingJobNames = new Set();
    queueFactory = ((name: string) =>
      ({
        add: async (
          jobName: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          if (failingJobNames.has(jobName)) {
            throw new Error("redis unavailable");
          }
          added.push({ queueName: name, jobName, data, options });
          return { id: jobName };
        },
        close: async () => undefined,
      }) as unknown as Queue) as (name: string) => Queue;
  });

  afterEach(() => {
    process.env = { ...original };
    resetEnvironmentForTests();
  });

  it("binds the correlation id into the worker-side span attributes", () => {
    const attributes = outboxDispatchAttributes(claimedEvent(), QUEUE_NAMES.paymentReconciliation);
    expect(attributes[OUTBOX_CORRELATION_ATTRIBUTE]).toBe("W5-E2E-OUTBOX-1");
    expect(attributes["lottify.outbox.event_id"]).toBe("8b0f0e0a-0000-4000-8000-000000000001");
    expect(attributes["lottify.outbox.topic"]).toBe("withdrawal.reserved");
    expect(attributes["lottify.outbox.aggregate_type"]).toBe("PaymentWithdrawal");
    expect(attributes["messaging.destination.name"]).toBe(QUEUE_NAMES.paymentReconciliation);
    expect(attributes["messaging.system"]).toBe("bullmq");
  });

  it("omits the correlation attribute when the outbox row carries no id", () => {
    const attributes = outboxDispatchAttributes(
      claimedEvent({ correlationId: null }),
      QUEUE_NAMES.paymentReconciliation,
    );
    expect(OUTBOX_CORRELATION_ATTRIBUTE in attributes).toBe(false);
  });

  it("binds the correlation id into the worker log record", () => {
    const record = outboxDispatchLogRecord(
      claimedEvent(),
      QUEUE_NAMES.paymentReconciliation,
    );
    expect(record).toMatchObject({
      msg: "outbox event published to queue",
      correlationId: "W5-E2E-OUTBOX-1",
      eventId: "8b0f0e0a-0000-4000-8000-000000000001",
      topic: "withdrawal.reserved",
      queue: QUEUE_NAMES.paymentReconciliation,
    });
  });

  it("publishes a claimed event to the routed queue with the same correlation id and marks it published", async () => {
    const outbox = new FakeOutbox();
    const event = claimedEvent();
    outbox.events = [event];
    const dispatcher = new OutboxDispatcher(
      outbox as unknown as OutboxService,
      queueFactory,
    );

    const running = dispatcher.run();
    await waitFor(() => outbox.published.length === 1);
    await dispatcher.stop();
    await running;

    expect(added).toHaveLength(1);
    expect(added[0]?.queueName).toBe(QUEUE_NAMES.paymentReconciliation);
    expect(added[0]?.jobName).toBe("withdrawal.reserved");
    expect(added[0]?.data).toMatchObject({
      eventId: event.id,
      topic: "withdrawal.reserved",
      correlationId: "W5-E2E-OUTBOX-1",
      createdAt: "2026-09-16T12:00:00.000Z",
    });
    expect(added[0]?.options).toMatchObject({ jobId: event.id });
    expect(outbox.failed).toEqual([]);
  });

  it("keeps the loop alive and marks only the failing event", async () => {
    const outbox = new FakeOutbox();
    const failing = claimedEvent({ id: "8b0f0e0a-0000-4000-8000-00000000000a" });
    const succeeding = claimedEvent({ id: "8b0f0e0a-0000-4000-8000-00000000000b" });
    outbox.events = [failing, succeeding];
    failingJobNames.add(failing.topic);
    // Only the first attempt of the failing topic is rejected: the second event
    // proves the loop survived the failure.
    let rejectionsLeft = 1;
    queueFactory = ((name: string) =>
      ({
        add: async (
          jobName: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          if (failingJobNames.has(jobName) && rejectionsLeft > 0) {
            rejectionsLeft -= 1;
            throw new Error("redis unavailable");
          }
          added.push({ queueName: name, jobName, data, options });
          return { id: jobName };
        },
        close: async () => undefined,
      }) as unknown as Queue) as (name: string) => Queue;

    const dispatcher = new OutboxDispatcher(
      outbox as unknown as OutboxService,
      queueFactory,
    );

    const running = dispatcher.run();
    await waitFor(() => outbox.published.length === 1 && outbox.failed.length === 1);
    await dispatcher.stop();
    await running;

    expect(outbox.failed).toHaveLength(1);
    expect(outbox.failed[0]?.id).toBe(failing.id);
    expect(outbox.published).toEqual([succeeding.id]);
    expect(added).toHaveLength(1);
    expect(added[0]?.data).toMatchObject({ eventId: succeeding.id });
  });
});

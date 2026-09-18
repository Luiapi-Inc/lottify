import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import { getEnvironment } from "../../../src/platform/config/env";
import { OutboxService, type ClaimedOutboxEvent } from "../../../src/platform/outbox/outbox.service";
import { createQueue } from "../../../src/platform/queue/queue.factory";
import { routeTopicToQueue } from "../../../src/platform/queue/queue-routing";

/**
 * Queue factory seam. Bound to `createQueue` by default; tests replace it so the
 * dispatch loop can be exercised without a Redis connection.
 */
export const OUTBOX_QUEUE_FACTORY = Symbol("OUTBOX_QUEUE_FACTORY");
export type OutboxQueueFactory = (name: string) => Queue;

/** Tracer used for the worker-side hop of an outbox event. */
export const OUTBOX_TRACER_NAME = "lottify-worker-outbox";

/**
 * The single span attribute that joins the API request, the workflow row, the
 * outbox row and the worker hop. The API's CorrelationMiddleware binds the same
 * key, so one id identifies the whole transaction (GH #92 / W5-F3).
 */
export const OUTBOX_CORRELATION_ATTRIBUTE = "lottify.correlation_id";

const tracer = trace.getTracer(OUTBOX_TRACER_NAME);

/**
 * Span attributes for the worker-side hop. The correlation id is attached only
 * when the outbox row actually carries one: an absent id must never be reported
 * as an empty string that silently joins unrelated events.
 */
export function outboxDispatchAttributes(
  event: ClaimedOutboxEvent,
  queueName: string,
): Attributes {
  const attributes: Attributes = {
    "messaging.system": "bullmq",
    "messaging.destination.name": queueName,
    "messaging.message.id": event.id,
    "lottify.outbox.event_id": event.id,
    "lottify.outbox.topic": event.topic,
    "lottify.outbox.attempts": event.attempts,
  };
  if (event.correlationId) {
    attributes[OUTBOX_CORRELATION_ATTRIBUTE] = event.correlationId;
  }
  if (event.aggregateType) {
    attributes["lottify.outbox.aggregate_type"] = event.aggregateType;
  }
  if (event.aggregateId) {
    attributes["lottify.outbox.aggregate_id"] = event.aggregateId;
  }
  return attributes;
}

/**
 * Structured log record for a dispatched event. The worker logs JSON, so the
 * correlation id is a first-class field of the record and the worker hop stays
 * greppable by the same id the caller sent to the API.
 */
export function outboxDispatchLogRecord(
  event: ClaimedOutboxEvent,
  queueName: string,
): Record<string, unknown> {
  return {
    msg: "outbox event published to queue",
    correlationId: event.correlationId,
    eventId: event.id,
    topic: event.topic,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    queue: queueName,
    attempts: event.attempts,
  };
}

export function outboxDispatchFailureLogRecord(
  event: ClaimedOutboxEvent,
  queueName: string,
  error: string,
): Record<string, unknown> {
  return {
    msg: "outbox event dispatch failed",
    correlationId: event.correlationId,
    eventId: event.id,
    topic: event.topic,
    queue: queueName,
    attempts: event.attempts,
    error,
  };
}

@Injectable()
export class OutboxDispatcher {
  private readonly workerId = randomUUID();
  private readonly queues = new Map<string, Queue>();
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly queueFactory: OutboxQueueFactory;
  private stopped = false;

  constructor(
    private readonly outbox: OutboxService,
    @Optional() @Inject(OUTBOX_QUEUE_FACTORY) queueFactory?: OutboxQueueFactory,
  ) {
    this.queueFactory = queueFactory ?? createQueue;
  }

  async run(): Promise<void> {
    const env = getEnvironment();
    while (!this.stopped) {
      const events = await this.outbox.claimBatch(this.workerId, 100, env.OUTBOX_LOCK_TTL_SECONDS);
      for (const event of events) {
        // One failing event must never stop the loop, and the correlation id
        // travels into the job so the consumer hop joins the same transaction.
        await this.dispatch(event, routeTopicToQueue(event.topic));
      }
      await new Promise((resolve) => setTimeout(resolve, env.OUTBOX_POLL_INTERVAL_MS));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

  private queueFor(queueName: string): Queue {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = this.queueFactory(queueName);
      this.queues.set(queueName, queue);
    }
    return queue;
  }

  /**
   * Publishes one claimed event. This span is the worker-side hop of the
   * transaction trace: it carries `lottify.correlation_id` from the outbox row,
   * so API request, workflow row, outbox row and worker hop are joinable by one
   * id even though the worker process shares no request context with the API.
   */
  private async dispatch(event: ClaimedOutboxEvent, queueName: string): Promise<void> {
    await tracer.startActiveSpan(
      "outbox.dispatch",
      { kind: SpanKind.PRODUCER, attributes: outboxDispatchAttributes(event, queueName) },
      async (span) => {
        try {
          await this.queueFor(queueName).add(
            event.topic,
            {
              eventId: event.id,
              topic: event.topic,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              payload: event.payload,
              correlationId: event.correlationId,
              createdAt: event.createdAt.toISOString(),
            },
            { jobId: event.id, attempts: 10, backoff: { type: "exponential", delay: 500 } },
          );
          await this.outbox.markPublished(event.id, this.workerId);
          this.logger.log(outboxDispatchLogRecord(event, queueName));
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          if (error instanceof Error) span.recordException(error);
          await this.outbox.markFailed(event.id, this.workerId, error);
          this.logger.warn(outboxDispatchFailureLogRecord(event, queueName, message));
        } finally {
          span.end();
        }
      },
    );
  }
}

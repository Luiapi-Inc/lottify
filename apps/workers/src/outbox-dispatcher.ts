import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import { getEnvironment } from "../../../src/platform/config/env";
import { createQueue } from "../../../src/platform/queue/queue.factory";
import { routeTopicToQueue } from "../../../src/platform/queue/queue-routing";
import { OutboxService } from "../../../src/platform/outbox/outbox.service";

@Injectable()
export class OutboxDispatcher {
  private readonly workerId = randomUUID();
  private readonly queues = new Map<string, Queue>();
  private stopped = false;

  constructor(private readonly outbox: OutboxService) {}

  async run(): Promise<void> {
    const env = getEnvironment();
    while (!this.stopped) {
      const events = await this.outbox.claimBatch(this.workerId, 100, env.OUTBOX_LOCK_TTL_SECONDS);
      for (const event of events) {
        try {
          const queueName = routeTopicToQueue(event.topic);
          let queue = this.queues.get(queueName);
          if (!queue) {
            queue = createQueue(queueName);
            this.queues.set(queueName, queue);
          }
          await queue.add(
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
        } catch (error) {
          await this.outbox.markFailed(event.id, this.workerId, error);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, env.OUTBOX_POLL_INTERVAL_MS));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}

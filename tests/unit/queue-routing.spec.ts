import { describe, expect, it } from "vitest";
import { QUEUE_NAMES, routeTopicToQueue } from "../../src/platform/queue/queue-routing";

describe("outbox queue routing", () => {
  it.each([
    ["settlement.batch.requested", QUEUE_NAMES.settlement],
    ["result.confirmed", QUEUE_NAMES.settlement],
    ["payment.webhook.accepted", QUEUE_NAMES.paymentReconciliation],
    ["withdrawal.requested", QUEUE_NAMES.paymentReconciliation],
    ["notification.requested", QUEUE_NAMES.notification],
    ["audit.recorded", QUEUE_NAMES.schedulerOutbox],
  ])("routes %s to %s", (topic, queue) => {
    expect(routeTopicToQueue(topic)).toBe(queue);
  });
});

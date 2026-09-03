export const QUEUE_NAMES = {
  settlement: "lottify.settlement",
  paymentReconciliation: "lottify.payment-reconciliation",
  notification: "lottify.notification",
  schedulerOutbox: "lottify.scheduler-outbox",
} as const;

export function routeTopicToQueue(topic: string): string {
  if (topic.startsWith("settlement.") || topic.startsWith("result.")) {
    return QUEUE_NAMES.settlement;
  }
  if (topic.startsWith("payment.") || topic.startsWith("withdrawal.") || topic.startsWith("deposit.")) {
    return QUEUE_NAMES.paymentReconciliation;
  }
  if (topic.startsWith("notification.")) {
    return QUEUE_NAMES.notification;
  }
  return QUEUE_NAMES.schedulerOutbox;
}

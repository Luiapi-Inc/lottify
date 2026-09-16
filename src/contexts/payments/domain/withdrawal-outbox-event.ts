import type { WithdrawalRecord, WithdrawalTransitionOutbox } from "./withdrawal.repository";

/**
 * Outbox topics published by the Withdrawal workflow.
 *
 * A topic is an integration contract: it is the routing key the dispatcher maps
 * to a queue (`src/platform/queue/queue-routing.ts`), not a domain state name.
 * Topics are versionless and additive; renaming one is a breaking change for
 * every consumer.
 */
export const WITHDRAWAL_OUTBOX_TOPICS = {
  /** Funds are authoritatively reserved: the payout is now owed to the Member. */
  reserved: "withdrawal.reserved",
  /** The request was rejected before (or without) a Reservation: no payout owed. */
  rejected: "withdrawal.rejected",
} as const;

/** Outbox aggregate type for the Withdrawal workflow record. */
export const WITHDRAWAL_OUTBOX_AGGREGATE_TYPE = "PaymentWithdrawal";

/**
 * Payload of `withdrawal.reserved`, recorded in the same transaction as the
 * `REQUESTED -> RESERVING` transition. Monetary values are serialized as minor
 * unit strings so the payload stays loss-free JSON (a `bigint` cannot be
 * represented in a JSONB column).
 */
export function withdrawalReservedOutboxEvent(
  withdrawal: WithdrawalRecord,
  reservationId: string,
): WithdrawalTransitionOutbox {
  return {
    topic: WITHDRAWAL_OUTBOX_TOPICS.reserved,
    payload: {
      withdrawalId: withdrawal.id,
      memberId: withdrawal.memberId,
      payoutDestinationId: withdrawal.payoutDestinationId,
      reservationId,
      amountMinor: withdrawal.amountMinor.toString(),
      feeMinor: withdrawal.feeMinor.toString(),
      currency: withdrawal.currency,
      requiresApproval: withdrawal.requiresApproval,
      eligibilityOutcome: withdrawal.eligibilityOutcome,
      eligibilityPolicyVersion: withdrawal.eligibilityPolicyVersion,
    },
  };
}

/**
 * Payload of `withdrawal.rejected`, recorded in the same transaction as the
 * `REQUESTED -> REJECTED` transition, so a consumer never observes a rejection
 * whose durable workflow event rolled back.
 */
export function withdrawalRejectedOutboxEvent(
  withdrawal: WithdrawalRecord,
  failureReason: string,
): WithdrawalTransitionOutbox {
  return {
    topic: WITHDRAWAL_OUTBOX_TOPICS.rejected,
    payload: {
      withdrawalId: withdrawal.id,
      memberId: withdrawal.memberId,
      amountMinor: withdrawal.amountMinor.toString(),
      feeMinor: withdrawal.feeMinor.toString(),
      currency: withdrawal.currency,
      failureReason,
    },
  };
}

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WITHDRAWAL_OUTBOX_AGGREGATE_TYPE,
  WITHDRAWAL_OUTBOX_TOPICS,
  withdrawalRejectedOutboxEvent,
  withdrawalReservedOutboxEvent,
} from "../../src/contexts/payments/domain/withdrawal-outbox-event";
import type { WithdrawalRecord } from "../../src/contexts/payments/domain/withdrawal.repository";

function withdrawal(overrides: Partial<WithdrawalRecord> = {}): WithdrawalRecord {
  const now = new Date("2026-09-16T12:00:00.000Z");
  return {
    id: randomUUID(),
    memberId: randomUUID(),
    payoutDestinationId: randomUUID(),
    amountMinor: 40_00n,
    feeMinor: 5n,
    currency: "THB",
    state: "RESERVING",
    version: 2,
    eligibilityOutcome: "ALLOW",
    eligibilityPolicyVersion: "withdrawal-eligibility:v1",
    eligibilityReasonCodes: ["ELIGIBLE"],
    eligibilityEvidenceRefs: [],
    requiresApproval: false,
    idempotencyScope: "WITHDRAWAL_CREATE:member",
    idempotencyKey: "key",
    fingerprint: "fingerprint",
    reservationId: null,
    providerId: "payout-rail",
    providerReferenceKey: "wdr:1",
    providerTransactionId: null,
    payoutEvidenceRef: null,
    ledgerTransactionId: null,
    reconciliationAttempts: 0,
    decidedByAdminId: null,
    decisionReason: null,
    failureReason: null,
    incomingProviderError: null,
    correlationId: "W5-E2E-OUTBOX-1",
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Withdrawal outbox producer payloads", () => {
  it("declares the reserved and rejected topics and the aggregate type", () => {
    expect(WITHDRAWAL_OUTBOX_TOPICS.reserved).toBe("withdrawal.reserved");
    expect(WITHDRAWAL_OUTBOX_TOPICS.rejected).toBe("withdrawal.rejected");
    expect(WITHDRAWAL_OUTBOX_AGGREGATE_TYPE).toBe("PaymentWithdrawal");
  });

  it("serializes monetary values as loss-free JSON strings", () => {
    const record = withdrawal();
    const event = withdrawalReservedOutboxEvent(record, "reservation-1");
    expect(event.topic).toBe(WITHDRAWAL_OUTBOX_TOPICS.reserved);
    expect(event.payload).toEqual({
      withdrawalId: record.id,
      memberId: record.memberId,
      payoutDestinationId: record.payoutDestinationId,
      reservationId: "reservation-1",
      amountMinor: "4000",
      feeMinor: "5",
      currency: "THB",
      requiresApproval: false,
      eligibilityOutcome: "ALLOW",
      eligibilityPolicyVersion: "withdrawal-eligibility:v1",
    });
    // The payload must be storable in a JSONB column: no bigint survives here.
    expect(JSON.parse(JSON.stringify(event.payload))).toEqual(event.payload);
  });

  it("records the failure reason on a rejected request", () => {
    const event = withdrawalRejectedOutboxEvent(withdrawal({ state: "REJECTED" }), "INSUFFICIENT_FUNDS");
    expect(event.topic).toBe(WITHDRAWAL_OUTBOX_TOPICS.rejected);
    expect(event.payload).toMatchObject({
      amountMinor: "4000",
      currency: "THB",
      failureReason: "INSUFFICIENT_FUNDS",
    });
  });
});

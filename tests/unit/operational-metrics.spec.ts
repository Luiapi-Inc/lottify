import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { register } from "prom-client";
import {
  CONFIRM_ERROR_BURST_THRESHOLD,
  CONFIRM_FAILURE_BURST_THRESHOLD,
  OUTBOX_LAG_ALERT_THRESHOLD_SECONDS,
  PAYMENT_FAILURE_BURST_THRESHOLD,
  confirmErrorsTotal,
  confirmFailuresTotal,
  confirmRequestsTotal,
  outboxLag,
  paymentWebhookFailuresTotal,
  providerHealth,
  queueDlqLag,
  reconciliationDiscrepancies,
  reconciliationDiscrepanciesCritical,
  recordConfirmCommand,
  recordInboundPaymentFailure,
  recordProviderInteraction,
  recordQueueLag,
  recordReconciliationSnapshot,
  recordSettlementFailure,
  recordWithdrawalsStuckReconciling,
  resetOperationalMetrics,
  settlementFailuresTotal,
  withdrawalsStuckReconciling,
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

/** prom-client does not expose `name`/`type` in its public types; read them structurally. */
function metricName(metric: unknown): string | undefined {
  return (metric as { name?: string } | undefined)?.name;
}

const MINUTE = 60_000;

let sink: CaptureSink;

beforeEach(() => {
  resetOperationalMetrics();
  sink = new CaptureSink();
  setOperationalAlertSink(sink);
});

afterEach(() => {
  setOperationalAlertSink(undefined);
  resetOperationalMetrics();
});

describe("operational metrics — collectors exist for every family", () => {
  it("registers the F1-F7 metric names the committed alert rules evaluate", () => {
    const expected: Array<[string, string]> = [
      ["lottify_reconciliation_discrepancies", "gauge"],
      ["lottify_reconciliation_discrepancies_critical", "gauge"],
      ["lottify_confirm_requests_total", "counter"],
      ["lottify_confirm_failures_total", "counter"],
      ["lottify_confirm_errors_total", "counter"],
      ["lottify_payment_webhook_failures_total", "counter"],
      ["lottify_withdrawals_stuck_reconciling", "gauge"],
      ["lottify_settlement_failures_total", "counter"],
      ["lottify_queue_dlq_lag", "gauge"],
      ["lottify_outbox_lag", "gauge"],
      ["lottify_provider_health", "gauge"],
    ];

    for (const [name, type] of expected) {
      const metric = register.getSingleMetric(name);
      expect(metric, `${name} must be registered`).toBeDefined();
      expect(metricName(metric)).toBe(name);
      expect((metric as unknown as { type: string }).type).toBe(type);
    }
  });

  it("publishes the F1 reconciliation gauges", async () => {
    recordReconciliationSnapshot({ mismatches: 2, critical: 1 });
    const exposed = await register.metrics();
    expect(exposed).toContain("lottify_reconciliation_discrepancies 2");
    expect(exposed).toContain("lottify_reconciliation_discrepancies_critical 1");
  });
});

describe("F2 — Confirm error / failure spike detector", () => {
  it("counts every Confirm and alerts only once the denial burst threshold is reached", () => {
    recordConfirmCommand({ outcome: "CONFIRMED" });
    recordConfirmCommand({ outcome: "CONFIRMED" });
    expect(metricName(confirmRequestsTotal)).toBe("lottify_confirm_requests_total");

    for (let i = 1; i < CONFIRM_FAILURE_BURST_THRESHOLD; i += 1) {
      recordConfirmCommand({ outcome: "REJECTED", reason: "CUTOFF_REACHED" });
      expect(sink.alerts).toHaveLength(0);
    }
    recordConfirmCommand({ outcome: "REJECTED", reason: "CUTOFF_REACHED" });

    expect(sink.alerts).toHaveLength(1);
    const alert = sink.alerts[0]!;
    expect(alert.code).toBe("CONFIRM_FAILURE_BURST");
    expect(alert.severity).toBe("ERROR");
    expect(alert.details.family).toBe("confirm_error_failure_spike");
    expect(alert.details.reason).toBe("CUTOFF_REACHED");
    expect(alert.details.occurrencesInWindow).toBe(CONFIRM_FAILURE_BURST_THRESHOLD);
  });

  it("raises the error spike alert on unexpected Confirm errors without counting them as failures", async () => {
    for (let i = 0; i < CONFIRM_ERROR_BURST_THRESHOLD; i += 1) {
      recordConfirmCommand({ outcome: "ERROR", reason: "Error" });
    }
    expect(sink.alerts).toHaveLength(1);
    expect(sink.alerts[0]!.code).toBe("CONFIRM_ERROR_RATE_SPIKE");

    const exposed = await register.metrics();
    expect(exposed).toContain("lottify_confirm_errors_total 3");
    // Denials and errors are separate series; the ratio rule divides errors by
    // requests, so an error must never be double counted as a failure.
    expect(exposed).not.toContain("lottify_confirm_failures_total 3");
    expect(exposed).toContain("lottify_confirm_failures_total 0");
  });

  it("rate-limits a continuing burst to one alert per cooldown", () => {
    const base = new Date("2026-09-16T10:00:00.000Z");
    for (let i = 0; i < CONFIRM_FAILURE_BURST_THRESHOLD; i += 1) {
      recordConfirmCommand({ outcome: "REJECTED", occurredAt: base });
    }
    expect(sink.alerts).toHaveLength(1);

    for (let i = 0; i < CONFIRM_FAILURE_BURST_THRESHOLD; i += 1) {
      recordConfirmCommand({
        outcome: "REJECTED",
        occurredAt: new Date(base.getTime() + 5 * MINUTE),
      });
    }
    expect(sink.alerts).toHaveLength(1);

    for (let i = 0; i < CONFIRM_FAILURE_BURST_THRESHOLD; i += 1) {
      recordConfirmCommand({
        outcome: "REJECTED",
        occurredAt: new Date(base.getTime() + 16 * MINUTE),
      });
    }
    expect(sink.alerts).toHaveLength(2);
  });

  it("does not alert across separate windows", () => {
    const base = new Date("2026-09-16T10:00:00.000Z");
    recordConfirmCommand({ outcome: "ERROR", occurredAt: base });
    recordConfirmCommand({ outcome: "ERROR", occurredAt: new Date(base.getTime() + 6 * MINUTE) });
    expect(sink.alerts).toHaveLength(0);
    expect(confirmRequestsTotal).toBeDefined();
  });
});

describe("F3 — inbound payment failure detector", () => {
  it("counts failures and alerts on the burst threshold with the stage and provider in details", async () => {
    for (let i = 0; i < PAYMENT_FAILURE_BURST_THRESHOLD; i += 1) {
      recordInboundPaymentFailure({
        provider: "corridor",
        stage: "deposit-reconcile",
        reason: "TIMEOUT",
      });
    }

    expect(sink.alerts).toHaveLength(1);
    const alert = sink.alerts[0]!;
    expect(alert.code).toBe("PAYMENT_WEBHOOK_FAILURE");
    expect(alert.details.provider).toBe("corridor");
    expect(alert.details.stage).toBe("deposit-reconcile");
    const exposed = await register.metrics();
    expect(exposed).toContain("lottify_payment_webhook_failures_total 3");
  });
});

describe("F4 — stuck reconciliation detector", () => {
  it("publishes the gauge without alerting while nothing is stuck", async () => {
    recordWithdrawalsStuckReconciling({ count: 0, occurredAt: new Date("2026-09-16T10:00:00Z") });
    expect(sink.alerts).toHaveLength(0);
    const exposed = await register.metrics();
    expect(exposed).toContain("lottify_withdrawals_stuck_reconciling 0");
  });

  it("alerts once per evaluation window while withdrawals are stuck", () => {
    const base = new Date("2026-09-16T10:00:00Z");
    recordWithdrawalsStuckReconciling({
      count: 2,
      oldestState: "RECONCILING",
      oldestAgeMs: 45 * MINUTE,
      occurredAt: base,
    });
    expect(sink.alerts).toHaveLength(1);
    expect(sink.alerts[0]!.code).toBe("WITHDRAWAL_STUCK_RECONCILING");
    expect(sink.alerts[0]!.details.count).toBe(2);

    // The detector re-evaluates the same durable state every cycle; the second
    // observation must not look like a second occurrence.
    recordWithdrawalsStuckReconciling({ count: 2, occurredAt: new Date(base.getTime() + 5 * MINUTE) });
    expect(sink.alerts).toHaveLength(1);
    expect(metricName(withdrawalsStuckReconciling)).toBe("lottify_withdrawals_stuck_reconciling");
  });
});

describe("F5 — settlement failure detector", () => {
  it("alerts CRITICAL on the first failed batch and labels it by batch", () => {
    recordSettlementFailure({
      stage: "batch-execution",
      batchId: "batch-1",
      drawId: "draw-1",
      reason: "SETTLEMENT_FAILED",
    });

    expect(sink.alerts).toHaveLength(1);
    const alert = sink.alerts[0]!;
    expect(alert.code).toBe("SETTLEMENT_FAILURE");
    expect(alert.severity).toBe("CRITICAL");
    expect(alert.fingerprint).toEqual(["SETTLEMENT_FAILURE", "batch-1"]);
    expect(alert.details.stage).toBe("batch-execution");
    expect(metricName(settlementFailuresTotal)).toBe("lottify_settlement_failures_total");
  });
});

describe("F6 — queue / DLQ lag detector", () => {
  it("publishes both gauges and stays quiet while both are inside the threshold", async () => {
    recordQueueLag({
      queueDlqDepth: { "lottify.settlement": 0 },
      oldestUnpublishedAgeSeconds: OUTBOX_LAG_ALERT_THRESHOLD_SECONDS - 1,
      occurredAt: new Date("2026-09-16T10:00:00Z"),
    });

    expect(sink.alerts).toHaveLength(0);
    const exposed = await register.metrics();
    expect(exposed).toContain('lottify_queue_dlq_lag{queue="lottify.settlement"} 0');
    expect(exposed).toContain(`lottify_outbox_lag ${OUTBOX_LAG_ALERT_THRESHOLD_SECONDS - 1}`);
  });

  it("alerts when the outbox lags or a dead-letter queue is deep", () => {
    const base = new Date("2026-09-16T10:00:00Z");
    recordQueueLag({
      queueDlqDepth: { "lottify.settlement": 1_500 },
      oldestUnpublishedAgeSeconds: OUTBOX_LAG_ALERT_THRESHOLD_SECONDS + 60,
      occurredAt: base,
    });

    expect(sink.alerts).toHaveLength(1);
    const alert = sink.alerts[0]!;
    expect(alert.code).toBe("QUEUE_DLQ_LAG");
    expect(alert.details.deepDlqQueues).toBe("lottify.settlement");
    expect(alert.details.outboxLagSeconds).toBe(OUTBOX_LAG_ALERT_THRESHOLD_SECONDS + 60);
    expect(metricName(queueDlqLag)).toBe("lottify_queue_dlq_lag");
    expect(metricName(outboxLag)).toBe("lottify_outbox_lag");
  });
});

describe("F7 — provider health detector", () => {
  it("publishes the health gauge per provider+capability", async () => {
    recordProviderInteraction({ provider: "corridor", capability: "deposit", healthy: true });
    const exposed = await register.metrics();
    expect(exposed).toContain('lottify_provider_health{provider="corridor",capability="deposit"} 1');
  });

  it("alerts on the transition into degradation and re-arms after recovery", () => {
    const base = new Date("2026-09-16T10:00:00Z");
    recordProviderInteraction({
      provider: "corridor",
      capability: "deposit",
      healthy: false,
      reason: "TIMEOUT",
      occurredAt: base,
    });
    expect(sink.alerts).toHaveLength(1);
    expect(sink.alerts[0]!.code).toBe("PROVIDER_HEALTH_DEGRADED");
    expect(sink.alerts[0]!.details.family).toBe("provider_health_degradation");
    expect(sink.alerts[0]!.fingerprint).toEqual(["PROVIDER_HEALTH_DEGRADED", "corridor:deposit"]);

    // Still degraded inside the cooldown: no duplicate alert.
    recordProviderInteraction({
      provider: "corridor",
      capability: "deposit",
      healthy: false,
      occurredAt: new Date(base.getTime() + MINUTE),
    });
    expect(sink.alerts).toHaveLength(1);

    // Recovery clears the state, so a later degradation alerts again.
    recordProviderInteraction({
      provider: "corridor",
      capability: "deposit",
      healthy: true,
      occurredAt: new Date(base.getTime() + 2 * MINUTE),
    });
    recordProviderInteraction({
      provider: "corridor",
      capability: "deposit",
      healthy: false,
      occurredAt: new Date(base.getTime() + 3 * MINUTE),
    });
    expect(sink.alerts).toHaveLength(2);
    expect(metricName(providerHealth)).toBe("lottify_provider_health");
  });
});

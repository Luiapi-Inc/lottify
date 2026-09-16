// Operational metrics + code-level detectors for the Ticket 13 alert families
// (GH #92 / W5 follow-up).
//
// `deploy/observability/alert-definitions.yaml` is the single source of truth
// for the seven families and `deploy/observability/prometheus/alerts.yml`
// mirrors them as Prometheus rules. A Prometheus rule only fires when the
// metric it references is actually produced, so every family needs a metric
// collector at the site where the signal is observable:
//
//   F1 reconciliation_discrepancy      -> lottify_reconciliation_discrepancies[_critical]
//   F2 confirm_error_failure_spike     -> lottify_confirm_requests_total / _failures_total / _errors_total
//   F3 payment_webhook_failure         -> lottify_payment_webhook_failures_total
//   F4 withdrawal_stuck_reconciling    -> lottify_withdrawals_stuck_reconciling
//   F5 settlement_failure              -> lottify_settlement_failures_total
//   F6 queue_dlq_lag                   -> lottify_queue_dlq_lag / lottify_outbox_lag
//   F7 provider_health_degradation     -> lottify_provider_health
//
// Counter metrics are deliberately label-free where a Prometheus rule divides
// two of them (`rate(errors) / rate(requests)`), so the vector match stays a
// single series; the discriminating label (denial reason, provider, stage) is
// carried in the alert details instead of the time series, which also keeps
// cardinality bounded.
//
// Alongside the collectors, every family gets an in-code detector that
// evaluates the signal and publishes through the OPERATIONAL_ALERT_SINK
// pipeline (`./operational-alert.sink`). Burst detectors are in-process
// sliding windows on the same signal the metric counts; freshness detectors
// (F4, F6) run in the worker process because they need durable state.

import { Counter, Gauge } from "prom-client";
import {
  emitOperationalAlert,
  type OperationalAlertSeverity,
} from "./operational-alert.sink";

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// Detection thresholds. These are the code-level counterparts of the
// Prometheus rule thresholds in deploy/observability/prometheus/alerts.yml and
// are documented in deploy/observability/alert-definitions.yaml.
// ---------------------------------------------------------------------------

/** F2 window over which Confirm outcomes are counted by the burst detector. */
export const CONFIRM_FAILURE_WINDOW_MS = 5 * MINUTE_MS;
/** F2 consecutive business denials within the window that raise CONFIRM_FAILURE_BURST. */
export const CONFIRM_FAILURE_BURST_THRESHOLD = 5;
/** F2 unexpected Confirm errors within the window that raise CONFIRM_ERROR_RATE_SPIKE. */
export const CONFIRM_ERROR_BURST_THRESHOLD = 3;
/** F2 minimum time between two emissions of the same Confirm alert. */
export const CONFIRM_ALERT_COOLDOWN_MS = 15 * MINUTE_MS;

/** F3 window over which inbound payment-provider failures are counted. */
export const PAYMENT_FAILURE_WINDOW_MS = 10 * MINUTE_MS;
/** F3 inbound payment-provider failures within the window that raise PAYMENT_WEBHOOK_FAILURE. */
export const PAYMENT_FAILURE_BURST_THRESHOLD = 3;
/** F3 minimum time between two emissions of the same payment alert. */
export const PAYMENT_ALERT_COOLDOWN_MS = 15 * MINUTE_MS;

/** F5 window over which failed settlement batches are counted. */
export const SETTLEMENT_FAILURE_WINDOW_MS = 5 * MINUTE_MS;
/** F5 failed settlement batches within the window that raise SETTLEMENT_FAILURE (critical). */
export const SETTLEMENT_FAILURE_BURST_THRESHOLD = 1;
/** F5 minimum time between two emissions of the settlement alert. */
export const SETTLEMENT_ALERT_COOLDOWN_MS = 15 * MINUTE_MS;

/** F4 age beyond which a Withdrawal still reconciling counts as stuck. */
export const WITHDRAWAL_RECONCILING_SLO_MS = 30 * MINUTE_MS;
/** F4 minimum time between two emissions of the stuck-withdrawal alert. */
export const WITHDRAWAL_STUCK_ALERT_COOLDOWN_MS = 30 * MINUTE_MS;

/** F6 unpublished Outbox age beyond which the outbox counts as lagging. */
export const OUTBOX_LAG_ALERT_THRESHOLD_SECONDS = 300;
/** F6 dead-letter depth per queue that raises QUEUE_DLQ_LAG. */
export const QUEUE_DLQ_LAG_ALERT_THRESHOLD = 1_000;
/** F6 minimum time between two emissions of the queue/DLQ alert. */
export const QUEUE_DLQ_ALERT_COOLDOWN_MS = 30 * MINUTE_MS;

/** F7 minimum time between two emissions of a provider degradation alert. */
export const PROVIDER_HEALTH_ALERT_COOLDOWN_MS = 15 * MINUTE_MS;

// ---------------------------------------------------------------------------
// F1 — reconciliation discrepancy (detector already existed in the
// reconciliation worker; these two gauges make its Prometheus rules live).
// ---------------------------------------------------------------------------

export const reconciliationDiscrepancies = new Gauge({
  name: "lottify_reconciliation_discrepancies",
  help: "Ledger-vs-wallet projection mismatches observed in the last reconciliation freshness cycle (family F1)",
});

export const reconciliationDiscrepanciesCritical = new Gauge({
  name: "lottify_reconciliation_discrepancies_critical",
  help: "Unresolved CRITICAL reconciliation discrepancies (family F1)",
});

export function recordReconciliationSnapshot(input: {
  mismatches: number;
  critical: number;
}): void {
  reconciliationDiscrepancies.set(input.mismatches);
  reconciliationDiscrepanciesCritical.set(input.critical);
}

// ---------------------------------------------------------------------------
// F2 — Confirm error / failure spike
// ---------------------------------------------------------------------------

export const confirmRequestsTotal = new Counter({
  name: "lottify_confirm_requests_total",
  help: "Bet Order Confirm commands handled at the member confirm boundary, by outcome family (F2)",
});

export const confirmFailuresTotal = new Counter({
  name: "lottify_confirm_failures_total",
  help: "Bet Order Confirm commands that resolved to a business denial (REJECTED) (F2)",
});

export const confirmErrorsTotal = new Counter({
  name: "lottify_confirm_errors_total",
  help: "Bet Order Confirm commands that failed unexpectedly (not a business denial) (F2)",
});

export type ConfirmCommandOutcome = "CONFIRMED" | "REJECTED" | "ERROR";

/**
 * Records one Confirm command. `CONFIRMED` is the durable success, `REJECTED`
 * is a business denial the domain resolved deliberately (expired quote, cutoff
 * reached, insufficient funds), `ERROR` is an unexpected failure. Detector:
 * a burst of denials or errors within the window raises the family alert once
 * (cooldown-bounded) through the OPERATIONAL_ALERT_SINK pipeline.
 */
export function recordConfirmCommand(input: {
  outcome: ConfirmCommandOutcome;
  reason?: string | null;
  orderId?: string | null;
  occurredAt?: Date;
}): void {
  confirmRequestsTotal.inc();
  if (input.outcome === "CONFIRMED") return;

  const occurredAt = input.occurredAt ?? new Date();
  const reason = input.reason ?? "UNKNOWN";
  const details = { reason, orderId: input.orderId ?? null };

  if (input.outcome === "REJECTED") {
    confirmFailuresTotal.inc();
    evaluateAlertBurst({
      code: "CONFIRM_FAILURE_BURST",
      family: "confirm_error_failure_spike",
      severity: "ERROR",
      message: "Confirm failure burst: business denials exceeded the 5-minute threshold",
      windowMs: CONFIRM_FAILURE_WINDOW_MS,
      threshold: CONFIRM_FAILURE_BURST_THRESHOLD,
      cooldownMs: CONFIRM_ALERT_COOLDOWN_MS,
      details,
      occurredAt,
    });
    return;
  }

  confirmErrorsTotal.inc();
  evaluateAlertBurst({
    code: "CONFIRM_ERROR_RATE_SPIKE",
    family: "confirm_error_failure_spike",
    severity: "ERROR",
    message: "Confirm error spike: unexpected failures exceeded the 5-minute threshold",
    windowMs: CONFIRM_FAILURE_WINDOW_MS,
    threshold: CONFIRM_ERROR_BURST_THRESHOLD,
    cooldownMs: CONFIRM_ALERT_COOLDOWN_MS,
    details,
    occurredAt,
  });
}

// ---------------------------------------------------------------------------
// F3 — payment webhook / inbound payment provider failure
// ---------------------------------------------------------------------------

export const paymentWebhookFailuresTotal = new Counter({
  name: "lottify_payment_webhook_failures_total",
  help: "Failed inbound payment provider interactions (deposit initiate/reconcile, payout) (F3)",
});

export type InboundPaymentStage =
  | "deposit-initiate"
  | "deposit-reconcile"
  | "payout"
  | "webhook";

/**
 * Records one failed inbound payment-provider interaction.
 *
 * NOTE (honesty): the repository has no HTTP webhook ingress for payment
 * providers yet (it is blocked on the payment/webhook ingress card), so this
 * family's signal is taken at the provider-interaction failure sites that do
 * exist (deposit initiate/reconcile, payout). When the ingress lands it must
 * call this same recorder, which is why the metric keeps the family's committed
 * name.
 */
export function recordInboundPaymentFailure(input: {
  provider: string;
  stage: InboundPaymentStage;
  reason: string;
  occurredAt?: Date;
}): void {
  paymentWebhookFailuresTotal.inc();
  evaluateAlertBurst({
    code: "PAYMENT_WEBHOOK_FAILURE",
    family: "payment_webhook_failure",
    severity: "ERROR",
    message: "Inbound payment provider failures exceeded the 10-minute threshold",
    windowMs: PAYMENT_FAILURE_WINDOW_MS,
    threshold: PAYMENT_FAILURE_BURST_THRESHOLD,
    cooldownMs: PAYMENT_ALERT_COOLDOWN_MS,
    details: { provider: input.provider, stage: input.stage, reason: input.reason },
    occurredAt: input.occurredAt ?? new Date(),
  });
}

// ---------------------------------------------------------------------------
// F4 — stuck / reconciling withdrawal
// ---------------------------------------------------------------------------

export const withdrawalsStuckReconciling = new Gauge({
  name: "lottify_withdrawals_stuck_reconciling",
  help: `Withdrawals still reconciling beyond the ${WITHDRAWAL_RECONCILING_SLO_MS / MINUTE_MS}-minute SLO (F4)`,
});

/** Sets the F4 gauge and alerts while at least one withdrawal is stuck. */
export function recordWithdrawalsStuckReconciling(input: {
  count: number;
  oldestState?: string | null;
  oldestAgeMs?: number | null;
  occurredAt?: Date;
}): void {
  withdrawalsStuckReconciling.set(input.count);
  if (input.count <= 0) return;
  evaluateAlertBurst({
    code: "WITHDRAWAL_STUCK_RECONCILING",
    family: "withdrawal_stuck_reconciling",
    severity: "ERROR",
    message: "Withdrawal(s) stuck in a reconciling state beyond the SLO",
    windowMs: WITHDRAWAL_RECONCILING_SLO_MS,
    threshold: 1,
    cooldownMs: WITHDRAWAL_STUCK_ALERT_COOLDOWN_MS,
    details: {
      count: input.count,
      oldestState: input.oldestState ?? null,
      oldestAgeMs: input.oldestAgeMs ?? null,
    },
    occurredAt: input.occurredAt ?? new Date(),
    // One occurrence per evaluation window, not per observation: the detector
    // re-evaluates every cycle, so counting observations would trip the
    // threshold from a single stuck withdrawal.
    countOccurrence: false,
  });
}

// ---------------------------------------------------------------------------
// F5 — settlement failure
// ---------------------------------------------------------------------------

export const settlementFailuresTotal = new Counter({
  name: "lottify_settlement_failures_total",
  help: "Settlement batch executions that ended FAILED (F5)",
});

export type SettlementFailureStage = "batch-execution";

export function recordSettlementFailure(input: {
  stage: SettlementFailureStage;
  batchId?: string | null;
  drawId?: string | null;
  reason?: string | null;
  occurredAt?: Date;
}): void {
  settlementFailuresTotal.inc();
  evaluateAlertBurst({
    code: "SETTLEMENT_FAILURE",
    family: "settlement_failure",
    severity: "CRITICAL",
    message: "Settlement batch execution failed",
    windowMs: SETTLEMENT_FAILURE_WINDOW_MS,
    threshold: SETTLEMENT_FAILURE_BURST_THRESHOLD,
    cooldownMs: SETTLEMENT_ALERT_COOLDOWN_MS,
    fingerprint: ["SETTLEMENT_FAILURE", input.batchId ?? "unknown-batch"],
    details: {
      stage: input.stage,
      batchId: input.batchId ?? null,
      drawId: input.drawId ?? null,
      reason: input.reason ?? null,
    },
    occurredAt: input.occurredAt ?? new Date(),
  });
}

// ---------------------------------------------------------------------------
// F6 — queue / DLQ lag
// ---------------------------------------------------------------------------

export const queueDlqLag = new Gauge({
  name: "lottify_queue_dlq_lag",
  help: "Dead-letter (failed job) depth per BullMQ queue (F6)",
  labelNames: ["queue"],
});

export const outboxLag = new Gauge({
  name: "lottify_outbox_lag",
  help: "Age in seconds of the oldest unpublished Outbox event (F6)",
});

/** Sets the F6 gauges; alerts when the outbox is lagging or a DLQ is deep. */
export function recordQueueLag(input: {
  queueDlqDepth?: Readonly<Record<string, number>>;
  oldestUnpublishedAgeSeconds?: number | null;
  occurredAt?: Date;
}): void {
  const occurredAt = input.occurredAt ?? new Date();
  for (const [queue, depth] of Object.entries(input.queueDlqDepth ?? {})) {
    queueDlqLag.set({ queue }, depth);
  }
  const outboxAge = input.oldestUnpublishedAgeSeconds ?? 0;
  outboxLag.set(outboxAge);

  const deepDlqQueues = Object.entries(input.queueDlqDepth ?? {})
    .filter(([, depth]) => depth >= QUEUE_DLQ_LAG_ALERT_THRESHOLD)
    .map(([queue]) => queue);
  const outboxLagging = outboxAge > OUTBOX_LAG_ALERT_THRESHOLD_SECONDS;
  if (!outboxLagging && deepDlqQueues.length === 0) return;

  evaluateAlertBurst({
    code: "QUEUE_DLQ_LAG",
    family: "queue_dlq_lag",
    severity: "ERROR",
    message: "Outbox lag or dead-letter depth exceeded the threshold",
    windowMs: QUEUE_DLQ_ALERT_COOLDOWN_MS,
    threshold: 1,
    cooldownMs: QUEUE_DLQ_ALERT_COOLDOWN_MS,
    details: {
      outboxLagSeconds: outboxAge,
      outboxLagThresholdSeconds: OUTBOX_LAG_ALERT_THRESHOLD_SECONDS,
      deepDlqQueues: deepDlqQueues.join(",") || null,
    },
    occurredAt,
    // See F4: the detector re-evaluates every cycle, so an observation is not
    // an occurrence.
    countOccurrence: false,
  });
}

// ---------------------------------------------------------------------------
// F7 — provider health degradation
// ---------------------------------------------------------------------------

export const providerHealth = new Gauge({
  name: "lottify_provider_health",
  help: "Upstream provider health derived from observed adapter outcomes: 1 = healthy, 0 = degraded (F7)",
  labelNames: ["provider", "capability"],
});

export type ProviderCapability = "deposit" | "payout" | "kyc" | "sms";

const degradedProviders = new Map<string, number>();

/**
 * Records the outcome of one provider interaction. The gauge is the health
 * signal Prometheus evaluates; the detector raises PROVIDER_HEALTH_DEGRADED on
 * the transition into the degraded state (and on a first-seen failure) so a
 * provider that stays down does not re-alert on every call.
 */
export function recordProviderInteraction(input: {
  provider: string;
  capability: ProviderCapability;
  healthy: boolean;
  reason?: string | null;
  occurredAt?: Date;
}): void {
  const key = `${input.provider}:${input.capability}`;
  const occurredAt = input.occurredAt ?? new Date();
  providerHealth.set({ provider: input.provider, capability: input.capability }, input.healthy ? 1 : 0);

  if (input.healthy) {
    degradedProviders.delete(key);
    return;
  }

  const lastAlertAt = degradedProviders.get(key);
  const withinCooldown =
    lastAlertAt !== undefined && occurredAt.getTime() - lastAlertAt < PROVIDER_HEALTH_ALERT_COOLDOWN_MS;
  degradedProviders.set(key, occurredAt.getTime());
  if (withinCooldown) return;

  emitOperationalAlert({
    code: "PROVIDER_HEALTH_DEGRADED",
    severity: "ERROR",
    message: `Provider ${input.provider} reported sustained degradation for ${input.capability}`,
    occurredAt,
    fingerprint: ["PROVIDER_HEALTH_DEGRADED", key],
    details: {
      family: "provider_health_degradation",
      provider: input.provider,
      capability: input.capability,
      health: 0,
      reason: input.reason ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Generic burst detector
// ---------------------------------------------------------------------------

interface BurstWindow {
  occurrences: number[];
  lastAlertAt: number | null;
}

const burstWindows = new Map<string, BurstWindow>();

export interface AlertBurstInput {
  code: string;
  family: string;
  severity: OperationalAlertSeverity;
  message: string;
  windowMs: number;
  threshold: number;
  cooldownMs: number;
  details?: Readonly<Record<string, string | number | boolean | null>>;
  fingerprint?: readonly string[];
  occurredAt?: Date;
  /**
   * Whether this call is an occurrence to count toward the threshold (default)
   * or a single observation of a state that already counts as one (the
   * freshness detectors, which re-evaluate the same durable state every cycle).
   */
  countOccurrence?: boolean;
}

/**
 * Records one occurrence of `code` and emits the family alert through the
 * OPERATIONAL_ALERT_SINK pipeline when the occurrence count inside the window
 * reaches the threshold, rate-limited by the cooldown. Returns whether an alert
 * was emitted, which is what the unit specs assert on.
 */
export function evaluateAlertBurst(input: AlertBurstInput): boolean {
  const occurredAt = input.occurredAt ?? new Date();
  const now = occurredAt.getTime();
  const window = burstWindows.get(input.code) ?? { occurrences: [], lastAlertAt: null };
  window.occurrences = [...window.occurrences, now].filter((at) => now - at <= input.windowMs);
  burstWindows.set(input.code, window);

  const occurrences = input.countOccurrence === false ? Math.max(window.occurrences.length, 1) : window.occurrences.length;
  if (occurrences < input.threshold) return false;

  const lastAlertAt = window.lastAlertAt;
  if (lastAlertAt !== null && now - lastAlertAt < input.cooldownMs) return false;

  window.lastAlertAt = now;
  emitOperationalAlert({
    code: input.code,
    severity: input.severity,
    message: input.message,
    occurredAt,
    fingerprint: input.fingerprint ?? [input.code],
    details: {
      family: input.family,
      occurrencesInWindow: occurrences,
      windowMs: input.windowMs,
      threshold: input.threshold,
      ...(input.details ?? {}),
    },
  });
  return true;
}

/** Clears detector state so a unit test starts from a clean window. */
export function resetOperationalDetectorState(): void {
  burstWindows.clear();
  degradedProviders.clear();
}

/** Resets every operational metric and detector (unit-test helper). */
export function resetOperationalMetrics(): void {
  reconciliationDiscrepancies.reset();
  reconciliationDiscrepanciesCritical.reset();
  confirmRequestsTotal.reset();
  confirmFailuresTotal.reset();
  confirmErrorsTotal.reset();
  paymentWebhookFailuresTotal.reset();
  withdrawalsStuckReconciling.reset();
  settlementFailuresTotal.reset();
  queueDlqLag.reset();
  outboxLag.reset();
  providerHealth.reset();
  resetOperationalDetectorState();
}

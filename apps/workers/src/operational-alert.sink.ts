// The operational alert pipeline now lives in the platform layer
// (`src/platform/observability/operational-alert.sink.ts`) so that every
// process (API and workers) publishes through one implementation and the
// detectors embedded in application services can reach it. This module stays
// as the worker-facing import path for the existing wiring and specs.
export {
  OPERATIONAL_ALERT_SINK,
  RoutingOperationalAlertSink,
  SentryOperationalAlertSink,
  WebhookOperationalAlertSink,
  configureOperationalAlertsFromEnvironment,
  emitOperationalAlert,
  getOperationalAlertSink,
  setOperationalAlertSink,
} from "../../../src/platform/observability/operational-alert.sink";
export type {
  OperationalAlert,
  OperationalAlertSeverity,
  OperationalAlertSink,
} from "../../../src/platform/observability/operational-alert.sink";

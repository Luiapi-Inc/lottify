import * as Sentry from "@sentry/node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK, metrics } from "@opentelemetry/sdk-node";
import { getEnvironment } from "../config/env";

let sdk: NodeSDK | undefined;

const OTLP_SIGNAL_SEGMENTS = { traces: "/v1/traces", metrics: "/v1/metrics" } as const;

/**
 * Resolve the per-signal exporter URL from the configured OTLP endpoint.
 *
 * Contract (GH #92 / W5-F1): `OTEL_EXPORTER_OTLP_ENDPOINT` is treated as the
 * OpenTelemetry-spec *base* endpoint shared by every signal. Each signal appends
 * its own path segment (`/v1/traces` for traces, `/v1/metrics` for metrics).
 * Any trailing slash and any already-present `/v1/<signal>` suffix are stripped
 * from the base first, so all three accepted shapes produce the same result:
 *
 *   - `http://collector:4318`            → traces `/v1/traces`, metrics `/v1/metrics`
 *   - `http://collector:4318/v1`         → traces `/v1/traces`, metrics `/v1/metrics`
 *   - `http://collector:4318/v1/traces`  → traces `/v1/traces`, metrics `/v1/metrics`
 *
 * This keeps the trace and metric exporters consistent so no telemetry signal is
 * silently dropped (a base-only value previously sent traces to `/` and a full
 * trace URL previously sent metrics to `/v1/traces/v1/metrics`).
 */
export function resolveOtlpSignalUrl(base: string, signal: "traces" | "metrics"): string {
  const cleaned = base
    .replace(/\/+$/, "")
    .replace(/(\/v1\/(traces|metrics)|\/v1)$/, "");
  const segment = OTLP_SIGNAL_SEGMENTS[signal];
  return cleaned.endsWith(segment) ? cleaned : `${cleaned}${segment}`;
}

export function initObservability(serviceName?: string): void {
  const env = getEnvironment();

  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.APP_ENV });
  }

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const service = serviceName ?? env.OTEL_SERVICE_NAME;
    const base = env.OTEL_EXPORTER_OTLP_ENDPOINT;
    sdk = new NodeSDK({
      serviceName: service,
      traceExporter: new OTLPTraceExporter({ url: resolveOtlpSignalUrl(base, "traces") }),
      metricReader: new metrics.PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: resolveOtlpSignalUrl(base, "metrics") }),
        exportIntervalMillis: 60_000,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
  }
}

export async function shutdownObservability(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}

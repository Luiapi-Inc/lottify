import * as Sentry from "@sentry/node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getEnvironment } from "../config/env";

let sdk: NodeSDK | undefined;

export function initObservability(serviceName?: string): void {
  const env = getEnvironment();

  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.APP_ENV });
  }

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    sdk = new NodeSDK({
      serviceName: serviceName ?? env.OTEL_SERVICE_NAME,
      traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
  }
}

export async function shutdownObservability(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}

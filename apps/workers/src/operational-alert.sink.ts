import { Injectable, Logger } from "@nestjs/common";
import * as Sentry from "@sentry/node";
import { getEnvironment } from "../../../src/platform/config/env";

export type OperationalAlertSeverity = "ERROR" | "CRITICAL";

export interface OperationalAlert {
  code: string;
  severity: OperationalAlertSeverity;
  message: string;
  occurredAt: Date;
  fingerprint: readonly string[];
  details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface OperationalAlertSink {
  emit(alert: OperationalAlert): void;
}

export const OPERATIONAL_ALERT_SINK = Symbol("OPERATIONAL_ALERT_SINK");

@Injectable()
export class SentryOperationalAlertSink implements OperationalAlertSink {
  private readonly logger = new Logger(SentryOperationalAlertSink.name);

  emit(alert: OperationalAlert): void {
    this.logger.error({
      event: "operational_alert",
      code: alert.code,
      severity: alert.severity,
      occurredAt: alert.occurredAt.toISOString(),
      details: alert.details,
    });

    Sentry.withScope((scope) => {
      scope.setLevel(alert.severity === "CRITICAL" ? "fatal" : "error");
      scope.setTag("operational_alert_code", alert.code);
      scope.setFingerprint([...alert.fingerprint]);
      scope.setContext("operational_alert", {
        occurredAt: alert.occurredAt.toISOString(),
        ...alert.details,
      });
      Sentry.captureMessage(alert.message);
    });
  }
}

/**
 * Delivers operational alerts as JSON POSTs to the configured webhook
 * endpoints (`OPERATIONAL_ALERT_WEBHOOK_URLS`, comma-separated). Delivery is
 * fire-and-forget with a bounded timeout so alerting never blocks the worker
 * loop; failures are logged but never thrown. With no URLs configured the sink
 * is a no-op.
 */
@Injectable()
export class WebhookOperationalAlertSink implements OperationalAlertSink {
  private readonly logger = new Logger(WebhookOperationalAlertSink.name);
  private readonly urls: string[];

  constructor() {
    this.urls = getEnvironment()
      .OPERATIONAL_ALERT_WEBHOOK_URLS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  emit(alert: OperationalAlert): void {
    if (this.urls.length === 0) return;
    const payload = {
      code: alert.code,
      severity: alert.severity,
      message: alert.message,
      occurredAt: alert.occurredAt.toISOString(),
      fingerprint: [...alert.fingerprint],
      details: { ...alert.details },
    };
    for (const url of this.urls) {
      void this.deliver(url, payload);
    }
  }

  private async deliver(url: string, payload: unknown): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.error(`Operational alert webhook ${url} returned HTTP ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      this.logger.error(
        `Operational alert webhook ${url} delivery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Fans an alert out to every composed sink; never throws. */
@Injectable()
export class RoutingOperationalAlertSink implements OperationalAlertSink {
  constructor(private readonly sinks: readonly OperationalAlertSink[]) {}

  emit(alert: OperationalAlert): void {
    for (const sink of this.sinks) {
      try {
        sink.emit(alert);
      } catch (error) {
        // A failing sink must not prevent the others from receiving the alert.
      }
    }
  }
}

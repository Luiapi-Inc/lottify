import { Injectable, Logger } from "@nestjs/common";
import * as Sentry from "@sentry/node";

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

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Request } from "express";
import pinoHttp from "pino-http";
import { getEnvironment } from "../../../src/platform/config/env";
import {
  RedactingConsoleLogger,
  httpAccessLoggerOptions,
} from "../../../src/platform/observability/log-redaction";
import { initObservability, shutdownObservability } from "../../../src/platform/observability/observability";
import { ApiModule } from "./app.module";
import { configureApp } from "./configure-app";
import { CORRELATION_HEADER, resolveCorrelationId } from "./correlation";
import { HealthService } from "./health.service";

/** A request that has had its correlation id resolved by pino's `genReqId`. */
type CorrelationRequest = Request & { correlationId?: string };

async function bootstrap(): Promise<void> {
  const env = getEnvironment();
  initObservability(env.OTEL_SERVICE_NAME);

  const app = await NestFactory.create(ApiModule, {
    logger: new RedactingConsoleLogger({ json: true }),
  });
  app.use(
    pinoHttp({
      // Redaction paths/censor are owned by the platform log-redaction module
      // (Ticket 13 security gate: no Bearer tokens, cookies, OTP codes or the
      // Member phone identity in access logs).
      ...httpAccessLoggerOptions(env.LOG_LEVEL),
      // Use the correlation id as the log request id so access logs are joinable
      // to the transaction id (GH #92 / W5-F3). Same rule as CorrelationMiddleware.
      genReqId: (req) => {
        const header = req.headers[CORRELATION_HEADER];
        const value = typeof header === "string" ? header : undefined;
        const correlationId = resolveCorrelationId(value);
        (req as CorrelationRequest).correlationId = correlationId;
        return correlationId;
      },
      customProps: (req) => ({ correlationId: (req as CorrelationRequest).correlationId }),
    }),
  );
  configureApp(app);
  await app.listen(env.API_PORT, "0.0.0.0");
  app.get(HealthService).markStarted();

  const shutdown = async (): Promise<void> => {
    await app.close();
    await shutdownObservability();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void bootstrap();

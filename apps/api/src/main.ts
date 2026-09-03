import "reflect-metadata";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import pinoHttp from "pino-http";
import { getEnvironment } from "../../../src/platform/config/env";
import { initObservability, shutdownObservability } from "../../../src/platform/observability/observability";
import { ApiModule } from "./app.module";
import { configureApp } from "./configure-app";
import { HealthService } from "./health.service";

async function bootstrap(): Promise<void> {
  const env = getEnvironment();
  initObservability(env.OTEL_SERVICE_NAME);

  const app = await NestFactory.create(ApiModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  app.use(pinoHttp({ level: env.LOG_LEVEL }));
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

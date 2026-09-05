import "reflect-metadata";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { getEnvironment } from "../../../src/platform/config/env";
import { initObservability, shutdownObservability } from "../../../src/platform/observability/observability";
import { PrismaService } from "../../../src/platform/persistence/prisma.service";
import { AccountingPeriodScheduler } from "./accounting-period-scheduler";
import { startWorkerHealthServer } from "./health-server";
import { OutboxDispatcher } from "./outbox-dispatcher";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  const env = getEnvironment();
  initObservability(`lottify-worker-${env.WORKER_GROUP}`);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  const health = startWorkerHealthServer(app.get(PrismaService), env.WORKER_HEALTH_PORT);
  const dispatcher = app.get(OutboxDispatcher);
  const accountingPeriodScheduler = app.get(AccountingPeriodScheduler);

  if (env.WORKER_GROUP === "scheduler-outbox") {
    void dispatcher.run();
    void accountingPeriodScheduler.run();
  }

  const shutdown = async (): Promise<void> => {
    accountingPeriodScheduler.stop();
    await dispatcher.stop();
    health.close();
    await app.close();
    await shutdownObservability();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void bootstrap();

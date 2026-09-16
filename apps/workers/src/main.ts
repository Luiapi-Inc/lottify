import "reflect-metadata";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { getEnvironment } from "../../../src/platform/config/env";
import { initObservability, shutdownObservability } from "../../../src/platform/observability/observability";
import { PrismaService } from "../../../src/platform/persistence/prisma.service";
import { AccountingPeriodScheduler } from "./accounting-period-scheduler";
import { startWorkerHealthServer } from "./health-server";
import { LedgerWalletReconciliationFreshnessWorker } from "./ledger-wallet-reconciliation-freshness.worker";
import { OperationalFreshnessDetectorWorker } from "./operational-freshness-detector.worker";
import { configureOperationalAlertsFromEnvironment } from "./operational-alert.sink";
import { OutboxDispatcher } from "./outbox-dispatcher";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  const env = getEnvironment();
  initObservability(`lottify-worker-${env.WORKER_GROUP}`);
  // Bind the process-wide alert pipeline so detectors embedded in application
  // services (F2/F3/F5/F7) and the freshness detectors (F4/F6) deliver through
  // the same OPERATIONAL_ALERT_SINK sinks as the in-worker detectors (F1).
  configureOperationalAlertsFromEnvironment();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  const health = startWorkerHealthServer(app.get(PrismaService), env.WORKER_HEALTH_PORT);
  const dispatcher = app.get(OutboxDispatcher);
  const accountingPeriodScheduler = app.get(AccountingPeriodScheduler);
  const reconciliationFreshness = app.get(LedgerWalletReconciliationFreshnessWorker);
  const operationalFreshness = app.get(OperationalFreshnessDetectorWorker);

  if (env.WORKER_GROUP === "scheduler-outbox") {
    void dispatcher.run();
    void accountingPeriodScheduler.run();
  }
  if (env.WORKER_GROUP === "payment-reconciliation") {
    void reconciliationFreshness.run();
  }
  // F4 (stuck withdrawals) belongs to the payment/reconciliation group and F6
  // (outbox + queue DLQ lag) to the scheduler/outbox group; the detector runs in
  // both so each group publishes the gauges for its family.
  if (env.WORKER_GROUP === "payment-reconciliation" || env.WORKER_GROUP === "scheduler-outbox") {
    void operationalFreshness.run();
  }

  const shutdown = async (): Promise<void> => {
    accountingPeriodScheduler.stop();
    reconciliationFreshness.stop();
    operationalFreshness.stop();
    await dispatcher.stop();
    health.close();
    await app.close();
    await shutdownObservability();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void bootstrap();

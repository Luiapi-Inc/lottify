import { Module } from "@nestjs/common";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { AccountingPeriodScheduler } from "./accounting-period-scheduler";
import { LedgerWalletReconciliationFreshnessWorker } from "./ledger-wallet-reconciliation-freshness.worker";
import {
  OPERATIONAL_ALERT_SINK,
  RoutingOperationalAlertSink,
  SentryOperationalAlertSink,
  WebhookOperationalAlertSink,
} from "./operational-alert.sink";
import { OutboxDispatcher } from "./outbox-dispatcher";

@Module({
  imports: [PlatformModule, ContextsModule],
  providers: [
    AccountingPeriodScheduler,
    OutboxDispatcher,
    LedgerWalletReconciliationFreshnessWorker,
    SentryOperationalAlertSink,
    WebhookOperationalAlertSink,
    {
      provide: OPERATIONAL_ALERT_SINK,
      useFactory: (
        sentrySink: SentryOperationalAlertSink,
        webhookSink: WebhookOperationalAlertSink,
      ) => new RoutingOperationalAlertSink([sentrySink, webhookSink]),
      inject: [SentryOperationalAlertSink, WebhookOperationalAlertSink],
    },
  ],
})
export class WorkerModule {}

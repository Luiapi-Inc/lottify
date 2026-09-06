import { Module } from "@nestjs/common";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { AccountingPeriodScheduler } from "./accounting-period-scheduler";
import { LedgerWalletReconciliationFreshnessWorker } from "./ledger-wallet-reconciliation-freshness.worker";
import {
  OPERATIONAL_ALERT_SINK,
  SentryOperationalAlertSink,
} from "./operational-alert.sink";
import { OutboxDispatcher } from "./outbox-dispatcher";

@Module({
  imports: [PlatformModule, ContextsModule],
  providers: [
    AccountingPeriodScheduler,
    OutboxDispatcher,
    LedgerWalletReconciliationFreshnessWorker,
    SentryOperationalAlertSink,
    { provide: OPERATIONAL_ALERT_SINK, useExisting: SentryOperationalAlertSink },
  ],
})
export class WorkerModule {}

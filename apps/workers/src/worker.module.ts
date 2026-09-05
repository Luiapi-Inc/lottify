import { Module } from "@nestjs/common";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { AccountingPeriodScheduler } from "./accounting-period-scheduler";
import { OutboxDispatcher } from "./outbox-dispatcher";

@Module({
  imports: [PlatformModule, ContextsModule],
  providers: [AccountingPeriodScheduler, OutboxDispatcher],
})
export class WorkerModule {}

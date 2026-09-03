import { Module } from "@nestjs/common";
import { IdempotencyModule } from "./idempotency/idempotency.module";
import { OutboxModule } from "./outbox/outbox.module";
import { PersistenceModule } from "./persistence/persistence.module";

@Module({ imports: [PersistenceModule, IdempotencyModule, OutboxModule] })
export class PlatformModule {}

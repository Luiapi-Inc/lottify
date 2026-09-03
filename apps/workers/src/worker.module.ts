import { Module } from "@nestjs/common";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { OutboxDispatcher } from "./outbox-dispatcher";

@Module({ imports: [PlatformModule, ContextsModule], providers: [OutboxDispatcher] })
export class WorkerModule {}

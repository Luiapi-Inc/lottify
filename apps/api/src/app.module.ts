import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { collectDefaultMetrics } from "prom-client";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { ApiV1Controller } from "./api-v1.controller";
import { CorrelationMiddleware } from "./correlation.middleware";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { MetricsController } from "./metrics.controller";

collectDefaultMetrics({ prefix: "lottify_" });

@Module({
  imports: [PlatformModule, ContextsModule],
  controllers: [ApiV1Controller, HealthController, MetricsController],
  providers: [HealthService],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes("*");
  }
}

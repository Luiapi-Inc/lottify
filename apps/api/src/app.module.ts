import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { collectDefaultMetrics } from "prom-client";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminCapabilityGuard } from "./admin-capability.guard";
import { ApiV1Controller } from "./api-v1.controller";
import { CorrelationMiddleware } from "./correlation.middleware";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { MetricsController } from "./metrics.controller";

collectDefaultMetrics({ prefix: "lottify_" });

@Module({
  imports: [PlatformModule, ContextsModule],
  controllers: [
    ApiV1Controller,
    AdminAuthController,
    HealthController,
    MetricsController,
  ],
  providers: [AdminAuthGuard, AdminCapabilityGuard, HealthService],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes("*");
  }
}

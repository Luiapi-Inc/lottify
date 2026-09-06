import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { collectDefaultMetrics } from "prom-client";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { AdminAccountingPeriodController } from "./admin-accounting-period.controller";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminCapabilityGuard } from "./admin-capability.guard";
import { AccountingPeriodApprovalService } from "./accounting-period-approval.service";
import { ApiV1Controller } from "./api-v1.controller";
import { CorrelationMiddleware } from "./correlation.middleware";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { HttpMetricsMiddleware } from "./http-metrics.middleware";
import { MetricsController } from "./metrics.controller";

collectDefaultMetrics({ prefix: "lottify_" });

@Module({
  imports: [PlatformModule, ContextsModule],
  controllers: [
    ApiV1Controller,
    AdminAccountingPeriodController,
    AdminAuthController,
    HealthController,
    MetricsController,
  ],
  providers: [
    AdminAuthGuard,
    AdminCapabilityGuard,
    AccountingPeriodApprovalService,
    HealthService,
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, HttpMetricsMiddleware).forRoutes("*");
  }
}

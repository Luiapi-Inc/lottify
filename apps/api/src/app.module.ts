import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { collectDefaultMetrics } from "prom-client";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { AdminAccountingPeriodController } from "./admin-accounting-period.controller";
import { AdminDrawController } from "./admin-draw.controller";
import { AdminLotteryConfigurationController } from "./admin-lottery-configuration.controller";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminCapabilityGuard } from "./admin-capability.guard";
import { AccountingPeriodApprovalService } from "./accounting-period-approval.service";
import { ApiV1Controller } from "./api-v1.controller";
import { CorrelationMiddleware } from "./correlation.middleware";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { HttpMetricsMiddleware } from "./http-metrics.middleware";
import { MemberAuthController } from "./member-auth.controller";
import { MemberAuthGuard } from "./member-auth.guard";
import { MemberDrawController } from "./member-draw.controller";
import { MemberQuoteController } from "./member-quote.controller";
import { MemberSessionDeviceController } from "./member-session-device.controller";
import { MemberWalletController } from "./member-wallet.controller";
import { MemberDepositController } from "./member-deposit.controller";
import { MetricsController } from "./metrics.controller";

collectDefaultMetrics({ prefix: "lottify_" });

@Module({
  imports: [PlatformModule, ContextsModule],
  controllers: [
    ApiV1Controller,
    AdminAccountingPeriodController,
    AdminDrawController,
    AdminLotteryConfigurationController,
    AdminAuthController,
    MemberAuthController,
    MemberDrawController,
    MemberQuoteController,
    MemberSessionDeviceController,
    MemberWalletController,
    MemberDepositController,
    HealthController,
    MetricsController,
  ],
  providers: [
    AdminAuthGuard,
    AdminCapabilityGuard,
    MemberAuthGuard,
    AccountingPeriodApprovalService,
    HealthService,
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, HttpMetricsMiddleware).forRoutes("*");
  }
}

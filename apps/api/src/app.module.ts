import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { collectDefaultMetrics } from "prom-client";
import { ContextsModule } from "../../../src/contexts/contexts.module";
import { PlatformModule } from "../../../src/platform/platform.module";
import { AdminAccountingPeriodController } from "./admin-accounting-period.controller";
import { AdminDrawController } from "./admin-draw.controller";
import { AdminLotteryConfigurationController } from "./admin-lottery-configuration.controller";
import { AdminPromotionController } from "./admin-promotion.controller";
import { AdminReconciliationController } from "./admin-reconciliation.controller";
import { AdminReportingController } from "./admin-reporting.controller";
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
import { MemberOrderController } from "./member-order.controller";
import { MemberSettlementController } from "./member-settlement.controller";
import { AdminResultSettlementController } from "./admin-result-settlement.controller";
import { MemberSessionDeviceController } from "./member-session-device.controller";
import { MemberWalletController } from "./member-wallet.controller";
import { MemberDepositController } from "./member-deposit.controller";
import { MemberWithdrawalController } from "./member-withdrawal.controller";
import { MemberPayoutDestinationController } from "./member-payout-destination.controller";
import { AdminWithdrawalController } from "./admin-withdrawal.controller";
import { WithdrawalReviewService } from "./withdrawal-review.service";
import { MemberPromotionController } from "./member-promotion.controller";
import { MemberNotificationPreferenceController } from "./member-notification-preference.controller";
import { MetricsController } from "./metrics.controller";

collectDefaultMetrics({ prefix: "lottify_" });

@Module({
  imports: [PlatformModule, ContextsModule],
  controllers: [
    ApiV1Controller,
    AdminAccountingPeriodController,
    AdminDrawController,
    AdminLotteryConfigurationController,
    AdminPromotionController,
    AdminReconciliationController,
    AdminReportingController,
    AdminAuthController,
    MemberAuthController,
    MemberDrawController,
    MemberQuoteController,
    MemberOrderController,
    MemberSettlementController,
    AdminResultSettlementController,
    MemberSessionDeviceController,
    MemberWalletController,
    MemberDepositController,
    MemberWithdrawalController,
    MemberPayoutDestinationController,
    AdminWithdrawalController,
    MemberPromotionController,
    MemberNotificationPreferenceController,
    HealthController,
    MetricsController,
  ],
  providers: [
    AdminAuthGuard,
    AdminCapabilityGuard,
    MemberAuthGuard,
    AccountingPeriodApprovalService,
    WithdrawalReviewService,
    HealthService,
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, HttpMetricsMiddleware).forRoutes("*");
  }
}

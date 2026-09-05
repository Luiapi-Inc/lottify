import { Module } from "@nestjs/common";
import { AdminApprovalModule } from "./admin-approval/admin-approval.module";
import { AuditModule } from "./audit/audit.module";
import { BettingModule } from "./betting/betting.module";
import { IdentityAccessModule } from "./identity-access/identity-access.module";
import { KycRiskModule } from "./kyc-risk/kyc-risk.module";
import { LotteryModule } from "./lottery/lottery.module";
import { MemberModule } from "./member/member.module";
import { NotificationModule } from "./notification/notification.module";
import { PaymentsModule } from "./payments/payments.module";
import { PromotionModule } from "./promotion/promotion.module";
import { ReportingModule } from "./reporting/reporting.module";
import { ResultSettlementModule } from "./result-settlement/result-settlement.module";
import { WalletLedgerModule } from "./wallet-ledger/wallet-ledger.module";

@Module({
  imports: [
    IdentityAccessModule,
    MemberModule,
    LotteryModule,
    BettingModule,
    WalletLedgerModule,
    PaymentsModule,
    KycRiskModule,
    PromotionModule,
    ResultSettlementModule,
    NotificationModule,
    AdminApprovalModule,
    AuditModule,
    ReportingModule,
  ],
  exports: [IdentityAccessModule, WalletLedgerModule],
})
export class ContextsModule {}

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
import { DepositService } from "./payments/application/deposit.service";
import { DEPOSIT_LEDGER_PORT } from "./payments/application/deposit-ledger.port";
import { PromotionModule } from "./promotion/promotion.module";
import { ReportingModule } from "./reporting/reporting.module";
import { LedgerWalletReconciliationService } from "./reporting/ledger-wallet-reconciliation.service";
import { LEDGER_WALLET_PROJECTION_PORT } from "./reporting/ledger-wallet-projection.port";
import { LEDGER_WALLET_SOURCE_PORT } from "./reporting/ledger-wallet-source.port";
import { ResultSettlementModule } from "./result-settlement/result-settlement.module";
import { WalletLedgerModule } from "./wallet-ledger/wallet-ledger.module";
import { LedgerWalletProjectionAdapter } from "../platform/integration/ledger-wallet-projection.adapter";
import { LedgerWalletSourceAdapter } from "../platform/integration/ledger-wallet-source.adapter";
import { DepositLedgerAdapter } from "../platform/integration/deposit-ledger.adapter";

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
  providers: [
    LedgerWalletProjectionAdapter,
    LedgerWalletSourceAdapter,
    {
      provide: LEDGER_WALLET_PROJECTION_PORT,
      useExisting: LedgerWalletProjectionAdapter,
    },
    {
      provide: LEDGER_WALLET_SOURCE_PORT,
      useExisting: LedgerWalletSourceAdapter,
    },
    DepositLedgerAdapter,
    {
      provide: DEPOSIT_LEDGER_PORT,
      useExisting: DepositLedgerAdapter,
    },
    DepositService,
    LedgerWalletReconciliationService,
  ],
  exports: [
    IdentityAccessModule,
    LotteryModule,
    BettingModule,
    WalletLedgerModule,
    PaymentsModule,
    DepositService,
    LedgerWalletReconciliationService,
  ],
})
export class ContextsModule {}

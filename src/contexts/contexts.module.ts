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
import { WithdrawalService } from "./payments/application/withdrawal.service";
import { PayoutDestinationService } from "./payments/application/payout-destination.service";
import { DEPOSIT_LEDGER_PORT } from "./payments/application/deposit-ledger.port";
import { BettingQuoteService } from "./betting/application/betting-quote.service";
import { BettingOrderService } from "./betting/application/betting-order.service";
import { DrawStakeRefundService } from "./betting/application/draw-stake-refund.service";
import { BET_ORDER_WALLET_PORT } from "./betting/application/betting-order-wallet.port";
import { BETTING_ELIGIBILITY_PORT } from "./betting/application/betting-eligibility.port";
import { SettlementService } from "./result-settlement/application/settlement.service";
import {
  SETTLEMENT_DRAW_PORT,
  SETTLEMENT_ORDERS_PORT,
  SETTLEMENT_WALLET_PORT,
} from "./result-settlement/application/settlement.ports";
import { WITHDRAWAL_LEDGER_PORT } from "./payments/application/withdrawal-ledger.port";
import { NotificationPreferenceService } from "./promotion/application/notification-preference.service";
import { TermsService } from "./member/application/terms.service";
import { ProfileService } from "./member/application/profile.service";
import { PromotionCampaignService } from "./promotion/application/promotion-campaign.service";
import { PromotionEntitlementService } from "./promotion/application/promotion-entitlement.service";
import { PROMOTION_LEDGER_PORT } from "./promotion/application/promotion-ledger.port";
import { PROMOTION_MEMBER_FACTS_PORT } from "./promotion/application/promotion-member-facts.port";
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
import { BetOrderWalletAdapter } from "../platform/integration/betting-order-wallet.adapter";
import { SettlementWalletAdapter } from "../platform/integration/settlement-wallet.adapter";
import { SettlementDrawAdapter } from "../platform/integration/settlement-draw.adapter";
import { SettlementOrdersAdapter } from "../platform/integration/settlement-orders.adapter";
import { WithdrawalLedgerAdapter } from "../platform/integration/withdrawal-ledger.adapter";
import { PromotionLedgerAdapter } from "../platform/integration/promotion-ledger.adapter";
import { PromotionMemberFactsAdapter } from "../platform/integration/promotion-member-facts.adapter";
import { CapabilityRestrictionAdapter } from "../platform/integration/capability-restriction.adapter";
import { MemberReadinessFactsAdapter } from "../platform/integration/member-readiness-facts.adapter";
import { BettingEligibilityAdapter } from "../platform/integration/betting-eligibility.adapter";
import { CAPABILITY_RESTRICTION_PORT } from "./kyc-risk/application/capability-restriction.port";
import { MEMBER_READINESS_FACTS_PORT } from "./kyc-risk/application/member-readiness-facts.port";
import { EligibilityService } from "./kyc-risk/application/eligibility.service";
import { CapabilityRestrictionAdminService } from "./member/application/capability-restriction-admin.service";

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
    // Bet Order orchestration lives here (not in BettingModule) so the
    // betting→wallet-ledger adapter and the betting→lottery draw port it needs
    // are both visible without one context module importing another.
    BetOrderWalletAdapter,
    {
      provide: BET_ORDER_WALLET_PORT,
      useExisting: BetOrderWalletAdapter,
    },
    BettingEligibilityAdapter,
    {
      provide: BETTING_ELIGIBILITY_PORT,
      useExisting: BettingEligibilityAdapter,
    },
    BettingQuoteService,
    BettingOrderService,
    // The Draw-cancellation refund operation is composed here, not in
    // BettingModule, so the betting→wallet-ledger port it needs is visible.
    DrawStakeRefundService,
    // Result & Settlement orchestration lives here (not in ResultSettlementModule)
    // so the settlement -> lottery draw, wallet-ledger and betting-orders port
    // adapters are all visible without one context module importing another.
    SettlementWalletAdapter,
    {
      provide: SETTLEMENT_WALLET_PORT,
      useExisting: SettlementWalletAdapter,
    },
    SettlementDrawAdapter,
    {
      provide: SETTLEMENT_DRAW_PORT,
      useExisting: SettlementDrawAdapter,
    },
    SettlementOrdersAdapter,
    {
      provide: SETTLEMENT_ORDERS_PORT,
      useExisting: SettlementOrdersAdapter,
    },
    SettlementService,
    WithdrawalLedgerAdapter,
    {
      provide: WITHDRAWAL_LEDGER_PORT,
      useExisting: WithdrawalLedgerAdapter,
    },
    // Promotion monetary effects flow through the Wallet & Ledger financial
    // core, never through a mutable balance; Member facts are resolved through
    // identity-access rather than re-derived from its storage.
    PromotionLedgerAdapter,
    {
      provide: PROMOTION_LEDGER_PORT,
      useExisting: PromotionLedgerAdapter,
    },
    PromotionMemberFactsAdapter,
    {
      provide: PROMOTION_MEMBER_FACTS_PORT,
      useExisting: PromotionMemberFactsAdapter,
    },
    PromotionCampaignService,
    PromotionEntitlementService,
    NotificationPreferenceService,
    // Member onboarding: Terms acceptance and the mandatory profile. The Member
    // context owns these facts (Ticket 01), so the services live here rather
    // than being derived by another context.
    TermsService,
    ProfileService,
    // Member capability readiness + KYC eligibility (Issue 66). KYC/Risk owns
    // the eligibility decision; the Member-owned restriction and onboarding
    // facts it reads are resolved through cross-context adapters.
    CapabilityRestrictionAdapter,
    {
      provide: CAPABILITY_RESTRICTION_PORT,
      useExisting: CapabilityRestrictionAdapter,
    },
    MemberReadinessFactsAdapter,
    {
      provide: MEMBER_READINESS_FACTS_PORT,
      useExisting: MemberReadinessFactsAdapter,
    },
    EligibilityService,
    CapabilityRestrictionAdminService,
    DepositService,
    WithdrawalService,
    PayoutDestinationService,
    LedgerWalletReconciliationService,
  ],
  exports: [
    IdentityAccessModule,
    LotteryModule,
    BettingModule,
    WalletLedgerModule,
    PaymentsModule,
    PromotionCampaignService,
    PromotionEntitlementService,
    NotificationPreferenceService,
    TermsService,
    ProfileService,
    CapabilityRestrictionAdminService,
    EligibilityService,
    DepositService,
    WithdrawalService,
    PayoutDestinationService,
    LedgerWalletReconciliationService,
    // Reporting exports its own read/reconciliation services; re-exporting the
    // module keeps a single instance per service instead of duplicating providers.
    ReportingModule,
    // Audit and AdminApproval export their own read services; re-exporting the
    // modules keeps a single instance per service instead of duplicating providers.
    AuditModule,
    AdminApprovalModule,
    BettingQuoteService,
    BettingOrderService,
    DrawStakeRefundService,
    SettlementService,
  ],
})
export class ContextsModule {}

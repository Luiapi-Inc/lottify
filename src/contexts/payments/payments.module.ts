import { Module } from "@nestjs/common";
import { DepositService } from "./application/deposit.service";
import { PAYMENT_PROVIDER_ADAPTER } from "./application/payment-provider.adapter";
import { PAYOUT_PROVIDER_ADAPTER } from "./application/payout-provider.adapter";
import { PAYOUT_DESTINATION_VERIFICATION_ADAPTER } from "./application/payout-destination-verification.adapter";
import { MEMBER_WITHDRAWAL_RESTRICTION_PORT } from "./application/withdrawal-restriction.port";
import { DEPOSIT_REPOSITORY } from "./domain/deposit.repository";
import { PAYOUT_DESTINATION_REPOSITORY } from "./domain/payout-destination.repository";
import { WITHDRAWAL_REPOSITORY } from "./domain/withdrawal.repository";
import { PrismaDepositRepository } from "./infrastructure/prisma-deposit.repository";
import { PrismaPayoutDestinationRepository } from "./infrastructure/prisma-payout-destination.repository";
import { PrismaWithdrawalRepository } from "./infrastructure/prisma-withdrawal.repository";
import { DeterministicPaymentProviderFake } from "./infrastructure/deterministic-payment-provider.adapter";
import { DeterministicPayoutProviderFake } from "./infrastructure/deterministic-payout-provider.adapter";
import { DeterministicPayoutDestinationVerificationFake } from "./infrastructure/deterministic-payout-destination-verification.adapter";
import { UnrestrictedMemberWithdrawalRestrictionAdapter } from "./infrastructure/unrestricted-member-withdrawal-restriction.adapter";

/**
 * Payments persistence and provider seams. The Withdrawal/Payout Destination
 * application services are bound in the composition root (`ContextsModule`)
 * because they depend on cross-context ports (the Wallet & Ledger withdrawal
 * seam) that Payments must not import directly.
 */
@Module({
  providers: [
    PrismaDepositRepository,
    {
      provide: DEPOSIT_REPOSITORY,
      useExisting: PrismaDepositRepository,
    },
    // No production payment provider is wired yet (Ticket 09 sequencing): the
    // vertical boots against the deterministic provider so the Deposit workflow
    // is testable and provably idempotent. Production integration replaces this
    // binding with a real provider adapter that owns request/status mapping.
    DeterministicPaymentProviderFake,
    {
      provide: PAYMENT_PROVIDER_ADAPTER,
      useExisting: DeterministicPaymentProviderFake,
    },
    PrismaPayoutDestinationRepository,
    {
      provide: PAYOUT_DESTINATION_REPOSITORY,
      useExisting: PrismaPayoutDestinationRepository,
    },
    PrismaWithdrawalRepository,
    {
      provide: WITHDRAWAL_REPOSITORY,
      useExisting: PrismaWithdrawalRepository,
    },
    // Payout provider and Payout Destination verification seams. No production
    // payout rail or verification provider is wired yet (Ticket 09 sequencing),
    // so the deterministic fakes are the default bindings and the single source
    // of deterministic truth for tests.
    DeterministicPayoutProviderFake,
    {
      provide: PAYOUT_PROVIDER_ADAPTER,
      useExisting: DeterministicPayoutProviderFake,
    },
    DeterministicPayoutDestinationVerificationFake,
    {
      provide: PAYOUT_DESTINATION_VERIFICATION_ADAPTER,
      useExisting: DeterministicPayoutDestinationVerificationFake,
    },
    UnrestrictedMemberWithdrawalRestrictionAdapter,
    {
      provide: MEMBER_WITHDRAWAL_RESTRICTION_PORT,
      useExisting: UnrestrictedMemberWithdrawalRestrictionAdapter,
    },
  ],
  exports: [
    DEPOSIT_REPOSITORY,
    PAYMENT_PROVIDER_ADAPTER,
    PAYOUT_DESTINATION_REPOSITORY,
    WITHDRAWAL_REPOSITORY,
    PAYOUT_PROVIDER_ADAPTER,
    PAYOUT_DESTINATION_VERIFICATION_ADAPTER,
    MEMBER_WITHDRAWAL_RESTRICTION_PORT,
  ],
})
export class PaymentsModule {}

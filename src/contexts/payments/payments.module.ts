import { Module } from "@nestjs/common";
import { DepositService } from "./application/deposit.service";
import { PAYMENT_PROVIDER_ADAPTER } from "./application/payment-provider.adapter";
import { DEPOSIT_REPOSITORY } from "./domain/deposit.repository";
import { PrismaDepositRepository } from "./infrastructure/prisma-deposit.repository";
import { DeterministicPaymentProviderFake } from "./infrastructure/deterministic-payment-provider.adapter";

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
  ],
  exports: [DEPOSIT_REPOSITORY, PAYMENT_PROVIDER_ADAPTER],
})
export class PaymentsModule {}

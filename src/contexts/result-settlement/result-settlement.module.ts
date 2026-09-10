import { Module } from "@nestjs/common";
import { RESULT_PROVIDER_ADAPTER } from "./domain/result-provider.adapter";
import { SETTLEMENT_REPOSITORY } from "./application/settlement.repository";
import { PrismaSettlementRepository } from "./infrastructure/prisma-settlement.repository";
import { LocalResultProviderAdapter } from "./infrastructure/local-result-provider.adapter";

@Module({
  providers: [
    PrismaSettlementRepository,
    {
      provide: SETTLEMENT_REPOSITORY,
      useExisting: PrismaSettlementRepository,
    },
    LocalResultProviderAdapter,
    {
      provide: RESULT_PROVIDER_ADAPTER,
      useExisting: LocalResultProviderAdapter,
    },
  ],
  exports: [SETTLEMENT_REPOSITORY, RESULT_PROVIDER_ADAPTER],
})
export class ResultSettlementModule {}

import { Module } from "@nestjs/common";
import { FinancialLedgerService } from "./application/financial-ledger.service";
import { FINANCIAL_LEDGER_REPOSITORY } from "./domain/financial-ledger.repository";
import { PrismaFinancialLedgerRepository } from "./infrastructure/prisma-financial-ledger.repository";

@Module({
  providers: [
    PrismaFinancialLedgerRepository,
    {
      provide: FINANCIAL_LEDGER_REPOSITORY,
      useExisting: PrismaFinancialLedgerRepository,
    },
    FinancialLedgerService,
  ],
  exports: [FinancialLedgerService],
})
export class WalletLedgerModule {}

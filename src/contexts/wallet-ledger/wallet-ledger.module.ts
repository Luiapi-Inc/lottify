import { Module } from "@nestjs/common";
import { AccountingPeriodService } from "./application/accounting-period.service";
import { FinancialLedgerService } from "./application/financial-ledger.service";
import { ACCOUNTING_PERIOD_REPOSITORY } from "./domain/accounting-period.repository";
import { FINANCIAL_LEDGER_REPOSITORY } from "./domain/financial-ledger.repository";
import { PrismaAccountingPeriodRepository } from "./infrastructure/prisma-accounting-period.repository";
import { PrismaFinancialLedgerRepository } from "./infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "./infrastructure/accounting-period-runtime";

@Module({
  providers: [
    DatabaseAccountingPeriodTransactionClock,
    PrismaAccountingPeriodRepository,
    {
      provide: ACCOUNTING_PERIOD_REPOSITORY,
      useExisting: PrismaAccountingPeriodRepository,
    },
    AccountingPeriodService,
    PrismaFinancialLedgerRepository,
    {
      provide: FINANCIAL_LEDGER_REPOSITORY,
      useExisting: PrismaFinancialLedgerRepository,
    },
    FinancialLedgerService,
  ],
  exports: [AccountingPeriodService, FinancialLedgerService],
})
export class WalletLedgerModule {}

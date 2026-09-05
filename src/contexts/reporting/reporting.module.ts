import { Module } from "@nestjs/common";
import { AccountingPeriodFinancialReportService } from "./accounting-period-financial-report.service";

@Module({
  providers: [AccountingPeriodFinancialReportService],
  exports: [AccountingPeriodFinancialReportService],
})
export class ReportingModule {}

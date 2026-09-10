import { Module } from "@nestjs/common";
import { AccountingPeriodFinancialReportService } from "./accounting-period-financial-report.service";
import { ReconciliationInspectionService } from "./reconciliation-inspection.service";

@Module({
  providers: [AccountingPeriodFinancialReportService, ReconciliationInspectionService],
  exports: [AccountingPeriodFinancialReportService, ReconciliationInspectionService],
})
export class ReportingModule {}

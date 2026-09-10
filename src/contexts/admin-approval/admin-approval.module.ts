import { Module } from "@nestjs/common";
import { AdminApprovalInspectionService } from "./admin-approval-inspection.service";

@Module({
  providers: [AdminApprovalInspectionService],
  exports: [AdminApprovalInspectionService],
})
export class AdminApprovalModule {}

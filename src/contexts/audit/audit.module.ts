import { Module } from "@nestjs/common";
import { AuditInspectionService } from "./audit-inspection.service";

@Module({
  providers: [AuditInspectionService],
  exports: [AuditInspectionService],
})
export class AuditModule {}

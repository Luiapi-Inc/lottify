import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type {
  AccountingPeriodGenerationKind,
  AccountingPeriodMode,
  AccountingPeriodState,
} from "../domain/accounting-period";
import type {
  AccountingPeriodRecord,
  AccountingPeriodRepository,
} from "../domain/accounting-period.repository";

@Injectable()
export class PrismaAccountingPeriodRepository implements AccountingPeriodRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<AccountingPeriodRecord | null> {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { id },
    });
    return period ? mapRecord(period) : null;
  }

  async list(): Promise<readonly AccountingPeriodRecord[]> {
    const periods = await this.prisma.accountingPeriod.findMany({
      orderBy: [{ effectiveStart: "desc" }, { id: "desc" }],
    });
    return periods.map(mapRecord);
  }
}

function mapRecord(period: {
  id: string;
  mode: string;
  generationKind: string;
  effectiveStart: Date;
  effectiveEnd: Date;
  state: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): AccountingPeriodRecord {
  return {
    id: period.id,
    mode: period.mode as AccountingPeriodMode,
    generationKind: period.generationKind as AccountingPeriodGenerationKind,
    effectiveStart: period.effectiveStart,
    effectiveEnd: period.effectiveEnd,
    state: period.state as AccountingPeriodState,
    version: period.version,
    createdAt: period.createdAt,
    updatedAt: period.updatedAt,
  };
}

import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ACCOUNTING_TIME_ZONE,
  type AccountingPeriodView,
} from "../domain/accounting-period";
import {
  ACCOUNTING_PERIOD_REPOSITORY,
  type AccountingPeriodRecord,
  type AccountingPeriodRepository,
} from "../domain/accounting-period.repository";

@Injectable()
export class AccountingPeriodService {
  constructor(
    @Inject(ACCOUNTING_PERIOD_REPOSITORY)
    private readonly repository: AccountingPeriodRepository,
  ) {}

  async getById(id: string): Promise<AccountingPeriodView> {
    const period = await this.repository.getById(id);
    if (!period) throw new NotFoundException("Accounting Period not found");
    return toView(period);
  }

  async list(): Promise<readonly AccountingPeriodView[]> {
    const periods = await this.repository.list();
    return periods.map(toView);
  }
}

function toView(period: AccountingPeriodRecord): AccountingPeriodView {
  return {
    ...period,
    accountingTimezone: ACCOUNTING_TIME_ZONE,
    allowedActions: [],
  };
}

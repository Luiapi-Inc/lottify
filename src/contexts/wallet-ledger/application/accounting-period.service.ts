import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AccountingPeriodRuleError,
  ACCOUNTING_TIME_ZONE,
  normalizeBangkokCalendarDate,
  type AccountingPeriodAllowedAction,
  type AccountingPeriodCommandResult,
  type AccountingPeriodView,
} from "../domain/accounting-period";
import {
  ACCOUNTING_PERIOD_REPOSITORY,
  type AccountingPeriodRecord,
  type AccountingPeriodRepository,
} from "../domain/accounting-period.repository";

interface AccountingPeriodViewOptions {
  canSubmit?: boolean;
  canApprove?: boolean;
  actorAdminId?: string;
  canSelfApprove?: boolean;
}

@Injectable()
export class AccountingPeriodService {
  constructor(
    @Inject(ACCOUNTING_PERIOD_REPOSITORY)
    private readonly repository: AccountingPeriodRepository,
  ) {}

  async getById(
    id: string,
    options: AccountingPeriodViewOptions = {},
  ): Promise<AccountingPeriodView> {
    const period = await this.repository.getById(id);
    if (!period) throw new NotFoundException("Accounting Period not found");
    return toView(period, options);
  }

  async list(options: AccountingPeriodViewOptions = {}): Promise<readonly AccountingPeriodView[]> {
    const periods = await this.repository.list();
    return periods.map((period) => toView(period, options));
  }

  async ensureAutomaticCoverage(): Promise<void> {
    await this.repository.ensureAutomaticCoverage();
  }

  async createCustom(input: {
    startDate: string;
    endDate: string;
    reason: string;
    createdByAdminId: string;
  }): Promise<AccountingPeriodCommandResult> {
    const reason = input.reason.trim();
    if (!reason) {
      throw new AccountingPeriodRuleError(
        "VALIDATION_ERROR",
        "Custom Accounting Period reason is required",
        { field: "reason" },
      );
    }

    const effectiveStart = parseCalendarDate("startDate", input.startDate);
    const effectiveEnd = parseCalendarDate("endDate", input.endDate);
    if (effectiveEnd.getTime() <= effectiveStart.getTime()) {
      throw new AccountingPeriodRuleError(
        "VALIDATION_ERROR",
        "Custom Accounting Period end date must be after start date",
        { field: "endDate" },
      );
    }

    const result = await this.repository.createCustom({
      effectiveStart,
      effectiveEnd,
      reason,
      createdByAdminId: input.createdByAdminId,
    });
    return {
      period: toView(result.period, { canSubmit: true }),
      replacementPreview: result.replacementPreview,
    };
  }

  async submitCustom(input: {
    id: string;
    expectedVersion: number;
  }): Promise<AccountingPeriodCommandResult> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new AccountingPeriodRuleError(
        "VALIDATION_ERROR",
        "expectedVersion must be a positive integer",
        { field: "expectedVersion" },
      );
    }
    const result = await this.repository.submitCustom(input);
    return {
      period: toView(result.period, { canSubmit: true }),
      replacementPreview: result.replacementPreview,
    };
  }
}

function toView(
  period: AccountingPeriodRecord,
  options: AccountingPeriodViewOptions,
): AccountingPeriodView {
  const allowedActions: AccountingPeriodAllowedAction[] = [];
  if (options.canSubmit === true && period.state === "DRAFT") {
    allowedActions.push("submit");
  }
  if (
    options.canApprove === true &&
    period.state === "PENDING_APPROVAL" &&
    (options.canSelfApprove === true || period.createdByAdminId !== options.actorAdminId)
  ) {
    allowedActions.push("approve");
  }
  return {
    ...period,
    accountingTimezone: ACCOUNTING_TIME_ZONE,
    allowedActions,
  };
}

function parseCalendarDate(field: "startDate" | "endDate", value: string): Date {
  try {
    return normalizeBangkokCalendarDate(value);
  } catch (error) {
    throw new AccountingPeriodRuleError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Invalid Accounting Period date",
      { field },
    );
  }
}

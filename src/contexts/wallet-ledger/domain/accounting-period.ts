export const ACCOUNTING_TIME_ZONE = "Asia/Bangkok" as const;

export const ACCOUNTING_PERIOD_MODES = ["AUTOMATIC_WEEKLY", "CUSTOM"] as const;
export const ACCOUNTING_PERIOD_GENERATION_KINDS = [
  "NOMINAL_WEEK",
  "DERIVED_FRAGMENT",
  "CUSTOM",
] as const;
export const ACCOUNTING_PERIOD_STATES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SCHEDULED",
  "OPEN",
  "CLOSING",
  "CLOSED",
  "CANCELLED",
] as const;

export type AccountingPeriodMode = (typeof ACCOUNTING_PERIOD_MODES)[number];
export type AccountingPeriodGenerationKind =
  (typeof ACCOUNTING_PERIOD_GENERATION_KINDS)[number];
export type AccountingPeriodState = (typeof ACCOUNTING_PERIOD_STATES)[number];

const BANGKOK_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1_000;
const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export interface AccountingPeriodBounds {
  start: Date;
  end: Date;
}

export interface AccountingPeriodView {
  id: string;
  mode: AccountingPeriodMode;
  generationKind: AccountingPeriodGenerationKind;
  effectiveStart: Date;
  effectiveEnd: Date;
  accountingTimezone: typeof ACCOUNTING_TIME_ZONE;
  state: AccountingPeriodState;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  allowedActions: readonly string[];
}

export function automaticWeeklyAccountingPeriodBounds(instant: Date): AccountingPeriodBounds {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Accounting Period instant must be a valid Date");
  }

  const bangkok = new Date(instant.getTime() + BANGKOK_UTC_OFFSET_MILLISECONDS);
  const daysSinceMonday = (bangkok.getUTCDay() + 6) % 7;
  const startLocalMidnightUtc = Date.UTC(
    bangkok.getUTCFullYear(),
    bangkok.getUTCMonth(),
    bangkok.getUTCDate() - daysSinceMonday,
  );
  const start = new Date(startLocalMidnightUtc - BANGKOK_UTC_OFFSET_MILLISECONDS);

  return { start, end: new Date(start.getTime() + WEEK_MILLISECONDS) };
}

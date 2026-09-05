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
export const ACCOUNTING_PERIOD_ALLOWED_ACTIONS = [
  "submit",
  "approve",
  "cancel",
  "close",
] as const;
export type AccountingPeriodAllowedAction =
  (typeof ACCOUNTING_PERIOD_ALLOWED_ACTIONS)[number];

const BANGKOK_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1_000;
const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export interface AccountingPeriodBounds {
  start: Date;
  end: Date;
}

export interface AccountingPeriodCloseEvidenceView {
  closedAt: Date;
  approvalId: string;
  reconciliationReferences: readonly string[];
  checkpointReferences: readonly string[];
  blockingDiscrepancyReferences: readonly string[];
  acceptedExceptionReferences: readonly AccountingPeriodAcceptedExceptionReference[];
  actorAdminId: string;
  auditRecordId: string;
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
  reason: string | null;
  createdByAdminId: string | null;
  activationApprovalId: string | null;
  cancellationRequestedByAdminId: string | null;
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  closeRequestedByAdminId: string | null;
  closeReason: string | null;
  closeRequestedAt: Date | null;
  closeReconciliationReferences: readonly string[] | null;
  closeCheckpointReferences: readonly string[] | null;
  closeBlockingDiscrepancyReferences: readonly string[] | null;
  closeAcceptedExceptionReferences: readonly AccountingPeriodAcceptedExceptionReference[] | null;
  closeEvidence: AccountingPeriodCloseEvidenceView | null;
  createdAt: Date;
  updatedAt: Date;
  allowedActions: readonly AccountingPeriodAllowedAction[];
}

export interface AccountingPeriodReplacementPreviewPeriod {
  id: string | null;
  effectiveStart: Date;
  effectiveEnd: Date;
  generationKind: "NOMINAL_WEEK";
}

export interface AccountingPeriodResidualFragment {
  sourcePeriodId: string | null;
  effectiveStart: Date;
  effectiveEnd: Date;
  generationKind: "DERIVED_FRAGMENT";
}

export interface AccountingPeriodReplacementPreview {
  affectedAutomaticPeriods: readonly AccountingPeriodReplacementPreviewPeriod[];
  residualFragments: readonly AccountingPeriodResidualFragment[];
}

export interface AccountingPeriodCommandResult {
  period: AccountingPeriodView;
  replacementPreview: AccountingPeriodReplacementPreview;
}

export interface AccountingPeriodAcceptedExceptionReference {
  discrepancyReference: string;
  exceptionReference: string;
}

export type AccountingPeriodRuleErrorCode =
  | "VALIDATION_ERROR"
  | "ACCOUNTING_PERIOD_NOT_FOUND"
  | "ACCOUNTING_PERIOD_NOT_FUTURE"
  | "ACCOUNTING_PERIOD_COVERAGE_CONFLICT"
  | "ACCOUNTING_PERIOD_STATE_CONFLICT"
  | "ACCOUNTING_PERIOD_SELF_APPROVAL_FORBIDDEN"
  | "ACCOUNTING_PERIOD_CANCELLATION_FORBIDDEN"
  | "ACCOUNTING_PERIOD_CLOSE_BLOCKED"
  | "ACCOUNTING_PERIOD_START_ELAPSED"
  | "VERSION_CONFLICT";

export class AccountingPeriodRuleError extends Error {
  constructor(
    readonly code: AccountingPeriodRuleErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AccountingPeriodRuleError";
  }
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

export function normalizeBangkokCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("Accounting Period date must use YYYY-MM-DD");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localMidnightUtc = Date.UTC(year, month - 1, day);
  const validation = new Date(localMidnightUtc);
  if (
    validation.getUTCFullYear() !== year ||
    validation.getUTCMonth() !== month - 1 ||
    validation.getUTCDate() !== day
  ) {
    throw new Error("Accounting Period date is not a valid calendar date");
  }

  return new Date(localMidnightUtc - BANGKOK_UTC_OFFSET_MILLISECONDS);
}

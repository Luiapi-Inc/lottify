import type {
  AccountingPeriodGenerationKind,
  AccountingPeriodMode,
  AccountingPeriodReplacementPreview,
  AccountingPeriodState,
} from "./accounting-period";

export interface AccountingPeriodRecord {
  id: string;
  mode: AccountingPeriodMode;
  generationKind: AccountingPeriodGenerationKind;
  effectiveStart: Date;
  effectiveEnd: Date;
  state: AccountingPeriodState;
  version: number;
  reason: string | null;
  createdByAdminId: string | null;
  cancellationRequestedByAdminId: string | null;
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountingPeriodCustomCommandRecord {
  period: AccountingPeriodRecord;
  replacementPreview: AccountingPeriodReplacementPreview;
}

export interface AccountingPeriodRepository {
  getById(id: string): Promise<AccountingPeriodRecord | null>;
  list(): Promise<readonly AccountingPeriodRecord[]>;
  ensureAutomaticCoverage(): Promise<void>;
  createCustom(input: {
    effectiveStart: Date;
    effectiveEnd: Date;
    reason: string;
    createdByAdminId: string;
  }): Promise<AccountingPeriodCustomCommandRecord>;
  submitCustom(input: {
    id: string;
    expectedVersion: number;
  }): Promise<AccountingPeriodCustomCommandRecord>;
}

export const ACCOUNTING_PERIOD_REPOSITORY = Symbol("ACCOUNTING_PERIOD_REPOSITORY");

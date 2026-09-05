import type {
  AccountingPeriodGenerationKind,
  AccountingPeriodMode,
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
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountingPeriodRepository {
  getById(id: string): Promise<AccountingPeriodRecord | null>;
  list(): Promise<readonly AccountingPeriodRecord[]>;
  ensureAutomaticCoverage(): Promise<void>;
}

export const ACCOUNTING_PERIOD_REPOSITORY = Symbol("ACCOUNTING_PERIOD_REPOSITORY");

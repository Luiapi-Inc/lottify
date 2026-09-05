import type {
  AccountingPeriodCloseEvidenceView,
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
  closeAcceptedExceptionReferences: readonly {
    discrepancyReference: string;
    exceptionReference: string;
  }[] | null;
  closeEvidence: AccountingPeriodCloseEvidenceView | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountingPeriodListCursor {
  effectiveStart: Date;
  id: string;
}

export interface AccountingPeriodListQuery {
  limit: number;
  cursor?: AccountingPeriodListCursor;
  state?: AccountingPeriodState;
  mode?: AccountingPeriodMode;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

export interface AccountingPeriodListResult {
  items: readonly AccountingPeriodRecord[];
  nextCursor: AccountingPeriodListCursor | null;
}

export interface AccountingPeriodCustomCommandRecord {
  period: AccountingPeriodRecord;
  replacementPreview: AccountingPeriodReplacementPreview;
}

export interface AccountingPeriodRepository {
  getById(id: string): Promise<AccountingPeriodRecord | null>;
  list(query: AccountingPeriodListQuery): Promise<AccountingPeriodListResult>;
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

import type {
  ReconciliationCurrency,
  ReconciliationMemberBucket,
} from "./ledger-wallet-projection.port";

export interface ReconciliationSourceBucketSnapshot {
  bucket: ReconciliationMemberBucket;
  accountId: string | null;
  postedMinor: bigint;
  reservedMinor: bigint;
}

export interface ReconciliationSourceSnapshot {
  memberId: string;
  currency: ReconciliationCurrency;
  asOf: Date;
  buckets: readonly ReconciliationSourceBucketSnapshot[];
  ledgerAccountCount: number;
  ledgerPostingCount: number;
  activeReservationAllocationCount: number;
  latestLedgerPosting: { id: string; postedAt: Date } | null;
  latestReservation: { id: string; createdAt: Date } | null;
}

export interface LedgerWalletSourcePort {
  getReconciliationSourceSnapshot(
    memberId: string,
    currency: ReconciliationCurrency,
    asOf: Date,
  ): Promise<ReconciliationSourceSnapshot>;
}

export const LEDGER_WALLET_SOURCE_PORT = Symbol("REPORTING_LEDGER_WALLET_SOURCE_PORT");

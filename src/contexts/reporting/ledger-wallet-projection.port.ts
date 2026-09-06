export const RECONCILIATION_MEMBER_BUCKETS = ["CASH", "BONUS", "LOCKED"] as const;

export type ReconciliationMemberBucket = (typeof RECONCILIATION_MEMBER_BUCKETS)[number];
export type ReconciliationCurrency = "THB";

export interface ReconciliationWalletBucketProjection {
  bucket: ReconciliationMemberBucket;
  postedMinor: bigint;
  reservedMinor: bigint;
  availableMinor: bigint;
}

export interface ReconciliationWalletProjection {
  memberId: string;
  currency: ReconciliationCurrency;
  dataAsOf: Date;
  buckets: readonly ReconciliationWalletBucketProjection[];
}

export interface LedgerWalletProjectionPort {
  getWalletProjection(
    memberId: string,
    currency: ReconciliationCurrency,
  ): Promise<ReconciliationWalletProjection>;
}

export const LEDGER_WALLET_PROJECTION_PORT = Symbol("REPORTING_LEDGER_WALLET_PROJECTION_PORT");

import type {
  FinancialCurrency,
  LedgerPostingSide,
  MemberLedgerBucket,
} from "./financial-invariants";

export const RESERVATION_PURPOSES = ["BET", "WITHDRAWAL"] as const;

export type ReservationPurpose = (typeof RESERVATION_PURPOSES)[number];

export type FinancialCorrectionKind = "REVERSAL" | "COMPENSATION";

export interface FinancialIdempotencyIdentity {
  scope: string;
  key: string;
  fingerprint: string;
}

export interface FinancialPostingRequest {
  accountId: string;
  side: LedgerPostingSide;
  amountMinor: bigint;
}

export interface PostFinancialTransactionInput {
  businessTransactionId: string;
  operationType: string;
  correlationId: string;
  idempotency: FinancialIdempotencyIdentity;
  domainReferences: Readonly<Record<string, string>>;
  currency: FinancialCurrency;
  effectiveAt: Date;
  correction?: {
    kind: "COMPENSATION";
    correctsTransactionId: string;
  };
  postings: readonly FinancialPostingRequest[];
}

export interface ReverseFinancialTransactionInput {
  originalTransactionId: string;
  businessTransactionId: string;
  operationType: string;
  correlationId: string;
  idempotency: FinancialIdempotencyIdentity;
  domainReferences: Readonly<Record<string, string>>;
  effectiveAt: Date;
}

export interface ReservationAllocationRequest {
  accountId: string;
  amountMinor: bigint;
}

export interface ReserveFundsInput {
  purpose: ReservationPurpose;
  businessReference: string;
  memberId: string;
  currency: FinancialCurrency;
  amountMinor: bigint;
  correlationId: string;
  idempotency: FinancialIdempotencyIdentity;
  allocations: readonly ReservationAllocationRequest[];
}

export interface ReservationConsumptionDestinationRequest {
  accountId: string;
  amountMinor: bigint;
}

export interface WalletBucketProjection {
  bucket: MemberLedgerBucket;
  postedMinor: bigint;
  reservedMinor: bigint;
  availableMinor: bigint;
}

export interface WalletProjection {
  memberId: string;
  currency: FinancialCurrency;
  dataAsOf: Date;
  buckets: readonly WalletBucketProjection[];
}

export interface ReconciliationSourceBucketSnapshot {
  bucket: MemberLedgerBucket;
  accountId: string | null;
  postedMinor: bigint;
  reservedMinor: bigint;
}

export interface ReconciliationSourceSnapshot {
  memberId: string;
  currency: FinancialCurrency;
  asOf: Date;
  buckets: readonly ReconciliationSourceBucketSnapshot[];
  ledgerAccountCount: number;
  ledgerPostingCount: number;
  activeReservationAllocationCount: number;
  latestLedgerPosting: { id: string; postedAt: Date } | null;
  latestReservation: { id: string; createdAt: Date } | null;
}

export interface ConsumeReservationAndPostInput {
  reservationId: string;
  businessTransactionId: string;
  operationType: string;
  correlationId: string;
  idempotency: FinancialIdempotencyIdentity;
  domainReferences: Readonly<Record<string, string>>;
  currency: FinancialCurrency;
  effectiveAt: Date;
  destinations: readonly ReservationConsumptionDestinationRequest[];
}

export interface FinancialLedgerRepository {
  ensureMemberAccount(input: {
    memberId: string;
    bucket: MemberLedgerBucket;
    currency: FinancialCurrency;
  }): Promise<string>;
  ensureSystemAccount(input: {
    systemCode: string;
    currency: FinancialCurrency;
  }): Promise<string>;
  post(input: PostFinancialTransactionInput): Promise<string>;
  reverseTransaction(input: ReverseFinancialTransactionInput): Promise<string>;
  reserve(input: ReserveFundsInput): Promise<string>;
  releaseReservation(reservationId: string): Promise<Date>;
  consumeReservationAndPost(input: ConsumeReservationAndPostInput): Promise<string>;
  getAvailableMinorUnits(accountId: string): Promise<bigint>;
  getWalletProjection(memberId: string, currency: FinancialCurrency): Promise<WalletProjection>;
  getReconciliationSourceSnapshot(
    memberId: string,
    currency: FinancialCurrency,
    asOf: Date,
  ): Promise<ReconciliationSourceSnapshot>;
}

export const FINANCIAL_LEDGER_REPOSITORY = Symbol("FINANCIAL_LEDGER_REPOSITORY");

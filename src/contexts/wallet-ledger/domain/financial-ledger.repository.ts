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
    kind: FinancialCorrectionKind;
    correctsTransactionId: string;
  };
  postings: readonly FinancialPostingRequest[];
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
  reserve(input: ReserveFundsInput): Promise<string>;
  releaseReservation(reservationId: string): Promise<Date>;
  getAvailableMinorUnits(accountId: string): Promise<bigint>;
}

export const FINANCIAL_LEDGER_REPOSITORY = Symbol("FINANCIAL_LEDGER_REPOSITORY");

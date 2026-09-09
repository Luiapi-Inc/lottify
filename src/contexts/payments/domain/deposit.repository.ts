import type { Deposit, DepositStatus } from "./deposit";

export interface CreateDepositInput {
  id: string;
  memberId: string;
  providerId: string;
  providerCode: string;
  methodCode: string;
  amountMinor: bigint;
  currency: Deposit["currency"];
  idempotencyScope: string;
  idempotencyKey: string;
  fingerprint: string;
  providerReferenceKey: string;
  correlationId: string;
}

export interface ResolveDepositInput {
  providerTransactionId?: string | null;
  status: DepositStatus;
  incomingProviderError?: string | null;
}

export interface DepositRepository {
  create(input: CreateDepositInput): Promise<Deposit | null>;
  findById(id: string): Promise<Deposit | null>;
  findByIdempotency(scope: string, key: string): Promise<Deposit | null>;
  resolve(id: string, input: ResolveDepositInput): Promise<Deposit>;
  markCredited(id: string, ledgerTransactionId: string): Promise<Deposit>;
}

export const DEPOSIT_REPOSITORY = Symbol("DEPOSIT_REPOSITORY");
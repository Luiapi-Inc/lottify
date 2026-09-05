import { Inject, Injectable } from "@nestjs/common";
import {
  FINANCIAL_LEDGER_REPOSITORY,
  type ConsumeReservationAndPostInput,
  type FinancialLedgerRepository,
  type PostFinancialTransactionInput,
  type ReserveFundsInput,
  type WalletProjection,
} from "../domain/financial-ledger.repository";
import type { FinancialCurrency, MemberLedgerBucket } from "../domain/financial-invariants";

@Injectable()
export class FinancialLedgerService {
  constructor(
    @Inject(FINANCIAL_LEDGER_REPOSITORY)
    private readonly repository: FinancialLedgerRepository,
  ) {}

  ensureMemberAccount(
    memberId: string,
    bucket: MemberLedgerBucket,
    currency: FinancialCurrency = "THB",
  ): Promise<string> {
    return this.repository.ensureMemberAccount({ memberId, bucket, currency });
  }

  ensureSystemAccount(
    systemCode: string,
    currency: FinancialCurrency = "THB",
  ): Promise<string> {
    return this.repository.ensureSystemAccount({ systemCode, currency });
  }

  post(input: PostFinancialTransactionInput): Promise<string> {
    return this.repository.post(input);
  }

  reserve(input: ReserveFundsInput): Promise<string> {
    return this.repository.reserve(input);
  }

  releaseReservation(reservationId: string): Promise<Date> {
    return this.repository.releaseReservation(reservationId);
  }

  consumeReservationAndPost(input: ConsumeReservationAndPostInput): Promise<string> {
    return this.repository.consumeReservationAndPost(input);
  }

  getAvailableMinorUnits(accountId: string): Promise<bigint> {
    return this.repository.getAvailableMinorUnits(accountId);
  }

  getWalletProjection(
    memberId: string,
    currency: FinancialCurrency = "THB",
  ): Promise<WalletProjection> {
    return this.repository.getWalletProjection(memberId, currency);
  }
}

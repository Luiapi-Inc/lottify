import { Inject, Injectable } from "@nestjs/common";
import { FinancialLedgerService } from "./financial-ledger.service";
import type {
  MemberLedgerTransactionPage,
  WalletProjection,
} from "../domain/financial-ledger.repository";
import type { FinancialCurrency } from "../domain/financial-invariants";

@Injectable()
export class MemberWalletService {
  constructor(
    @Inject(FinancialLedgerService)
    private readonly ledger: FinancialLedgerService,
  ) {}

  /**
   * Member-facing Wallet balance read. Values are a projection of the
   * authoritative Ledger plus active Reservations; buckets are the bounded
   * CASH/BONUS/LOCKED set and never include fabricated entries.
   */
  getBalance(memberId: string, currency: FinancialCurrency = "THB"): Promise<WalletProjection> {
    return this.ledger.getWalletProjection(memberId, currency);
  }

  listTransactions(
    memberId: string,
    input: { limit?: number; cursor?: string | null },
  ): Promise<MemberLedgerTransactionPage> {
    const limit = Number.isInteger(input.limit) ? (input.limit as number) : 20;
    return this.ledger.listMemberTransactions({
      memberId,
      currency: "THB",
      afterCursor: input.cursor ?? null,
      limit,
    });
  }
}
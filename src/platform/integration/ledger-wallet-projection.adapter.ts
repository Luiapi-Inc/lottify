import { Injectable } from "@nestjs/common";
import type {
  LedgerWalletProjectionPort,
  ReconciliationCurrency,
  ReconciliationWalletProjection,
} from "../../contexts/reporting/ledger-wallet-projection.port";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";

@Injectable()
export class LedgerWalletProjectionAdapter implements LedgerWalletProjectionPort {
  constructor(private readonly ledger: FinancialLedgerService) {}

  getWalletProjection(
    memberId: string,
    currency: ReconciliationCurrency,
  ): Promise<ReconciliationWalletProjection> {
    return this.ledger.getWalletProjection(memberId, currency);
  }
}

import { Injectable } from "@nestjs/common";
import type {
  LedgerWalletSourcePort,
  ReconciliationSourceSnapshot,
} from "../../contexts/reporting/ledger-wallet-source.port";
import type { ReconciliationCurrency } from "../../contexts/reporting/ledger-wallet-projection.port";
import { FinancialLedgerService } from "../../contexts/wallet-ledger/application/financial-ledger.service";

@Injectable()
export class LedgerWalletSourceAdapter implements LedgerWalletSourcePort {
  constructor(private readonly ledger: FinancialLedgerService) {}

  getReconciliationSourceSnapshot(
    memberId: string,
    currency: ReconciliationCurrency,
    asOf: Date,
  ): Promise<ReconciliationSourceSnapshot> {
    return this.ledger.getReconciliationSourceSnapshot(memberId, currency, asOf);
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { AccountingPeriodService } from "../../../src/contexts/wallet-ledger/application/accounting-period.service";

const ACCOUNTING_PERIOD_SCHEDULER_INTERVAL_MS = 60_000;

@Injectable()
export class AccountingPeriodScheduler {
  private readonly logger = new Logger(AccountingPeriodScheduler.name);
  private stopped = false;
  private wake?: () => void;

  constructor(private readonly accountingPeriods: AccountingPeriodService) {}

  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.accountingPeriods.ensureAutomaticCoverage();
      } catch (error) {
        this.logger.error(
          "Automatic Accounting Period coverage maintenance failed",
          error instanceof Error ? error.stack : String(error),
        );
      }
      await this.waitForNextRun();
    }
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  private waitForNextRun(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, ACCOUNTING_PERIOD_SCHEDULER_INTERVAL_MS);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }
}

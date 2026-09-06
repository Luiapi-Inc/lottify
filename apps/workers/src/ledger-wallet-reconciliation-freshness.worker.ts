import { Inject, Injectable, Logger } from "@nestjs/common";
import { LedgerWalletReconciliationService } from "../../../src/contexts/reporting/ledger-wallet-reconciliation.service";
import { FinancialLedgerService } from "../../../src/contexts/wallet-ledger/application/financial-ledger.service";
import {
  OPERATIONAL_ALERT_SINK,
  type OperationalAlertSink,
} from "./operational-alert.sink";

export const LEDGER_WALLET_FRESHNESS_INTERVAL_MS = 30_000;
export const LEDGER_WALLET_STALE_DISCREPANCY_MS = 15 * 60_000;
export const LEDGER_WALLET_TARGET_PAGE_SIZE = 100;
export const LEDGER_WALLET_TARGET_CONCURRENCY = 10;

@Injectable()
export class LedgerWalletReconciliationFreshnessWorker {
  private readonly logger = new Logger(LedgerWalletReconciliationFreshnessWorker.name);
  private stopped = false;
  private wake?: () => void;

  constructor(
    private readonly ledger: FinancialLedgerService,
    private readonly reconciliation: LedgerWalletReconciliationService,
    @Inject(OPERATIONAL_ALERT_SINK)
    private readonly alerts: OperationalAlertSink,
  ) {}

  async run(): Promise<void> {
    while (!this.stopped) {
      const cycleStartedAt = new Date();
      try {
        await this.runCycle(cycleStartedAt);
      } catch (error) {
        this.logger.error(
          "Ledger-Wallet reconciliation freshness cycle failed",
          error instanceof Error ? error.stack : String(error),
        );
      }

      const elapsedMs = Date.now() - cycleStartedAt.getTime();
      if (elapsedMs > LEDGER_WALLET_FRESHNESS_INTERVAL_MS * 2) {
        this.alerts.emit({
          code: "LEDGER_WALLET_FRESHNESS_SLO_BREACH",
          severity: "CRITICAL",
          message: "Ledger-Wallet reconciliation freshness cycle exceeded the 1-minute SLO",
          occurredAt: new Date(),
          fingerprint: ["LEDGER_WALLET_FRESHNESS_SLO_BREACH"],
          details: { elapsedMs },
        });
      }
      await this.waitForNextRun(Math.max(0, LEDGER_WALLET_FRESHNESS_INTERVAL_MS - elapsedMs));
    }
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  async runCycle(now: Date): Promise<void> {
    let afterMemberId: string | undefined;

    do {
      const page = await this.ledger.listReconciliationTargets({
        currency: "THB",
        afterMemberId,
        limit: LEDGER_WALLET_TARGET_PAGE_SIZE,
      });

      for (let offset = 0; offset < page.targets.length; offset += LEDGER_WALLET_TARGET_CONCURRENCY) {
        const batch = page.targets.slice(offset, offset + LEDGER_WALLET_TARGET_CONCURRENCY);
        await Promise.all(
          batch.map(async (target) => {
            const result = await this.reconciliation.run({
              checkpointKey: ledgerWalletFreshnessCheckpointKey(now, target.memberId, target.currency),
              memberId: target.memberId,
              currency: target.currency,
            });
            if (result.result === "MISMATCH") {
              this.alerts.emit({
                code: "LEDGER_WALLET_MISMATCH",
                severity: "ERROR",
                message: "Ledger-Wallet reconciliation detected a projection mismatch",
                occurredAt: now,
                fingerprint: ["LEDGER_WALLET_MISMATCH", result.id],
                details: {
                  reconciliationRunId: result.id,
                  memberId: result.memberId,
                  currency: result.currency,
                  checkpointKey: result.checkpointKey,
                  discrepancyCount: result.discrepancyCount,
                },
              });
            }
          }),
        );
      }

      afterMemberId = page.nextCursor ?? undefined;
    } while (afterMemberId);

    const summary = await this.reconciliation.getOperationalAlertSummary(
      new Date(now.getTime() - LEDGER_WALLET_STALE_DISCREPANCY_MS),
    );
    if (summary.staleMonetary) {
      this.alerts.emit({
        code: "RECONCILIATION_MONETARY_DISCREPANCY_STALE",
        severity: "ERROR",
        message: "Unresolved monetary reconciliation discrepancies exceeded 15 minutes",
        occurredAt: now,
        fingerprint: [
          "RECONCILIATION_MONETARY_DISCREPANCY_STALE",
          summary.staleMonetary.oldestDiscrepancyId,
        ],
        details: {
          count: summary.staleMonetary.count,
          oldestDiscrepancyId: summary.staleMonetary.oldestDiscrepancyId,
          oldestDetectedAt: summary.staleMonetary.oldestDetectedAt.toISOString(),
        },
      });
    }
    if (summary.critical) {
      this.alerts.emit({
        code: "RECONCILIATION_CRITICAL_DISCREPANCY",
        severity: "CRITICAL",
        message: "Critical reconciliation discrepancies require immediate escalation",
        occurredAt: now,
        fingerprint: ["RECONCILIATION_CRITICAL_DISCREPANCY", summary.critical.oldestDiscrepancyId],
        details: {
          count: summary.critical.count,
          oldestDiscrepancyId: summary.critical.oldestDiscrepancyId,
          oldestDetectedAt: summary.critical.oldestDetectedAt.toISOString(),
        },
      });
    }
  }

  private waitForNextRun(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, delayMs);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }
}

export function ledgerWalletFreshnessCheckpointKey(
  now: Date,
  memberId: string,
  currency: string,
): string {
  const freshnessWindow = Math.floor(now.getTime() / LEDGER_WALLET_FRESHNESS_INTERVAL_MS);
  return `ledger-wallet:freshness:${freshnessWindow}:${memberId}:${currency}`;
}

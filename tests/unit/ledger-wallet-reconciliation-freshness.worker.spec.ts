import { describe, expect, it, vi } from "vitest";
import {
  LEDGER_WALLET_FRESHNESS_INTERVAL_MS,
  LedgerWalletReconciliationFreshnessWorker,
  ledgerWalletFreshnessCheckpointKey,
} from "../../apps/workers/src/ledger-wallet-reconciliation-freshness.worker";
import type { OperationalAlert, OperationalAlertSink } from "../../apps/workers/src/operational-alert.sink";
import type { LedgerWalletReconciliationService } from "../../src/contexts/reporting/ledger-wallet-reconciliation.service";
import type { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";

describe("Ledger-Wallet reconciliation freshness worker", () => {
  it("uses a sub-minute deterministic checkpoint window and emits mismatch/stale/critical alerts", async () => {
    const now = new Date("2026-09-06T10:00:29.000Z");
    const nextWindow = new Date(now.getTime() + LEDGER_WALLET_FRESHNESS_INTERVAL_MS);
    const memberIds = [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ] as const;
    const listReconciliationTargets = vi
      .fn()
      .mockResolvedValueOnce({
        targets: [
          { memberId: memberIds[0], currency: "THB", sourceVersionAt: now },
          { memberId: memberIds[1], currency: "THB", sourceVersionAt: now },
        ],
        nextCursor: null,
      });
    const run = vi.fn(async (input: { checkpointKey: string; memberId: string; currency: "THB" }) => ({
      id: `run-${input.memberId}`,
      checkpointKey: input.checkpointKey,
      memberId: input.memberId,
      currency: input.currency,
      asOf: now,
      result: input.memberId === memberIds[1] ? ("MISMATCH" as const) : ("MATCHED" as const),
      discrepancyCount: input.memberId === memberIds[1] ? 1 : 0,
    }));
    const staleDetectedAt = new Date(now.getTime() - 16 * 60_000);
    const getOperationalAlertSummary = vi.fn().mockResolvedValue({
      staleMonetary: {
        count: 2,
        oldestDiscrepancyId: "stale-discrepancy",
        oldestDetectedAt: staleDetectedAt,
      },
      critical: {
        count: 1,
        oldestDiscrepancyId: "critical-discrepancy",
        oldestDetectedAt: now,
      },
    });
    const emitted: OperationalAlert[] = [];
    const alerts: OperationalAlertSink = { emit: (alert) => emitted.push(alert) };
    const worker = new LedgerWalletReconciliationFreshnessWorker(
      { listReconciliationTargets } as unknown as FinancialLedgerService,
      { run, getOperationalAlertSummary } as unknown as LedgerWalletReconciliationService,
      alerts,
    );

    await worker.runCycle(now);

    expect(LEDGER_WALLET_FRESHNESS_INTERVAL_MS).toBeLessThan(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].checkpointKey).toBe(
      ledgerWalletFreshnessCheckpointKey(now, memberIds[1], "THB"),
    );
    expect(
      ledgerWalletFreshnessCheckpointKey(now, memberIds[1], "THB"),
    ).not.toBe(ledgerWalletFreshnessCheckpointKey(nextWindow, memberIds[1], "THB"));
    expect(getOperationalAlertSummary).toHaveBeenCalledWith(
      new Date(now.getTime() - 15 * 60_000),
    );
    expect(emitted.map((alert) => alert.code)).toEqual([
      "LEDGER_WALLET_MISMATCH",
      "RECONCILIATION_MONETARY_DISCREPANCY_STALE",
      "RECONCILIATION_CRITICAL_DISCREPANCY",
    ]);
    expect(emitted[0]).toMatchObject({
      severity: "ERROR",
      occurredAt: now,
      details: { memberId: memberIds[1], discrepancyCount: 1 },
    });
    expect(emitted[2]).toMatchObject({ severity: "CRITICAL", occurredAt: now });
  });
});

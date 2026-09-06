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

  it("walks every target page and keeps checkpoint identity stable across a retry", async () => {
    const now = new Date("2026-09-06T10:00:29.000Z");
    const memberIds = [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
    ] as const;
    const listReconciliationTargets = vi
      .fn()
      .mockResolvedValueOnce({
        targets: [{ memberId: memberIds[0], currency: "THB", sourceVersionAt: now }],
        nextCursor: memberIds[0],
      })
      .mockResolvedValueOnce({
        targets: [
          { memberId: memberIds[1], currency: "THB", sourceVersionAt: now },
          { memberId: memberIds[2], currency: "THB", sourceVersionAt: now },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        targets: [{ memberId: memberIds[0], currency: "THB", sourceVersionAt: now }],
        nextCursor: memberIds[0],
      })
      .mockResolvedValueOnce({
        targets: [
          { memberId: memberIds[1], currency: "THB", sourceVersionAt: now },
          { memberId: memberIds[2], currency: "THB", sourceVersionAt: now },
        ],
        nextCursor: null,
      });
    const run = vi.fn().mockResolvedValue({
      id: "run-id",
      checkpointKey: "unused",
      memberId: memberIds[0],
      currency: "THB",
      asOf: now,
      result: "MATCHED",
      discrepancyCount: 0,
    });
    const getOperationalAlertSummary = vi.fn().mockResolvedValue({
      staleMonetary: null,
      critical: null,
    });
    const alerts: OperationalAlertSink = { emit: vi.fn() };
    const worker = new LedgerWalletReconciliationFreshnessWorker(
      { listReconciliationTargets } as unknown as FinancialLedgerService,
      { run, getOperationalAlertSummary } as unknown as LedgerWalletReconciliationService,
      alerts,
    );

    await worker.runCycle(now);
    await worker.runCycle(now);

    expect(listReconciliationTargets).toHaveBeenNthCalledWith(1, {
      currency: "THB",
      afterMemberId: undefined,
      limit: 100,
    });
    expect(listReconciliationTargets).toHaveBeenNthCalledWith(2, {
      currency: "THB",
      afterMemberId: memberIds[0],
      limit: 100,
    });
    expect(listReconciliationTargets).toHaveBeenCalledTimes(4);
    expect(run).toHaveBeenCalledTimes(6);

    const firstRunKeys = run.mock.calls.slice(0, 3).map(([input]) => input.checkpointKey);
    const retryRunKeys = run.mock.calls.slice(3).map(([input]) => input.checkpointKey);
    expect(retryRunKeys).toEqual(firstRunKeys);
    expect(new Set(firstRunKeys)).toEqual(
      new Set(memberIds.map((memberId) => ledgerWalletFreshnessCheckpointKey(now, memberId, "THB"))),
    );
  });
});

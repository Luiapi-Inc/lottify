import { describe, expect, it } from "vitest";
import {
  ACCOUNTING_TIME_ZONE,
  automaticWeeklyAccountingPeriodBounds,
} from "../../src/contexts/wallet-ledger/domain/accounting-period";

describe("Accounting Period", () => {
  it("uses Monday midnight in Asia/Bangkok for Automatic weekly boundaries", () => {
    const bounds = automaticWeeklyAccountingPeriodBounds(
      new Date("2026-09-05T06:00:00.000Z"),
    );

    expect(ACCOUNTING_TIME_ZONE).toBe("Asia/Bangkok");
    expect(bounds.start.toISOString()).toBe("2026-08-30T17:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-09-06T17:00:00.000Z");
  });

  it("assigns an exact Monday midnight boundary to the succeeding week", () => {
    const boundary = new Date("2026-09-06T17:00:00.000Z");
    const bounds = automaticWeeklyAccountingPeriodBounds(boundary);

    expect(bounds.start.toISOString()).toBe(boundary.toISOString());
    expect(bounds.end.toISOString()).toBe("2026-09-13T17:00:00.000Z");
  });
});

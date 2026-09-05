import { describe, expect, it } from "vitest";
import {
  ACCOUNTING_TIME_ZONE,
  automaticWeeklyAccountingPeriodBounds,
  normalizeBangkokCalendarDate,
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

  it("normalizes explicit calendar dates to Bangkok midnight", () => {
    expect(normalizeBangkokCalendarDate("2026-09-08").toISOString()).toBe(
      "2026-09-07T17:00:00.000Z",
    );
    expect(normalizeBangkokCalendarDate("2026-09-10").toISOString()).toBe(
      "2026-09-09T17:00:00.000Z",
    );
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(() => normalizeBangkokCalendarDate("08/09/2026")).toThrow("YYYY-MM-DD");
    expect(() => normalizeBangkokCalendarDate("2026-02-30")).toThrow(
      "valid calendar date",
    );
  });
});

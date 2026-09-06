import { describe, expect, it } from "vitest";
import { planRollingDraws } from "../../src/contexts/lottery/domain/rolling-draw-planner";
import {
  applyScheduleOccurrenceException,
  createScheduleOccurrence,
  type ScheduleOccurrence,
} from "../../src/contexts/lottery/domain/schedule-occurrence";
import { createPublishedScheduleTemplate } from "../../src/contexts/lottery/domain/schedule-template";

function occurrence(
  occurrenceIdentity: string,
  localDate: string,
  drawAt: string,
  provenance: ScheduleOccurrence["provenance"] = "SCHEDULE_GENERATED",
): ScheduleOccurrence {
  const draw = new Date(drawAt);
  return createScheduleOccurrence({
    occurrenceIdentity,
    localDate,
    openAt: new Date(draw.getTime() - 24 * 60 * 60 * 1000),
    cutoffAt: new Date(draw.getTime() - 15 * 60 * 1000),
    drawAt: draw,
    provenance,
  });
}

describe("structured Schedule Template and rolling Draw occurrence semantics", () => {
  it("keeps recurrence as structured immutable business data instead of raw RRULE input", () => {
    const recurrence = {
      businessPattern: "government-lottery",
      configuredDays: [1, 16],
    };
    const template = createPublishedScheduleTemplate({
      id: "schedule:thai-government:v1",
      timezone: "Asia/Bangkok",
      recurrence,
      expectedTimes: {
        open: { hour: 0, minute: 0, second: 0 },
        cutoff: { hour: 15, minute: 45, second: 0 },
        draw: { hour: 16, minute: 0, second: 0 },
      },
      rollingGenerationHorizonDays: 60,
    });

    recurrence.configuredDays.push(31);

    expect(template.recurrence).toEqual({
      businessPattern: "government-lottery",
      configuredDays: [1, 16],
    });
    expect(Object.isFrozen(template.recurrence)).toBe(true);

    expect(() =>
      createPublishedScheduleTemplate({
        id: "schedule:raw-rrule:v1",
        timezone: "Asia/Bangkok",
        recurrence: "FREQ=MONTHLY;BYMONTHDAY=1,16" as unknown as Record<
          string,
          unknown
        >,
        expectedTimes: {
          open: { hour: 0, minute: 0, second: 0 },
          cutoff: { hour: 15, minute: 45, second: 0 },
          draw: { hour: 16, minute: 0, second: 0 },
        },
        rollingGenerationHorizonDays: 60,
      }),
    ).toThrow("structured business data, not a raw recurrence string");
  });

  it("rejects invalid local schedule times and rolling horizons", () => {
    expect(() =>
      createPublishedScheduleTemplate({
        id: "schedule:test:v1",
        timezone: "Asia/Bangkok",
        recurrence: { pattern: "structured" },
        expectedTimes: {
          open: { hour: 24, minute: 0, second: 0 },
          cutoff: { hour: 15, minute: 45, second: 0 },
          draw: { hour: 16, minute: 0, second: 0 },
        },
        rollingGenerationHorizonDays: 30,
      }),
    ).toThrow("open time must be a valid local business time");

    expect(() =>
      createPublishedScheduleTemplate({
        id: "schedule:test:v1",
        timezone: "Asia/Bangkok",
        recurrence: { pattern: "structured" },
        expectedTimes: {
          open: { hour: 0, minute: 0, second: 0 },
          cutoff: { hour: 15, minute: 45, second: 0 },
          draw: { hour: 16, minute: 0, second: 0 },
        },
        rollingGenerationHorizonDays: 0,
      }),
    ).toThrow("Rolling generation horizon must be a positive whole number of days");

    expect(() =>
      createPublishedScheduleTemplate({
        id: "schedule:test:v1",
        timezone: "Not/A_Timezone",
        recurrence: { pattern: "structured" },
        expectedTimes: {
          open: { hour: 0, minute: 0, second: 0 },
          cutoff: { hour: 15, minute: 45, second: 0 },
          draw: { hour: 16, minute: 0, second: 0 },
        },
        rollingGenerationHorizonDays: 30,
      }),
    ).toThrow("valid IANA timezone");
  });

  it("applies a date-specific skip without producing a Draw candidate", () => {
    const base = occurrence(
      "occ:2026-09-16",
      "2026-09-16",
      "2026-09-16T09:00:00.000Z",
    );

    expect(
      applyScheduleOccurrenceException(base, {
        kind: "SKIP",
        targetOccurrenceIdentity: base.occurrenceIdentity,
        targetLocalDate: base.localDate,
      }),
    ).toBeNull();
  });

  it("supports move/replace exceptions using an explicit effective occurrence", () => {
    const base = occurrence(
      "occ:2026-10-01",
      "2026-10-01",
      "2026-10-01T09:00:00.000Z",
    );
    const moved = occurrence(
      "occ:2026-10-01",
      "2026-10-02",
      "2026-10-02T09:00:00.000Z",
    );
    const replacement = occurrence(
      "occ:2026-10-special",
      "2026-10-03",
      "2026-10-03T09:00:00.000Z",
      "MANUAL_EXCEPTION",
    );

    expect(
      applyScheduleOccurrenceException(base, {
        kind: "MOVE",
        targetOccurrenceIdentity: base.occurrenceIdentity,
        targetLocalDate: base.localDate,
        effectiveOccurrence: moved,
      }),
    ).toEqual(moved);
    expect(
      applyScheduleOccurrenceException(base, {
        kind: "REPLACE",
        targetOccurrenceIdentity: base.occurrenceIdentity,
        targetLocalDate: base.localDate,
        effectiveOccurrence: replacement,
      }),
    ).toEqual(replacement);
  });

  it("is idempotent by Product plus effective schedule-occurrence identity", () => {
    const first = occurrence(
      "occ:2026-09-16",
      "2026-09-16",
      "2026-09-16T09:00:00.000Z",
    );
    const plan = planRollingDraws({
      productId: "product:thai-government",
      baseOccurrences: [first],
      exceptions: [],
      existingDraws: [
        {
          productId: "product:thai-government",
          occurrenceIdentity: first.occurrenceIdentity,
          hasManualOverride: false,
          hasBusinessActivity: false,
        },
      ],
    });

    expect(plan.create).toEqual([]);
    expect(plan.preservedOccurrenceIdentities).toEqual([first.occurrenceIdentity]);
  });

  it("never overwrites existing Draws with manual override or business activity", () => {
    const overridden = occurrence(
      "occ:2026-10-01",
      "2026-10-01",
      "2026-10-01T09:00:00.000Z",
    );
    const active = occurrence(
      "occ:2026-10-16",
      "2026-10-16",
      "2026-10-16T09:00:00.000Z",
    );
    const plan = planRollingDraws({
      productId: "product:thai-government",
      baseOccurrences: [overridden, active],
      exceptions: [],
      existingDraws: [
        {
          productId: "product:thai-government",
          occurrenceIdentity: overridden.occurrenceIdentity,
          hasManualOverride: true,
          hasBusinessActivity: false,
        },
        {
          productId: "product:thai-government",
          occurrenceIdentity: active.occurrenceIdentity,
          hasManualOverride: false,
          hasBusinessActivity: true,
        },
      ],
    });

    expect(plan.create).toEqual([]);
    expect(plan.preservedOccurrenceIdentities).toEqual([
      overridden.occurrenceIdentity,
      active.occurrenceIdentity,
    ]);
  });

  it("does not create a replacement when the targeted Draw already exists with business activity", () => {
    const base = occurrence(
      "occ:2026-11-01",
      "2026-11-01",
      "2026-11-01T09:00:00.000Z",
    );
    const replacement = occurrence(
      "manual:2026-11-special",
      "2026-11-02",
      "2026-11-02T09:00:00.000Z",
      "MANUAL_EXCEPTION",
    );
    const plan = planRollingDraws({
      productId: "product:thai-government",
      baseOccurrences: [base],
      exceptions: [
        {
          kind: "REPLACE",
          targetOccurrenceIdentity: base.occurrenceIdentity,
          targetLocalDate: base.localDate,
          effectiveOccurrence: replacement,
        },
      ],
      existingDraws: [
        {
          productId: "product:thai-government",
          occurrenceIdentity: base.occurrenceIdentity,
          hasManualOverride: false,
          hasBusinessActivity: true,
        },
      ],
    });

    expect(plan.create).toEqual([]);
    expect(plan.preservedOccurrenceIdentities).toEqual([base.occurrenceIdentity]);
  });

  it("keeps manually-created exceptional Draw provenance distinct", () => {
    const base = occurrence(
      "occ:2026-12-01",
      "2026-12-01",
      "2026-12-01T09:00:00.000Z",
    );
    const replacement = occurrence(
      "manual:2026-12-special",
      "2026-12-02",
      "2026-12-02T09:00:00.000Z",
      "MANUAL_EXCEPTION",
    );
    const plan = planRollingDraws({
      productId: "product:thai-government",
      baseOccurrences: [base],
      exceptions: [
        {
          kind: "REPLACE",
          targetOccurrenceIdentity: base.occurrenceIdentity,
          targetLocalDate: base.localDate,
          effectiveOccurrence: replacement,
        },
      ],
      existingDraws: [],
    });

    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]?.occurrence).toEqual(
      expect.objectContaining({
        occurrenceIdentity: "manual:2026-12-special",
        provenance: "MANUAL_EXCEPTION",
      }),
    );
  });

  it("de-duplicates repeated candidates within the same rolling-generation run", () => {
    const duplicate = occurrence(
      "occ:2027-01-01",
      "2027-01-01",
      "2027-01-01T09:00:00.000Z",
    );
    const plan = planRollingDraws({
      productId: "product:thai-government",
      baseOccurrences: [duplicate, duplicate],
      exceptions: [],
      existingDraws: [],
    });

    expect(plan.create).toHaveLength(1);
    expect(plan.preservedOccurrenceIdentities).toEqual([duplicate.occurrenceIdentity]);
  });
});

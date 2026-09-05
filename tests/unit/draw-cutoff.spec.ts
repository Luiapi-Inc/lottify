import { describe, expect, it } from "vitest";
import {
  assertBeforeDrawCutoff,
  createDrawCutoff,
  DrawCutoffReachedError,
  InvalidDrawCutoffInstantError,
  isBeforeDrawCutoff,
} from "../../src/contexts/lottery/domain/draw-cutoff";

describe("Draw cutoff", () => {
  const cutoffAt = new Date("2026-09-05T12:00:00.000Z");

  it("models one canonical Draw cutoff and defensively snapshots its instant", () => {
    const mutableCutoff = new Date(cutoffAt);
    const cutoff = createDrawCutoff(mutableCutoff);

    mutableCutoff.setTime(new Date("2026-09-06T12:00:00.000Z").getTime());

    expect(cutoff).toEqual({
      cutoffAt: new Date("2026-09-05T12:00:00.000Z"),
    });
  });

  it("accepts a server-authoritative instant strictly before cutoff", () => {
    const cutoff = createDrawCutoff(cutoffAt);
    const serverNow = new Date("2026-09-05T11:59:59.999Z");

    expect(isBeforeDrawCutoff(cutoff, serverNow)).toBe(true);
    expect(() => assertBeforeDrawCutoff(cutoff, serverNow)).not.toThrow();
  });

  it("rejects the exact cutoff boundary", () => {
    const cutoff = createDrawCutoff(cutoffAt);

    expect(isBeforeDrawCutoff(cutoff, new Date(cutoffAt))).toBe(false);
    expect(() => assertBeforeDrawCutoff(cutoff, new Date(cutoffAt))).toThrow(
      DrawCutoffReachedError,
    );
  });

  it("rejects an instant after cutoff", () => {
    const cutoff = createDrawCutoff(cutoffAt);
    const serverNow = new Date("2026-09-05T12:00:00.001Z");

    expect(isBeforeDrawCutoff(cutoff, serverNow)).toBe(false);
    expect(() => assertBeforeDrawCutoff(cutoff, serverNow)).toThrow(
      "Draw cutoff has been reached",
    );
  });

  it("rejects an invalid cutoff instant", () => {
    expect(() => createDrawCutoff(new Date(Number.NaN))).toThrow(
      InvalidDrawCutoffInstantError,
    );
  });

  it("rejects an invalid server-authoritative instant", () => {
    const cutoff = createDrawCutoff(cutoffAt);

    expect(() => isBeforeDrawCutoff(cutoff, new Date(Number.NaN))).toThrow(
      "serverNow must be a valid instant",
    );
  });
});

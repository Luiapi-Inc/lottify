import { describe, expect, it } from "vitest";
import {
  DRAW_PAYOUT_SOURCES,
  resolveDrawPayout,
} from "../../src/contexts/lottery/domain/draw-payout";

describe("Draw payout resolution", () => {
  it("locks the payout provenance vocabulary", () => {
    expect(DRAW_PAYOUT_SOURCES).toEqual(["DRAW_OVERRIDE", "DRAW_SNAPSHOT"]);
  });

  it("uses the Draw-snapshotted payout when no Draw Override exists", () => {
    expect(
      resolveDrawPayout({
        drawSnapshot: "snapshot-payout-v1",
      }),
    ).toEqual({
      payout: "snapshot-payout-v1",
      source: "DRAW_SNAPSHOT",
    });
  });

  it("uses the Draw Override ahead of the snapshotted payout", () => {
    expect(
      resolveDrawPayout({
        drawSnapshot: "snapshot-payout-v1",
        drawOverride: "override-payout-v2",
      }),
    ).toEqual({
      payout: "override-payout-v2",
      source: "DRAW_OVERRIDE",
    });
  });

  it("does not impose a numeric payout representation on the resolver", () => {
    const payout = Object.freeze({ policyRef: "payout-policy-v3" });

    const resolution = resolveDrawPayout({
      drawSnapshot: payout,
    });

    expect(resolution.payout).toBe(payout);
    expect(resolution.source).toBe("DRAW_SNAPSHOT");
  });
});

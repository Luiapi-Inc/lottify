import { describe, expect, it } from "vitest";
import {
  InvalidResultRevisionError,
  applyResultRevisionTransition,
  createResultRevision,
  isTerminalResultRevisionState,
} from "../../src/contexts/result-settlement/domain/result-revision";

describe("ResultRevision lifecycle", () => {
  it("advances RECEIVED -> VALIDATING -> CONFIRMED", () => {
    const received = applyResultRevisionTransition({
      current: { state: "RECEIVED" },
      command: "START_VALIDATION",
    });
    expect(received.state).toBe("VALIDATING");
    const confirmed = applyResultRevisionTransition({
      current: { state: received.state },
      command: "CONFIRM",
    });
    expect(confirmed.state).toBe("CONFIRMED");
    expect(isTerminalResultRevisionState("CONFIRMED")).toBe(true);
  });

  it("routes a conflicted result through REVIEW_REQUIRED and back", () => {
    const validating = applyResultRevisionTransition({
      current: { state: "RECEIVED" },
      command: "START_VALIDATION",
    });
    const review = applyResultRevisionTransition({
      current: { state: validating.state },
      command: "MARK_REVIEW_REQUIRED",
    });
    expect(review.state).toBe("REVIEW_REQUIRED");
    const revalidated = applyResultRevisionTransition({
      current: { state: review.state },
      command: "REVALIDATE",
    });
    expect(revalidated.state).toBe("VALIDATING");
  });

  it("never confirms from REVIEW_REQUIRED without revalidation", () => {
    expect(() =>
      applyResultRevisionTransition({
        current: { state: "REVIEW_REQUIRED" },
        command: "CONFIRM",
      }),
    ).toThrow(InvalidResultRevisionError);
  });

  it("treats SUPERSEDED as terminal and immutable", () => {
    expect(isTerminalResultRevisionState("SUPERSEDED")).toBe(true);
    expect(() =>
      applyResultRevisionTransition({
        current: { state: "SUPERSEDED" },
        command: "START_VALIDATION",
      }),
    ).toThrow(/terminal and immutable/i);
  });

  it("rejects confirm from RECEIVED (validation must precede confirmation)", () => {
    expect(() =>
      applyResultRevisionTransition({ current: { state: "RECEIVED" }, command: "CONFIRM" }),
    ).toThrow(InvalidResultRevisionError);
  });
});

describe("createResultRevision", () => {
  const base = {
    id: "rev-1",
    drawId: "draw-1",
    revision: 1,
    state: "RECEIVED" as const,
    resultSchemaVersionRef: "result-v1",
    resultSourceRef: null,
    resultData: { winning: true },
    winningNumbers: { TWO_DIGIT: "42" },
    supersedesRevisionId: null,
    correlationId: "corr-1",
    confirmedAt: null,
    confirmedByAdminId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  it("builds an immutable revision and requires valid winning numbers", () => {
    const revision = createResultRevision(base);
    expect(revision.winningNumbers.TWO_DIGIT).toBe("42");
    expect(() => createResultRevision({ ...base, revision: 0 })).toThrow(
      InvalidResultRevisionError,
    );
    expect(() =>
      createResultRevision({
        ...base,
        winningNumbers: { TWO_DIGIT: "" },
      }),
    ).toThrow(/non-empty canonical string/);
  });
});

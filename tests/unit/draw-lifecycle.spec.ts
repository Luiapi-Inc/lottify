import { describe, expect, it } from "vitest";
import {
  DRAW_STATES,
  IllegalDrawTransitionError,
  type DrawState,
  isTerminalDrawState,
  transitionDraw,
} from "../../src/contexts/lottery/domain/draw-lifecycle";

describe("Draw lifecycle", () => {
  it("locks the canonical Draw states", () => {
    expect(DRAW_STATES).toEqual([
      "DRAFT",
      "SCHEDULED",
      "OPEN",
      "CLOSED",
      "RESULT_PENDING",
      "RESULT_CONFIRMED",
      "SETTLING",
      "SETTLED",
      "CANCELLING",
      "CANCELLED",
    ]);
  });

  it("follows the canonical successful lifecycle without skipped transitions", () => {
    let state: DrawState = "DRAFT";
    state = transitionDraw(state, "SCHEDULE");
    expect(state).toBe("SCHEDULED");

    const open = transitionDraw(state, "OPEN");
    expect(open).toBe("OPEN");
    const closed = transitionDraw(open, "CLOSE");
    expect(closed).toBe("CLOSED");
    const resultPending = transitionDraw(closed, "MARK_RESULT_PENDING");
    expect(resultPending).toBe("RESULT_PENDING");
    const resultConfirmed = transitionDraw(resultPending, "CONFIRM_RESULT");
    expect(resultConfirmed).toBe("RESULT_CONFIRMED");
    const settling = transitionDraw(resultConfirmed, "START_SETTLEMENT");
    expect(settling).toBe("SETTLING");
    expect(transitionDraw(settling, "COMPLETE_SETTLEMENT")).toBe("SETTLED");
  });

  it.each(["DRAFT", "SCHEDULED", "OPEN", "CLOSED"] as const)(
    "allows %s to enter cancellation and only then become CANCELLED",
    (state) => {
      const cancelling = transitionDraw(state, "REQUEST_CANCELLATION");
      expect(cancelling).toBe("CANCELLING");
      expect(
        transitionDraw(cancelling, "COMPLETE_CANCELLATION", {
          refundObligationsSatisfied: true,
        }),
      ).toBe("CANCELLED");
    },
  );

  it("refuses COMPLETE_CANCELLATION until refund obligations are satisfied", () => {
    const cancelling = transitionDraw("OPEN", "REQUEST_CANCELLATION");
    expect(cancelling).toBe("CANCELLING");

    expect(() => transitionDraw(cancelling, "COMPLETE_CANCELLATION")).toThrow(
      /refund obligations/,
    );
    expect(() =>
      transitionDraw(cancelling, "COMPLETE_CANCELLATION", {
        refundObligationsSatisfied: false,
      }),
    ).toThrow(IllegalDrawTransitionError);
  });

  it("rejects cancellation after result processing has started", () => {
    expect(() =>
      transitionDraw("RESULT_PENDING", "REQUEST_CANCELLATION"),
    ).toThrow(IllegalDrawTransitionError);
    expect(() =>
      transitionDraw("RESULT_CONFIRMED", "REQUEST_CANCELLATION"),
    ).toThrow(IllegalDrawTransitionError);
  });

  it("treats SETTLED and CANCELLED as terminal states", () => {
    expect(isTerminalDrawState("SETTLED")).toBe(true);
    expect(isTerminalDrawState("CANCELLED")).toBe(true);

    expect(() => transitionDraw("SETTLED", "REOPEN")).toThrow(
      "Draw state SETTLED is terminal",
    );
    expect(() => transitionDraw("CANCELLED", "SCHEDULE")).toThrow(
      "Draw state CANCELLED is terminal",
    );
  });

  it("permits exceptional CLOSED reopen only with privilege and before Result exists", () => {
    expect(() => transitionDraw("CLOSED", "REOPEN")).toThrow(
      "requires privileged authorization",
    );
    expect(() =>
      transitionDraw("CLOSED", "REOPEN", {
        privilegedReopen: true,
        resultExists: true,
      }),
    ).toThrow("cannot reopen after a Result exists");

    expect(
      transitionDraw("CLOSED", "REOPEN", {
        privilegedReopen: true,
        resultExists: false,
      }),
    ).toBe("OPEN");
  });

  it("rejects skipped or otherwise illegal lifecycle commands", () => {
    expect(() => transitionDraw("DRAFT", "OPEN")).toThrow(
      IllegalDrawTransitionError,
    );
    expect(() => transitionDraw("OPEN", "MARK_RESULT_PENDING")).toThrow(
      IllegalDrawTransitionError,
    );
    expect(() => transitionDraw("CLOSED", "START_SETTLEMENT")).toThrow(
      IllegalDrawTransitionError,
    );
    expect(() => transitionDraw("CANCELLING", "CLOSE")).toThrow(
      IllegalDrawTransitionError,
    );
  });

  it("does not model Result correction by mutating a terminal SETTLED Draw", () => {
    expect(() => transitionDraw("SETTLED", "MARK_RESULT_PENDING")).toThrow(
      "Draw state SETTLED is terminal",
    );
  });
});

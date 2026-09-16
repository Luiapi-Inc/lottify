// Unit evidence for the Draw-cancellation refund orchestration (Issue 117,
// ADR 0001 workflow 5): the lottery-side orchestrator triggers the betting bulk
// refund through the cross-context seam, re-checks the refund-obligation gate
// from the same durable predicate, and only then completes the Draw through the
// gated COMPLETE_CANCELLATION transition.
//
// The gate (refundObligationsSatisfied must be true) is enforced here by
// asserting the exact transition context the orchestrator passes, and by
// asserting that the transition is NOT called when any obligation remains
// outstanding. The orchestrator itself is the only admin path to COMPLETE_CANCELLATION
// (the generic LotteryDrawService.transition path refuses it without the flag).

import { describe, expect, it } from "vitest";
import {
  DrawCancellationOrchestrator,
} from "../../src/contexts/lottery/application/draw-cancellation-orchestrator";
import {
  DrawRefundError,
  type DrawRefundEntry,
  type DrawRefundPort,
  type DrawRefundRunResult,
} from "../../src/contexts/lottery/application/draw-refund.port";
import { FakeDrawAdmissionBoundary } from "../support/draw-admission.fake";

const DRAW = "draw-cancelled-117";
const AT = new Date("2026-09-16T03:00:00.000Z");
const ACTOR = { adminId: "admin-1", sessionId: "session-1", role: "admin" };

function entry(
  orderId: string,
  outcome: DrawRefundEntry["outcome"] = "REFUNDED",
  refundTransactionId: string | null = `tx-${orderId}`,
): DrawRefundEntry {
  return {
    orderId,
    memberId: `member-${orderId}`,
    stakeMinor: 10_000n,
    outcome,
    refundTransactionId,
    reason: null,
  };
}

function refundResult(
  overrides: Partial<DrawRefundRunResult> = {},
): DrawRefundRunResult {
  return {
    drawId: DRAW,
    considered: 1,
    refunded: [entry("order-a")],
    alreadyRefunded: [],
    outstanding: [],
    refundedStakeMinor: 10_000n,
    obligationsSatisfied: true,
    ...overrides,
  };
}

interface TransitionCall {
  id: string;
  command: string;
  expectedVersion: number;
  context: Record<string, unknown>;
}

/** A LotteryDrawService stand-in recording the transition it was asked for. */
class FakeDrawService {
  readonly transitions: TransitionCall[] = [];
  // The Draw's persisted state as getDraw would report it (default: still
  // CANCELLING, so the orchestrator performs the completion transition).
  state: string = "CANCELLING";
  version: number = 1;
  async getDraw(id: string) {
    return { id, state: this.state, version: this.version };
  }
  async transition(input: {
    id: string;
    command: string;
    expectedVersion: number;
    context?: Record<string, unknown>;
  }) {
    this.transitions.push({
      id: input.id,
      command: input.command,
      expectedVersion: input.expectedVersion,
      context: input.context ?? {},
    });
    this.version = input.expectedVersion + 1;
    return {
      id: input.id,
      state: "CANCELLED",
      version: this.version,
    };
  }
}

/** A DrawRefundPort fake whose results the test controls per call. */
class FakeRefundPort implements DrawRefundPort {
  runCalls: Array<{ drawId: string; reason: string | null }> = [];
  listCalls: string[] = [];
  refundResult: DrawRefundRunResult = refundResult();
  outstanding: Array<{ orderId: string; memberId: string }> = [];

  async refundCommittedStakesForDraw(input: {
    drawId: string;
    reason?: string | null;
  }): Promise<DrawRefundRunResult> {
    this.runCalls.push({ drawId: input.drawId, reason: input.reason ?? null });
    return this.refundResult;
  }

  async listOutstandingRefundObligations(
    drawId: string,
  ): Promise<Array<{ orderId: string; memberId: string }>> {
    this.listCalls.push(drawId);
    return this.outstanding;
  }
}

function harness() {
  const refunds = new FakeRefundPort();
  const draws = new FakeDrawService();
  const boundary = new FakeDrawAdmissionBoundary();
  const orchestrator = new DrawCancellationOrchestrator(
    refunds as never,
    draws as never,
    boundary,
  );
  return { refunds, draws, boundary, orchestrator };
}

describe("Draw-cancellation refund orchestration", () => {
  it("runs the refund, re-checks the gate, then completes cancellation with refundObligationsSatisfied true", async () => {
    const { refunds, draws, orchestrator } = harness();
    draws.version = 7;

    const result = await orchestrator.completeDrawCancellation({
      drawId: DRAW,
      expectedVersion: 7,
      actor: ACTOR,
    });

    // Refund seam was triggered with the Draw.
    expect(refunds.runCalls).toEqual([{ drawId: DRAW, reason: null }]);
    // The durable gate predicate was re-checked.
    expect(refunds.listCalls).toEqual([DRAW]);
    // Exactly one transition, COMPLETE_CANCELLATION, with the refund flag set.
    expect(draws.transitions).toHaveLength(1);
    expect(draws.transitions[0]).toEqual({
      id: DRAW,
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 7,
      context: { privilegedReopen: true, refundObligationsSatisfied: true },
    });
    expect(result.draw.state).toBe("CANCELLED");
    expect(result.refund.obligationsSatisfied).toBe(true);
  });

  it("fails closed and never transitions when a refund obligation remains outstanding", async () => {
    const { refunds, draws, orchestrator } = harness();
    draws.version = 3;
    refunds.outstanding = [{ orderId: "order-b", memberId: "member-order-b" }];
    refunds.refundResult = refundResult({ outstanding: [entry("order-b", "FAILED")] });

    await expect(
      orchestrator.completeDrawCancellation({
        drawId: DRAW,
        expectedVersion: 3,
      }),
    ).rejects.toBeInstanceOf(DrawRefundError);
    await expect(
      orchestrator.completeDrawCancellation({
        drawId: DRAW,
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ code: "REFUND_OBLIGATIONS_OUTSTANDING", status: 409 });

    // The gate was re-checked but the transition was never attempted.
    expect(draws.transitions).toHaveLength(0);
  });

  it("replaying an already-refunded Draw converges to one transition, not a second refund", async () => {
    const { refunds, draws, orchestrator } = harness();
    draws.version = 8;
    // Second run sees every Order already refunded; still refund-clean.
    refunds.refundResult = refundResult({
      considered: 1,
      refunded: [],
      alreadyRefunded: [entry("order-a", "ALREADY_REFUNDED", "tx-order-a")],
      refundedStakeMinor: 0n,
      obligationsSatisfied: true,
    });

    const result = await orchestrator.completeDrawCancellation({
      drawId: DRAW,
      expectedVersion: 8,
    });

    expect(result.refund.alreadyRefunded).toBe(1);
    expect(result.refund.refunded).toBe(0);
    // Converges to exactly one transition to CANCELLED.
    expect(draws.transitions).toHaveLength(1);
    expect(draws.transitions[0]!.command).toBe("COMPLETE_CANCELLATION");
  });

  it("replaying after the Draw is already CANCELLED converges without re-transitioning", async () => {
    const { refunds, draws, orchestrator } = harness();
    // The Draw has already reached its terminal CANCELLED state (the first run
    // completed). The refund run is idempotent and reports every Order
    // ALREADY_REFUNDED; the orchestrator must NOT re-attempt the terminal
    // transition, which would throw "Draw state CANCELLED is terminal".
    draws.state = "CANCELLED";
    refunds.refundResult = refundResult({
      considered: 1,
      refunded: [],
      alreadyRefunded: [entry("order-a", "ALREADY_REFUNDED", "tx-order-a")],
      refundedStakeMinor: 0n,
      obligationsSatisfied: true,
    });

    const result = await orchestrator.completeDrawCancellation({
      drawId: DRAW,
      expectedVersion: 8,
    });

    expect(result.draw.state).toBe("CANCELLED");
    expect(result.refund.alreadyRefunded).toBe(1);
    expect(result.refund.refunded).toBe(0);
    // The terminal transition was never re-attempted.
    expect(draws.transitions).toHaveLength(0);
  });

  it("rejects a blank Draw id before touching the refund seam", async () => {
    const { refunds, draws, orchestrator } = harness();

    await expect(
      orchestrator.completeDrawCancellation({
        drawId: "   ",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "DRAW_ID_REQUIRED", status: 400 });

    expect(refunds.runCalls).toHaveLength(0);
    expect(draws.transitions).toHaveLength(0);
  });
});

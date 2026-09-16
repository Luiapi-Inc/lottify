// Regression evidence for the T06 rework requested by the financial-integrity
// review (Issue 117, ADR 0001 workflow 5).
//
// BLOCKING finding fixed: the DrawCancellationOrchestrator must read the Draw
// and fail closed BEFORE invoking the cross-context refund port, so that an
// irreversible money movement never runs for a Draw that does not authorise the
// cancellation.
//
// This spec wires the REAL refund chain — DrawCancellationOrchestrator ->
// DrawRefundAdapter -> DrawStakeRefundService (real) over the in-memory
// stake-refund repository + a wallet double that records the durable reversal —
// with a DrawService double that applies the PRODUCTION domain rule
// (transitionDraw) plus the PRODUCTION version guard, exactly like the review's
// reproduction harness. The assertions are financial: postedRefundCount (the
// durable reversals actually posted) must be 0 and the Order must stay CONFIRMED
// for every refused call, proving zero money moved before the legality check.

import { describe, expect, it } from "vitest";
import { DrawCancellationOrchestrator } from "../../src/contexts/lottery/application/draw-cancellation-orchestrator";
import { DrawRefundAdapter } from "../../src/platform/integration/draw-refund.adapter";
import { DrawStakeRefundService } from "../../src/contexts/betting/application/draw-stake-refund.service";
import {
  IllegalDrawTransitionError,
  transitionDraw,
} from "../../src/contexts/lottery/domain/draw-lifecycle";
import {
  FakeBetOrderWalletPort,
  InMemoryStakeRefundRepository,
} from "../support/stake-refund.fake";
import { FakeDrawAdmissionBoundary } from "../support/draw-admission.fake";

const DRAW = "draw-order-guard";

/** DrawService double using the production transitionDraw + version guard. */
class DomainDrawService {
  constructor(public state: string, public version: number) {}

  async getDraw(id: string) {
    return { id, state: this.state, version: this.version };
  }

  async transition(input: {
    id: string;
    command: string;
    expectedVersion: number;
    context?: Record<string, unknown>;
  }) {
    if (input.expectedVersion !== this.version) {
      const error = new Error(
        `Lottery Draw version is stale (expected ${input.expectedVersion}, current ${this.version})`,
      ) as Error & { code: string; status: number };
      error.name = "DrawRuleError";
      error.code = "DRAW_VERSION_CONFLICT";
      error.status = 409;
      throw error;
    }
    let next: string;
    try {
      next = transitionDraw(
        this.state as never,
        input.command as never,
        (input.context ?? {}) as never,
      );
    } catch (error) {
      if (error instanceof IllegalDrawTransitionError) {
        const mapped = new Error(error.message) as Error & {
          code: string;
          status: number;
        };
        mapped.name = "DrawRuleError";
        mapped.code = "ILLEGAL_DRAW_TRANSITION";
        mapped.status = 409;
        throw mapped;
      }
      throw error;
    }
    this.state = next;
    this.version += 1;
    return { id: input.id, state: this.state, version: this.version };
  }
}

function harness(state: string, version: number) {
  const orders = new InMemoryStakeRefundRepository();
  const wallet = new FakeBetOrderWalletPort();
  orders.seed({
    id: "order-1",
    memberId: "member-1",
    drawId: DRAW,
    state: "CONFIRMED",
    version: 1,
    stakeTransactionId: "stake-tx-1",
    refundTransactionId: null,
    totalStakeMinor: 30_000n,
  });
  const orchestrator = new DrawCancellationOrchestrator(
    new DrawRefundAdapter(new DrawStakeRefundService(orders, wallet)),
    new DomainDrawService(state, version) as never,
    new FakeDrawAdmissionBoundary(),
  );
  return { orders, wallet, orchestrator };
}

describe("T06 rework: refund never runs before the Draw validates the cancellation", () => {
  it("OPEN draw (COMPLETE_CANCELLATION illegal) -> 409 ILLEGAL_DRAW_TRANSITION with ZERO money moved, Order still CONFIRMED", async () => {
    const { orders, wallet, orchestrator } = harness("OPEN", 3);

    await expect(
      orchestrator.completeDrawCancellation({ drawId: DRAW, expectedVersion: 3 }),
    ).rejects.toMatchObject({ code: "ILLEGAL_DRAW_TRANSITION", status: 409 });

    // The legality check ran BEFORE the refund port: no reversal posted and the
    // Order's committed stake is untouched.
    expect(wallet.postedRefundCount).toBe(0);
    expect(wallet.refundRequests).toHaveLength(0);
    expect(orders.record("order-1")!.state).toBe("CONFIRMED");
    expect(orders.record("order-1")!.refundTransactionId).toBeNull();
  });

  it("CANCELLING draw with a stale expectedVersion -> 409 DRAW_VERSION_CONFLICT with ZERO money moved, Order still CONFIRMED", async () => {
    const { orders, wallet, orchestrator } = harness("CANCELLING", 4);

    await expect(
      orchestrator.completeDrawCancellation({ drawId: DRAW, expectedVersion: 3 }),
    ).rejects.toMatchObject({ code: "DRAW_VERSION_CONFLICT", status: 409 });

    // Version guard ran before the refund port: zero reversals, Order untouched.
    expect(wallet.postedRefundCount).toBe(0);
    expect(wallet.refundRequests).toHaveLength(0);
    expect(orders.record("order-1")!.state).toBe("CONFIRMED");
  });

  it("legitimate CANCELLING draw at the expected version still refunds exactly once and reaches CANCELLED", async () => {
    const { orders, wallet, orchestrator } = harness("CANCELLING", 4);

    const result = await orchestrator.completeDrawCancellation({
      drawId: DRAW,
      expectedVersion: 4,
    });

    expect(result.draw.state).toBe("CANCELLED");
    expect(result.refund.considered).toBe(1);
    expect(result.refund.refunded).toBe(1);
    expect(result.refund.outstanding).toBe(0);
    expect(result.refund.obligationsSatisfied).toBe(true);
    // Exactly one durable reversal.
    expect(wallet.postedRefundCount).toBe(1);
    expect(orders.record("order-1")!.state).toBe("CANCELLED");
    expect(orders.record("order-1")!.refundTransactionId).not.toBeNull();
  });

  it("replay on an already-CANCELLED draw converges and posts NOTHING new", async () => {
    const { orders, wallet, orchestrator } = harness("CANCELLED", 5);
    // The Order was already refunded by the first (crashed-after-refund) run.
    orders.patch("order-1", {
      state: "CANCELLED",
      version: 2,
      refundTransactionId: "refund-transaction-1",
    });
    wallet.seedDurableReversal("order-1");

    const result = await orchestrator.completeDrawCancellation({
      drawId: DRAW,
      expectedVersion: 5,
    });

    // Converged: Draw stays CANCELLED, the terminal transition is not re-attempted,
    // and the already-refunded Order posts no second reversal.
    expect(result.draw.state).toBe("CANCELLED");
    expect(result.refund.considered).toBe(0);
    expect(result.refund.refunded).toBe(0);
    expect(result.refund.alreadyRefunded).toBe(0);
    expect(result.refund.outstanding).toBe(0);
    expect(result.refund.obligationsSatisfied).toBe(true);
    expect(wallet.postedRefundCount).toBe(1);
    expect(orders.record("order-1")!.refundTransactionId).toBe(
      "refund-transaction-1",
    );
  });
});

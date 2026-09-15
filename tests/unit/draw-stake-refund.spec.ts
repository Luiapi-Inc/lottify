// Unit evidence for the Draw-cancellation refund of committed stakes (Issue 116,
// workflow 5): "Betting identifies affected confirmed Orders; Wallet & Ledger
// posts refunds idempotently", and the Draw only reaches CANCELLED once every
// refund obligation is satisfied.
//
// The operation is exercised against the Wallet & Ledger port fake, whose
// `BET_STAKE_REFUND` is idempotent per Bet Order, plus an in-memory stake-refund
// repository that can over-return (superset mode) or interleave a concurrent
// writer. Every financial assertion is a count of durable reversals, not a
// status code: the requirement is "no duplicate refund effect", so the tests
// count the reversals the wallet actually posted.

import { describe, expect, it } from "vitest";
import {
  DrawStakeRefundError,
  DrawStakeRefundService,
} from "../../src/contexts/betting/application/draw-stake-refund.service";
import {
  DRAW_CANCELLATION_REASON,
  drawRefundIdempotencyKey,
  type StakeOrderRecord,
} from "../../src/contexts/betting/domain/stake-refund";
import {
  FakeBetOrderWalletPort,
  InMemoryStakeRefundRepository,
} from "../support/stake-refund.fake";

const DRAW = "draw-cancelled-116";
const OTHER_DRAW = "draw-open-116";
const AT = new Date("2026-09-16T03:00:00.000Z");

function stakeOrder(id: string, overrides: Partial<StakeOrderRecord> = {}): StakeOrderRecord {
  return {
    id,
    memberId: `member-${id}`,
    drawId: DRAW,
    state: "CONFIRMED",
    version: 3,
    stakeTransactionId: `stake-${id}`,
    refundTransactionId: null,
    totalStakeMinor: 10_000n,
    ...overrides,
  };
}

function harness(mode: "narrow" | "superset" = "narrow") {
  const orders = new InMemoryStakeRefundRepository(mode);
  const wallet = new FakeBetOrderWalletPort();
  const service = new DrawStakeRefundService(orders, wallet);
  return { orders, wallet, service };
}

describe("Draw-cancellation refund of committed stakes", () => {
  it("refunds every confirmed Order with a committed stake and leaves other Draws alone", async () => {
    const { orders, wallet, service } = harness();
    orders.seed(stakeOrder("order-a", { totalStakeMinor: 10_000n }));
    orders.seed(stakeOrder("order-b", { version: 5, totalStakeMinor: 25_000n }));
    orders.seed(stakeOrder("order-other", { drawId: OTHER_DRAW }));

    const result = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });

    expect(result.considered).toBe(2);
    expect(result.refunded.map((entry) => entry.orderId)).toEqual(["order-a", "order-b"]);
    expect(result.alreadyRefunded).toEqual([]);
    expect(result.outstanding).toEqual([]);
    expect(result.refundedStakeMinor).toBe(35_000n);
    expect(result.obligationsSatisfied).toBe(true);

    // One reversal per Order, reversing that Order's own committed stake.
    expect(wallet.refundRequests).toEqual([
      { orderId: "order-a", memberId: "member-order-a", stakeTransactionId: "stake-order-a" },
      { orderId: "order-b", memberId: "member-order-b", stakeTransactionId: "stake-order-b" },
    ]);
    expect(wallet.postedRefundCount).toBe(2);

    // CANCELLED only after the reversal is durable, with the version advanced by
    // the command then by the resolution.
    expect(orders.record("order-a")).toMatchObject({
      state: "CANCELLED",
      version: 5,
      refundTransactionId: "refund-transaction-1",
    });
    expect(orders.record("order-b")).toMatchObject({
      state: "CANCELLED",
      version: 7,
      refundTransactionId: "refund-transaction-2",
    });
    expect(orders.settlements.map((settlement) => settlement.reason)).toEqual([
      DRAW_CANCELLATION_REASON,
      DRAW_CANCELLATION_REASON,
    ]);
    expect(orders.claims.map((claim) => claim.idempotencyKey)).toEqual([
      drawRefundIdempotencyKey(DRAW),
      drawRefundIdempotencyKey(DRAW),
    ]);
    expect(orders.claims.map((claim) => `${claim.expectedState}->${claim.nextState}`)).toEqual([
      "CONFIRMED->CANCELLING",
      "CONFIRMED->CANCELLING",
    ]);

    // The other Draw keeps its committed stake.
    expect(orders.record("order-other")).toMatchObject({
      state: "CONFIRMED",
      version: 3,
      refundTransactionId: null,
    });
    expect(await service.listOutstandingRefundObligations(OTHER_DRAW)).toHaveLength(1);
  });

  it("replaying the operation produces no duplicate refund effect", async () => {
    const { orders, wallet, service } = harness("superset");
    orders.seed(stakeOrder("order-a"));
    orders.seed(stakeOrder("order-b"));

    const first = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });
    const second = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });

    expect(first.refunded).toHaveLength(2);
    expect(second.considered).toBe(0);
    expect(second.refunded).toEqual([]);
    expect(second.outstanding).toEqual([]);
    expect(second.refundedStakeMinor).toBe(0n);
    expect(second.obligationsSatisfied).toBe(true);

    // The number of durable reversals is unchanged by the replay.
    expect(wallet.postedRefundCount).toBe(2);
    expect(orders.record("order-a")?.refundTransactionId).toBe(
      first.refunded[0]!.refundTransactionId,
    );
    expect(orders.record("order-b")?.refundTransactionId).toBe(
      first.refunded[1]!.refundTransactionId,
    );
    expect(orders.claims).toHaveLength(2);
  });

  it("reuses the durable reversal after a crash between the reversal and the resolution", async () => {
    const { orders, wallet, service } = harness();
    orders.seed(stakeOrder("order-a", { state: "CANCELLING", version: 4 }));
    const durableReversal = wallet.seedDurableReversal("order-a");

    const result = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });

    expect(result.considered).toBe(1);
    expect(result.refunded).toEqual([
      {
        orderId: "order-a",
        memberId: "member-order-a",
        stakeMinor: 10_000n,
        outcome: "REFUNDED",
        refundTransactionId: durableReversal,
        reason: null,
      },
    ]);
    expect(wallet.postedRefundCount).toBe(1);
    expect(orders.claims).toEqual([]);
    expect(orders.record("order-a")).toMatchObject({
      state: "CANCELLED",
      version: 5,
      refundTransactionId: durableReversal,
    });
    expect(result.obligationsSatisfied).toBe(true);
  });

  it("skips Orders without a committed stake or without an outstanding refund", async () => {
    const { orders, wallet, service } = harness("superset");
    orders.seed(stakeOrder("order-no-stake", { stakeTransactionId: null }));
    orders.seed(
      stakeOrder("order-already-refunded", {
        state: "CANCELLED",
        refundTransactionId: "refund-transaction-old",
      }),
    );
    orders.seed(stakeOrder("order-quoted", { state: "QUOTED", stakeTransactionId: null }));
    orders.seed(stakeOrder("order-rejected", { state: "REJECTED", stakeTransactionId: null }));
    orders.seed(stakeOrder("order-expired", { state: "EXPIRED", stakeTransactionId: null }));

    const result = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });

    expect(result.considered).toBe(0);
    expect(result.refunded).toEqual([]);
    expect(result.outstanding).toEqual([]);
    expect(result.refundedStakeMinor).toBe(0n);
    expect(result.obligationsSatisfied).toBe(true);
    expect(wallet.refundRequests).toEqual([]);
    expect(wallet.postedRefundCount).toBe(0);
    expect(orders.claims).toEqual([]);

    // An unconfirmed Order is not silently cancelled by a Draw refund run.
    expect(orders.record("order-no-stake")).toMatchObject({ state: "CONFIRMED", version: 3 });
    expect(await service.listOutstandingRefundObligations(DRAW)).toEqual([]);
  });

  it("reports a partial failure as an outstanding obligation and converges on re-drive", async () => {
    const { orders, wallet, service } = harness();
    orders.seed(stakeOrder("order-a"));
    orders.seed(stakeOrder("order-b"));
    wallet.failRefundFor("order-a");

    const first = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });

    expect(first.refunded.map((entry) => entry.orderId)).toEqual(["order-b"]);
    expect(first.outstanding).toHaveLength(1);
    expect(first.outstanding[0]).toMatchObject({
      orderId: "order-a",
      outcome: "FAILED",
      refundTransactionId: null,
    });
    expect(first.outstanding[0]!.reason).toContain("ledger is unavailable");
    expect(first.obligationsSatisfied).toBe(false);
    // The failed Order was claimed but never resolved, so the obligation is visible.
    expect(orders.record("order-a")).toMatchObject({ state: "CANCELLING", version: 4 });
    expect(await service.listOutstandingRefundObligations(DRAW)).toHaveLength(1);

    wallet.clearRefundFailure("order-a");
    const second = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });

    expect(second.refunded.map((entry) => entry.orderId)).toEqual(["order-a"]);
    expect(second.obligationsSatisfied).toBe(true);
    expect(wallet.postedRefundCount).toBe(2);
    expect(await service.listOutstandingRefundObligations(DRAW)).toEqual([]);
  });

  it("does not refund an Order a concurrent run already resolved", async () => {
    const { orders, wallet, service } = harness();
    orders.seed(stakeOrder("order-a"));
    const durableReversal = wallet.seedDurableReversal("order-a");
    orders.onBeforeClaim = () => {
      orders.patch("order-a", {
        state: "CANCELLED",
        version: 5,
        refundTransactionId: durableReversal,
      });
    };

    const result = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });

    expect(result.refunded).toEqual([]);
    expect(result.alreadyRefunded).toHaveLength(1);
    expect(result.alreadyRefunded[0]).toMatchObject({
      orderId: "order-a",
      outcome: "ALREADY_REFUNDED",
      refundTransactionId: durableReversal,
    });
    expect(result.obligationsSatisfied).toBe(true);
    expect(wallet.refundRequests).toEqual([]);
    expect(wallet.postedRefundCount).toBe(1);
    expect(orders.settlements).toEqual([]);
  });

  it("leaves an Order another writer is still cancelling as an outstanding obligation", async () => {
    const { orders, wallet, service } = harness();
    orders.seed(stakeOrder("order-a"));
    orders.onBeforeClaim = () => {
      orders.patch("order-a", { state: "CANCELLING", version: 4 });
    };

    const result = await service.refundCommittedStakesForDraw({ drawId: DRAW, now: AT });

    expect(result.refunded).toEqual([]);
    expect(result.alreadyRefunded).toEqual([]);
    expect(result.outstanding).toHaveLength(1);
    expect(result.outstanding[0]).toMatchObject({
      orderId: "order-a",
      outcome: "IN_FLIGHT",
      refundTransactionId: null,
    });
    expect(result.obligationsSatisfied).toBe(false);
    expect(wallet.refundRequests).toEqual([]);
    expect(orders.record("order-a")).toMatchObject({ state: "CANCELLING", version: 4 });
    expect(await service.listOutstandingRefundObligations(DRAW)).toHaveLength(1);
  });

  it("requires the Draw the refund applies to", async () => {
    const { wallet, service } = harness();

    await expect(
      service.refundCommittedStakesForDraw({ drawId: "   ", now: AT }),
    ).rejects.toBeInstanceOf(DrawStakeRefundError);
    await expect(service.refundCommittedStakesForDraw({ drawId: "" })).rejects.toMatchObject({
      code: "DRAW_ID_REQUIRED",
      status: 400,
    });
    await expect(service.listOutstandingRefundObligations("")).rejects.toMatchObject({
      code: "DRAW_ID_REQUIRED",
    });
    expect(wallet.refundRequests).toEqual([]);
  });
});

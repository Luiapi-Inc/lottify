// Draw-cancellation refund orchestration (Issue 117, ADR 0001 workflow 5).
//
// This is the lottery-side orchestrator that completes a Draw cancellation
// end-to-end. It does not perform a hidden cross-context transaction; it drives
// a durable sequence whose state is recorded at every step (ADR 0001):
//
//   1. trigger the betting bulk refund of committed stakes through the
//      cross-context refund port (idempotent per Draw / per Order);
//   2. re-check, from the same durable predicate, that no confirmed Order with
//      an unrefunded committed stake remains — fail closed if any obligation is
//      still outstanding, so a partial refund is never hidden as complete;
//   3. only then complete the Draw cancellation through the gated transition
//      (refundObligationsSatisfied = true), which is the only path that reaches
//      CANCELLED.
//
// Replaying the orchestrator is safe: a re-driven refund run reports already-
// refunded Orders instead of posting a second reversal, and the gate re-check
// uses the same predicate as the refund operation, so it can never disagree.
//
// This orchestrator owns the admin COMPLETE_CANCELLATION path. The generic
// draw-transition path (LotteryDrawService.transition without the refund flag)
// refuses COMPLETE_CANCELLATION, so the gate cannot be bypassed.

import { Inject, Injectable } from "@nestjs/common";
import {
  type DrawActor,
  DrawRuleError,
  LotteryDrawService,
} from "./lottery-draw.service";
import {
  DRAW_REFUND_PORT,
  DrawRefundError,
  type DrawRefundPort,
} from "./draw-refund.port";

export interface CompleteDrawCancellationInput {
  readonly drawId: string;
  readonly expectedVersion: number;
  readonly reason?: string | null;
  readonly now?: Date;
  readonly actor?: DrawActor;
}

export interface CompleteDrawCancellationResult {
  readonly draw: {
    readonly id: string;
    readonly state: string;
    readonly version: number;
  };
  readonly refund: {
    readonly considered: number;
    readonly refunded: number;
    readonly alreadyRefunded: number;
    readonly outstanding: number;
    readonly refundedStakeMinor: bigint;
    readonly obligationsSatisfied: boolean;
  };
}

@Injectable()
export class DrawCancellationOrchestrator {
  constructor(
    @Inject(DRAW_REFUND_PORT) private readonly refunds: DrawRefundPort,
    @Inject(LotteryDrawService) private readonly draws: LotteryDrawService,
  ) {}

  /**
   * Runs the bulk refund, re-checks the refund-obligation gate, then completes
   * the Draw cancellation through the gated transition. Fails closed if any
   * refund obligation remains outstanding.
   */
  async completeDrawCancellation(
    input: CompleteDrawCancellationInput,
  ): Promise<CompleteDrawCancellationResult> {
    const drawId = input.drawId.trim();
    if (!drawId) {
      throw new DrawRuleError(
        "DRAW_ID_REQUIRED",
        "A Draw cancellation requires the Draw it applies to",
        400,
        {},
      );
    }

    const refund = await this.refunds.refundCommittedStakesForDraw({
      drawId,
      reason: input.reason ?? null,
      now: input.now,
    });

    // Re-check the durable predicate after the refund run. The refund service
    // and this re-check share the same predicate, so a non-empty list here is
    // an obligation the run could not satisfy (IN_FLIGHT / FAILED) — the Draw
    // is not refund-clean and must not be presented as fully CANCELLED.
    const outstanding = await this.refunds.listOutstandingRefundObligations(
      drawId,
    );
    if (outstanding.length > 0) {
      throw new DrawRefundError(
        "REFUND_OBLIGATIONS_OUTSTANDING",
        `Draw ${drawId} still has ${outstanding.length} unrefunded committed stake(s)`,
        409,
        { drawId, outstanding: outstanding.length },
      );
    }

    // Read the Draw's current state so a replay converges instead of re-throwing:
    // once a cancellation has already completed (state CANCELLED) the gated
    // transition is terminal and must not be re-attempted. The refund run above
    // is idempotent and already reported ALREADY_REFUNDED for every Order, so the
    // Draw is refund-clean and the replay is a safe no-op on the Draw lifecycle.
    const current = await this.draws.getDraw(drawId);
    const detail =
      current.state === "CANCELLED"
        ? current
        : await this.draws.transition({
            id: drawId,
            command: "COMPLETE_CANCELLATION",
            expectedVersion: input.expectedVersion,
            context: { privilegedReopen: true, refundObligationsSatisfied: true },
            actor: input.actor,
          });

    return {
      draw: { id: detail.id, state: detail.state, version: detail.version },
      refund: {
        considered: refund.considered,
        refunded: refund.refunded.length,
        alreadyRefunded: refund.alreadyRefunded.length,
        outstanding: refund.outstanding.length,
        refundedStakeMinor: refund.refundedStakeMinor,
        obligationsSatisfied: refund.obligationsSatisfied,
      },
    };
  }
}

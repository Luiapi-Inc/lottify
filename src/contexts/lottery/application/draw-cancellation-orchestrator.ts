// Draw-cancellation refund orchestration (Issue 117, ADR 0001 workflow 5).
//
// This is the lottery-side orchestrator that completes a Draw cancellation
// end-to-end. It does not perform a hidden cross-context transaction; it drives
// a durable sequence whose state is recorded at every step (ADR 0001):
//
//   0. read the Draw's current state and version and validate that the Draw
//      authorises the cancellation BEFORE any money moves — COMPLETE_CANCELLATION
//      is only legal from state CANCELLING at the expected version, or CANCELLED
//      for the idempotent replay; every other state and every stale version is a
//      409 with zero money moved (fail closed);
//   1. only then trigger the betting bulk refund of committed stakes through the
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
// The whole sequence runs INSIDE the Draw admission boundary (step 0..3), the
// same boundary a Bet Order Confirm holds around its own Draw-state revalidation
// and stake commit. Holding it from the first read through the terminal
// transition is what closes the confirm/cancel race:
//   - a Confirm that reached the boundary first commits its stake while this run
//     waits, so the scan that follows sees the CONFIRMED Order and refunds it;
//   - a Confirm that reaches the boundary after this run has terminalized the
//     Draw re-reads CANCELLED and is refused with zero money moved, instead of
//     committing a stake the scans can no longer see.
// See src/platform/concurrency/draw-admission.port.ts.
//
// This orchestrator owns the admin COMPLETE_CANCELLATION path. The generic
// draw-transition path (LotteryDrawService.transition without the refund flag)
// refuses COMPLETE_CANCELLATION, so the gate cannot be bypassed.

import { Inject, Injectable } from "@nestjs/common";
import {
  DRAW_ADMISSION_BOUNDARY,
  type DrawAdmissionBoundary,
} from "../../../platform/concurrency/draw-admission.port";
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
    @Inject(DRAW_ADMISSION_BOUNDARY) private readonly boundary: DrawAdmissionBoundary,
  ) {}

  /**
   * Validates that the Draw authorises the cancellation, runs the bulk refund,
   * re-checks the refund-obligation gate, then completes the Draw cancellation
   * through the gated transition. Fails closed if the Draw is not in a state
   * where COMPLETE_CANCELLATION is legal (no money moves), or if any refund
   * obligation remains outstanding.
   *
   * The whole sequence holds the Draw admission boundary, so no Bet Order can
   * commit a stake against this Draw between the scan and the terminal
   * transition (see the file header).
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

    return this.boundary.admit(drawId, () =>
      this.completeCancellationInsideBoundary(drawId, input),
    );
  }

  private async completeCancellationInsideBoundary(
    drawId: string,
    input: CompleteDrawCancellationInput,
  ): Promise<CompleteDrawCancellationResult> {
    // Read the Draw's current state and version FIRST and fail closed before
    // any money moves. COMPLETE_CANCELLATION is only legal from state CANCELLING
    // at the expected version; an already-CANCELLED Draw is the idempotent
    // replay convergence (safe no-op on the lifecycle). Every other state and
    // every stale version must return 409 with zero money moved — the bulk
    // refund is an irreversible cross-context movement and must never run for a
    // Draw that does not authorise the cancellation.
    const current = await this.draws.getDraw(drawId);

    if (current.state !== "CANCELLING" && current.state !== "CANCELLED") {
      throw new DrawRuleError(
        "ILLEGAL_DRAW_TRANSITION",
        `Draw cancellation is not legal from state ${current.state}`,
        409,
        { state: current.state, command: "COMPLETE_CANCELLATION" },
      );
    }

    if (
      current.state === "CANCELLING" &&
      current.version !== input.expectedVersion
    ) {
      throw new DrawRuleError(
        "DRAW_VERSION_CONFLICT",
        `Lottery Draw version is stale (expected ${input.expectedVersion}, current ${current.version})`,
        409,
        { expectedVersion: input.expectedVersion, currentVersion: current.version },
      );
    }

    // The Draw authorises the cancellation: only now touch the cross-context
    // refund port.
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

    // Complete the cancellation unless it has already completed (idempotent
    // replay on a CANCELLED Draw): the terminal transition is not re-attempted.
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

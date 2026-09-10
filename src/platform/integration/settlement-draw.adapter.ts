// Platform composition-root adapter for the settlement -> lottery draw port.
//
// The result-settlement context reaches the Draw lifecycle through this port.
// `loadDraw` returns the snapshot settlement needs (state, version, Result
// Schema reference, enabled Bet Type validation patterns) and `transition`
// drives the locked lifecycle commands (MARK_RESULT_PENDING, CONFIRM_RESULT,
// START_SETTLEMENT, COMPLETE_SETTLEMENT).

import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../platform/persistence/prisma.service";
import { LotteryDrawService } from "../../contexts/lottery/application/lottery-draw.service";
import {
  SettlementDrawError,
  type SettlementDrawCommand,
  type SettlementDrawPort,
} from "../../contexts/result-settlement/application/settlement.ports";

const COMMAND_MAP: Record<SettlementDrawCommand, string> = {
  MARK_RESULT_PENDING: "MARK_RESULT_PENDING",
  CONFIRM_RESULT: "CONFIRM_RESULT",
  START_SETTLEMENT: "START_SETTLEMENT",
  COMPLETE_SETTLEMENT: "COMPLETE_SETTLEMENT",
};

@Injectable()
export class SettlementDrawAdapter implements SettlementDrawPort {
  constructor(
    @Inject(LotteryDrawService) private readonly draws: LotteryDrawService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async loadDraw(drawId: string): Promise<{
    state: string;
    version: number;
    resultSchemaVersionRef: string;
    resultSourceRef: string | null;
    betTypes: ReadonlyArray<{ betTypeCode: string; validationPattern: string }>;
  } | null> {
    const draw = await this.prisma.lotteryDraw.findUnique({
      where: { id: drawId },
      select: {
        id: true,
        state: true,
        version: true,
        resultSchemaVersionRef: true,
        resultSourceRef: true,
        betTypes: {
          select: { betTypeCode: true, validationPattern: true },
        },
      },
    });
    if (!draw) return null;
    return {
      state: draw.state,
      version: draw.version,
      resultSchemaVersionRef: draw.resultSchemaVersionRef,
      resultSourceRef: draw.resultSourceRef,
      betTypes: draw.betTypes.map((betType) => ({
        betTypeCode: betType.betTypeCode,
        validationPattern: betType.validationPattern,
      })),
    };
  }

  async transition(input: {
    drawId: string;
    command: SettlementDrawCommand;
    expectedVersion: number;
  }): Promise<{ state: string; version: number }> {
    try {
      const detail = await this.draws.transition({
        id: input.drawId,
        command: COMMAND_MAP[input.command] as never,
        expectedVersion: input.expectedVersion,
      });
      return { state: detail.state, version: detail.version };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new SettlementDrawError(
          "DRAW_NOT_FOUND",
          `Lottery Draw ${input.drawId} not found`,
          { command: input.command },
        );
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new SettlementDrawError(
          "DRAW_STATE_CONFLICT",
          `Lottery Draw ${input.drawId} changed during settlement`,
          { command: input.command },
        );
      }
      if (isDrawRuleError(error)) {
        throw new SettlementDrawError(
          error.code === "ILLEGAL_DRAW_TRANSITION"
            ? "ILLEGAL_DRAW_TRANSITION"
            : "DRAW_STATE_CONFLICT",
          error.message,
          { command: input.command, code: error.code },
        );
      }
      throw error;
    }
  }
}

function isDrawRuleError(error: unknown): error is {
  code: string;
  message: string;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    (error as { code: string }).code === "ILLEGAL_DRAW_TRANSITION"
  );
}

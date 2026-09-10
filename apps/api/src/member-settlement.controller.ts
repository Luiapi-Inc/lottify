import {
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import {
  SettlementError,
  SettlementService,
} from "../../../src/contexts/result-settlement/application/settlement.service";
import { mapSettlementError } from "./admin-result-settlement.controller";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

class MemberSettlementOutcomeBody {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ enum: ["WIN", "LOSE"], nullable: true })
  outcome!: "WIN" | "LOSE" | null;
  @ApiProperty({ type: String })
  payoutMinor!: string;
  @ApiProperty({ type: String, nullable: true })
  batchState!: string | null;
  @ApiProperty({ type: Boolean, description: "True only when the batch has COMPLETED" })
  authoritative!: boolean;
}

@ApiTags("Member Betting Settlement")
@Controller("api/v1/member")
@UseGuards(MemberAuthGuard)
export class MemberSettlementController {
  constructor(
    @Inject(SettlementService)
    private readonly settlement: SettlementService,
  ) {}

  @Get("orders/:id/settlement")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Read the settlement outcome of a Member Bet Order",
    description:
      "The outcome is authoritative only once the settlement batch has COMPLETED; an in-flight or failed batch reports authoritative=false and never exposes a partial financial outcome.",
  })
  @ApiOkResponse({ type: MemberSettlementOutcomeBody })
  async settlementOutcome(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<MemberSettlementOutcomeBody> {
    try {
      const outcome = await this.settlement.getOrderSettlementOutcome(
        request.memberAuth!.memberId,
        id.trim(),
      );
      return {
        orderId: outcome.orderId,
        outcome: outcome.outcome,
        payoutMinor: outcome.payoutMinor.toString(),
        batchState: outcome.batchState,
        authoritative: outcome.authoritative,
      };
    } catch (error) {
      throw mapSettlementError(error);
    }
  }
}

export function mapMemberSettlementError(error: unknown): HttpException {
  if (error instanceof SettlementError) {
    return new HttpException(
      {
        code: error.code,
        message: error.message,
        details: error.details,
        correlationId: currentCorrelationId() ?? "unknown",
      },
      error.status,
    );
  }
  throw error;
}

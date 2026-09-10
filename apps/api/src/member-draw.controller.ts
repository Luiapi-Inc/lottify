import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiQuery, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import {
  DrawRuleError,
  LotteryDrawService,
  type DrawDetail,
} from "../../../src/contexts/lottery/application/lottery-draw.service";
import type { DrawState } from "../../../src/contexts/lottery/domain/draw-lifecycle";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

// Member discovery is read-only and least-privilege: it exposes the Draw status,
// the single canonical cutoff instant and the authoritative server time, with no
// persistence/entity internals.
@ApiTags("Member Lottery Draws")
@Controller("api/v1/member")
@UseGuards(MemberAuthGuard)
export class MemberDrawController {
  constructor(
    @Inject(LotteryDrawService)
    private readonly draws: LotteryDrawService,
  ) {}

  @Get("products/:productId/draws")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List Lottery Draws for a Product (betting discovery)" })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "state", required: false, enum: ["DRAFT","SCHEDULED","OPEN","CLOSED","RESULT_PENDING","RESULT_CONFIRMED","SETTLING","SETTLED"] })
  async listDraws(
    @Req() _request: MemberAuthenticatedRequest,
    @Param("productId") productId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("state") state: string | undefined,
  ): Promise<unknown> {
    try {
      return await this.draws.listDraws({
        productId: productId.trim(),
        limit: parseLimit(limit),
        cursor: cursor?.trim() || undefined,
        states: parseMemberStates(state),
      });
    } catch (error) {
      throw mapDrawError(error);
    }
  }

  @Get("draws/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a Lottery Draw detail with status, cutoff and server time" })
  async getDraw(
    @Req() _request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    try {
      return await this.draws.getDraw(id.trim());
    } catch (error) {
      throw mapDrawError(error);
    }
  }

  @Get("draws/:id/eligibility")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Cutoff eligibility: strictly-before eligible; exact/beyond rejected",
  })
  async eligibility(
    @Req() _request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<{ eligible: boolean; cutoffAt: Date; serverNow: Date }> {
    try {
      return await this.draws.checkCutoffEligibility({ id: id.trim() });
    } catch (error) {
      throw mapDrawError(error);
    }
  }
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HttpException(
      { code: "VALIDATION_ERROR", message: "limit must be an integer between 1 and 100", details: { field: "limit" }, correlationId: currentCorrelationId() ?? "unknown" },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed;
}

function parseMemberStates(value: string | undefined): DrawState[] | undefined {
  if (value === undefined || value.trim() === "") {
    return ["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "RESULT_PENDING", "RESULT_CONFIRMED", "SETTLING"];
  }
  const allowed = new Set(["DRAFT","SCHEDULED","OPEN","CLOSED","RESULT_PENDING","RESULT_CONFIRMED","SETTLING","SETTLED"]);
  if (!allowed.has(value)) {
    throw new HttpException(
      { code: "VALIDATION_ERROR", message: "state must be a valid Draw state", details: { field: "state" }, correlationId: currentCorrelationId() ?? "unknown" },
      HttpStatus.BAD_REQUEST,
    );
  }
  return [value as DrawState];
}

function mapDrawError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof DrawRuleError) {
    return new HttpException(
      { code: error.code, message: error.message, details: error.details, correlationId: currentCorrelationId() ?? "unknown" },
      error.status,
    );
  }
  if (error instanceof NotFoundException) {
    return new HttpException(
      { code: "DRAW_NOT_FOUND", message: error.message, details: {}, correlationId: currentCorrelationId() ?? randomUUID() },
      HttpStatus.NOT_FOUND,
    );
  }
  throw error;
}

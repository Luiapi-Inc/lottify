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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import {
  DrawRuleError,
  LotteryDrawService,
  type DrawBetTypeSnapshot,
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
class MemberDrawBetTypeBody {
  @ApiProperty({ type: String })
  betTypeId!: string;

  @ApiProperty({ type: String })
  betTypeCode!: string;

  @ApiProperty({ type: String })
  betTypeVersionId!: string;

  @ApiProperty({ type: String })
  canonicalNumberFormat!: string;

  @ApiProperty({ type: String })
  validationPattern!: string;

  @ApiProperty({
    type: Object,
    description: "Resolved payout configuration (opaque configuration value).",
  })
  payout!: Record<string, unknown>;

  @ApiProperty({ type: String, description: "Minimum stake in minor units." })
  minStakeMinor!: string;

  @ApiProperty({ type: String, description: "Maximum stake in minor units." })
  maxStakeMinor!: string;

  @ApiProperty({ type: String })
  limitPolicyRef!: string;

  @ApiProperty({ type: String })
  restrictionPolicyRef!: string;

  @ApiProperty({ type: String })
  settlementRuleVersionRef!: string;
}

class MemberDrawCutoffBody {
  @ApiProperty({ type: String, format: "date-time" })
  cutoffAt!: string;
}

class MemberDrawDetailBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  productId!: string;

  @ApiProperty({ type: String })
  productVersionId!: string;

  @ApiProperty({ type: String })
  occurrenceIdentity!: string;

  @ApiProperty({ type: String })
  localDate!: string;

  @ApiProperty({
    enum: [
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
    ],
  })
  state!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: String, format: "date-time" })
  openAt!: string;

  @ApiProperty({ type: String, format: "date-time" })
  cutoffAt!: string;

  @ApiProperty({ type: String, format: "date-time" })
  drawAt!: string;

  @ApiProperty({ type: String })
  provenance!: string;

  @ApiProperty({ type: String })
  timezone!: string;

  @ApiProperty({ type: String })
  scheduleTemplateRef!: string;

  @ApiProperty({ type: String })
  resultSchemaVersionRef!: string;

  @ApiProperty({ type: String })
  settlementRuleVersionRef!: string;

  @ApiProperty({ type: String })
  defaultPayoutPolicyRef!: string;

  @ApiProperty({ type: String })
  defaultLimitPolicyRef!: string;

  @ApiProperty({ type: String })
  defaultRestrictionPolicyRef!: string;

  @ApiProperty({ type: String, nullable: true })
  resultSourceRef!: string | null;

  @ApiProperty({ type: String })
  overrideRevisionRef!: string;

  @ApiProperty({ type: MemberDrawCutoffBody })
  cutoff!: MemberDrawCutoffBody;

  @ApiProperty({ type: String, format: "date-time" })
  serverNow!: string;

  @ApiProperty({
    type: [String],
    description: "Lifecycle commands currently allowed by the Draw state machine.",
  })
  allowedActions!: string[];

  @ApiProperty({ type: [MemberDrawBetTypeBody] })
  betTypes!: MemberDrawBetTypeBody[];
}

class MemberDrawPageBody {
  @ApiProperty({ type: [MemberDrawDetailBody] })
  items!: MemberDrawDetailBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

class MemberDrawEligibilityBody {
  @ApiProperty({
    type: Boolean,
    description: "True only when server time is strictly before the Draw cutoff.",
  })
  eligible!: boolean;

  @ApiProperty({ type: String, format: "date-time" })
  cutoffAt!: string;

  @ApiProperty({ type: String, format: "date-time" })
  serverNow!: string;
}

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
  @ApiOkResponse({ type: MemberDrawPageBody })
  async listDraws(
    @Req() _request: MemberAuthenticatedRequest,
    @Param("productId") productId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("state") state: string | undefined,
  ): Promise<MemberDrawPageBody> {
    try {
      const page = await this.draws.listDraws({
        productId: productId.trim(),
        limit: parseLimit(limit),
        cursor: cursor?.trim() || undefined,
        states: parseMemberStates(state),
      });
      return {
        items: page.items.map(toDrawDetailBody),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      throw mapDrawError(error);
    }
  }

  @Get("draws/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a Lottery Draw detail with status, cutoff and server time" })
  @ApiOkResponse({ type: MemberDrawDetailBody })
  async getDraw(
    @Req() _request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<MemberDrawDetailBody> {
    try {
      return toDrawDetailBody(await this.draws.getDraw(id.trim()));
    } catch (error) {
      throw mapDrawError(error);
    }
  }

  @Get("draws/:id/eligibility")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Cutoff eligibility: strictly-before eligible; exact/beyond rejected",
  })
  @ApiOkResponse({ type: MemberDrawEligibilityBody })
  async eligibility(
    @Req() _request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<MemberDrawEligibilityBody> {
    try {
      const eligibility = await this.draws.checkCutoffEligibility({
        id: id.trim(),
      });
      return {
        eligible: eligibility.eligible,
        cutoffAt: eligibility.cutoffAt.toISOString(),
        serverNow: eligibility.serverNow.toISOString(),
      };
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

function toDrawDetailBody(draw: DrawDetail): MemberDrawDetailBody {
  return {
    id: draw.id,
    productId: draw.productId,
    productVersionId: draw.productVersionId,
    occurrenceIdentity: draw.occurrenceIdentity,
    localDate: draw.localDate,
    state: draw.state,
    version: draw.version,
    openAt: draw.openAt.toISOString(),
    cutoffAt: draw.cutoffAt.toISOString(),
    drawAt: draw.drawAt.toISOString(),
    provenance: draw.provenance,
    timezone: draw.timezone,
    scheduleTemplateRef: draw.scheduleTemplateRef,
    resultSchemaVersionRef: draw.resultSchemaVersionRef,
    settlementRuleVersionRef: draw.settlementRuleVersionRef,
    defaultPayoutPolicyRef: draw.defaultPayoutPolicyRef,
    defaultLimitPolicyRef: draw.defaultLimitPolicyRef,
    defaultRestrictionPolicyRef: draw.defaultRestrictionPolicyRef,
    resultSourceRef: draw.resultSourceRef,
    overrideRevisionRef: draw.overrideRevisionRef,
    cutoff: { cutoffAt: draw.cutoff.cutoffAt.toISOString() },
    serverNow: draw.serverNow.toISOString(),
    allowedActions: [...draw.allowedActions],
    betTypes: draw.betTypes.map(toDrawBetTypeBody),
  };
}

function toDrawBetTypeBody(
  betType: DrawBetTypeSnapshot,
): MemberDrawBetTypeBody {
  return {
    betTypeId: betType.betTypeId,
    betTypeCode: betType.betTypeCode,
    betTypeVersionId: betType.betTypeVersionId,
    canonicalNumberFormat: betType.canonicalNumberFormat,
    validationPattern: betType.validationPattern,
    payout: betType.payout as Record<string, unknown>,
    minStakeMinor: betType.minStakeMinor,
    maxStakeMinor: betType.maxStakeMinor,
    limitPolicyRef: betType.limitPolicyRef,
    restrictionPolicyRef: betType.restrictionPolicyRef,
    settlementRuleVersionRef: betType.settlementRuleVersionRef,
  };
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

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { z, type ZodType } from "zod";
import {
  BettingQuoteError,
  BettingQuoteService,
} from "../../../src/contexts/betting/application/betting-quote.service";
import {
  QuoteRuleError,
  type NormalizedQuoteLine,
} from "../../../src/contexts/betting/domain/quote";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

const quoteLineSchema = z.object({
  betTypeCode: z.string().trim().min(1).max(100),
  canonicalNumber: z.string().trim().min(1).max(64),
  stakeMinor: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .transform((value) => BigInt(typeof value === "number" ? value : value)),
});

const quoteCreateSchema = z.object({
  currency: z.literal("THB"),
  lines: z.array(quoteLineSchema).min(1).max(500),
});

class QuoteLineBody {
  @ApiProperty({ type: String })
  betTypeId!: string;

  @ApiProperty({ type: String })
  betTypeCode!: string;

  @ApiProperty({ type: String })
  betTypeVersionId!: string;

  @ApiProperty({ type: String, example: "42" })
  canonicalNumber!: string;

  @ApiProperty({ type: String, description: "Stake in integer minor units" })
  stakeMinor!: string;

  @ApiProperty({
    type: Object,
    description: "Server-resolved payout for the line (opaque configuration value)",
  })
  resolvedPayout!: unknown;

  @ApiProperty({ enum: ["DRAW_OVERRIDE", "DRAW_SNAPSHOT"] })
  payoutSource!: string;

  @ApiProperty({ type: [String], description: "Applied restriction codes" })
  restrictions!: string[];
}

class QuoteCreateBody {
  @ApiProperty({ type: String })
  betTypeCode!: string;

  @ApiProperty({ type: String, example: "42" })
  canonicalNumber!: string;

  @ApiProperty({ type: String, description: "Stake in integer minor units" })
  stakeMinor!: string;
}

class BettingQuoteBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String })
  drawId!: string;

  @ApiProperty({ type: String })
  productId!: string;

  @ApiProperty({ type: String })
  productVersionId!: string;

  @ApiProperty({ enum: ["THB"] })
  currency!: string;

  @ApiProperty({ type: String })
  totalStakeMinor!: string;

  @ApiProperty({ enum: ["QUOTED", "EXPIRED"] })
  status!: string;

  @ApiProperty({ type: String, format: "date-time" })
  cutoffAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  serverNow!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: Date;

  @ApiProperty({ type: [QuoteLineBody] })
  lines!: QuoteLineBody[];
}

const QUOTE_IDEMPOTENCY_HEADER = "idempotency-key";

@ApiTags("Member Betting Quotes")
@Controller("api/v1/member")
@UseGuards(MemberAuthGuard)
export class MemberQuoteController {
  constructor(
    @Inject(BettingQuoteService)
    private readonly quotes: BettingQuoteService,
  ) {}

  @Post("draws/:drawId/quotes")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Create a betting Quote: server-authoritative resolution of bet lines",
  })
  @ApiHeader({
    name: QUOTE_IDEMPOTENCY_HEADER,
    required: true,
    description:
      "Scoped Idempotency-Key. Same key + same payload returns the prior Quote; same key + different payload conflicts.",
  })
  @ApiBody({ type: [QuoteCreateBody] })
  @ApiOkResponse({ type: BettingQuoteBody })
  async create(
    @Req() request: MemberAuthenticatedRequest,
    @Param("drawId") drawId: string,
    @Body() body: unknown,
  ): Promise<BettingQuoteBody> {
    const input = parseQuoteBody(quoteCreateSchema, body);
    const idempotencyKey = request.header(QUOTE_IDEMPOTENCY_HEADER)?.trim();
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required for Quote creation",
        details: {},
        correlationId: currentCorrelationId() ?? request.memberAuth!.sessionId,
      });
    }
    try {
      const quote = await this.quotes.createQuote({
        memberId: request.memberAuth!.memberId,
        drawId,
        lines: input.lines,
        currency: input.currency,
        idempotencyKey,
      });
      return toQuoteBody(quote);
    } catch (error) {
      throw mapQuoteError(error);
    }
  }

  @Get("quotes/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read a Member betting Quote by id" })
  @ApiOkResponse({ type: BettingQuoteBody })
  async get(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<BettingQuoteBody> {
    try {
      const quote = await this.quotes.getQuote(
        request.memberAuth!.memberId,
        id,
      );
      return toQuoteBody(quote);
    } catch (error) {
      throw mapQuoteError(error);
    }
  }
}

function toQuoteBody(quote: {
  id: string;
  memberId: string;
  drawId: string;
  productId: string;
  productVersionId: string;
  currency: "THB";
  totalStakeMinor: bigint;
  status: string;
  cutoffAt: Date;
  serverNow: Date;
  expiresAt: Date;
  lines: readonly NormalizedQuoteLine[];
}): BettingQuoteBody {
  return {
    id: quote.id,
    memberId: quote.memberId,
    drawId: quote.drawId,
    productId: quote.productId,
    productVersionId: quote.productVersionId,
    currency: quote.currency,
    totalStakeMinor: quote.totalStakeMinor.toString(),
    status: quote.status,
    cutoffAt: quote.cutoffAt,
    serverNow: quote.serverNow,
    expiresAt: quote.expiresAt,
    lines: quote.lines.map((line) => ({
      betTypeId: line.betTypeId,
      betTypeCode: line.betTypeCode,
      betTypeVersionId: line.betTypeVersionId,
      canonicalNumber: line.canonicalNumber,
      stakeMinor: line.stakeMinor.toString(),
      resolvedPayout: line.resolvedPayout,
      payoutSource: line.payoutSource,
      restrictions: [...line.restrictions],
    })),
  };
}

function parseQuoteBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "INVALID_QUOTE_REQUEST",
      message: "Invalid Quote request",
      details: { field: parsed.error.issues[0]?.path.join(".") ?? "body" },
      correlationId: currentCorrelationId() ?? "unknown",
    });
  }
  return parsed.data;
}

function mapQuoteError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof BettingQuoteError) {
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
  if (error instanceof QuoteRuleError) {
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
  if (error instanceof NotFoundException) {
    return new HttpException(
      { code: "QUOTE_NOT_FOUND", message: error.message, details: {}, correlationId: currentCorrelationId() ?? randomUUID() },
      HttpStatus.NOT_FOUND,
    );
  }
  throw error;
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
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
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BettingOrderError,
  BettingOrderService,
  type BetOrderCursor,
} from "../../../src/contexts/betting/application/betting-order.service";
import {
  BET_ORDER_STATES,
  BetOrderCommandError,
  type BetOrderState,
} from "../../../src/contexts/betting/domain/bet-order-lifecycle";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

const IDEMPOTENCY_HEADER = "idempotency-key";

const commandSchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().trim().max(500).optional(),
});

class BetOrderLineBody {
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
    description: "Server-resolved payout accepted for the line (opaque configuration value)",
  })
  resolvedPayout!: unknown;

  @ApiProperty({ enum: ["DRAW_OVERRIDE", "DRAW_SNAPSHOT"] })
  payoutSource!: string;

  @ApiProperty({ type: [String], description: "Accepted restriction codes" })
  restrictions!: string[];
}

class BetOrderBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String })
  quoteId!: string;

  @ApiProperty({ type: String })
  drawId!: string;

  @ApiProperty({ type: String })
  productId!: string;

  @ApiProperty({ type: String })
  productVersionId!: string;

  @ApiProperty({ enum: ["THB"] })
  currency!: string;

  @ApiProperty({
    enum: [
      "DRAFT",
      "QUOTED",
      "CONFIRMING",
      "CONFIRMED",
      "CANCELLING",
      "CANCELLED",
      "EXPIRED",
      "REJECTED",
      "SETTLED",
    ],
  })
  state!: string;

  @ApiProperty({ type: Number, description: "Optimistic-concurrency version" })
  version!: number;

  @ApiProperty({ enum: ["CONFIRM", "CANCEL"], isArray: true })
  allowedActions!: string[];

  @ApiProperty({ type: String })
  totalStakeMinor!: string;

  @ApiProperty({ type: String, format: "date-time" })
  cutoffAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  quoteExpiresAt!: Date;

  @ApiProperty({ type: String, nullable: true })
  reservationId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  stakeTransactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  refundTransactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rejectionReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  confirmedAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  cancelledAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  rejectedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true, description: "Issued Receipt id" })
  receiptId!: string | null;

  @ApiProperty({ type: [BetOrderLineBody] })
  lines!: BetOrderLineBody[];

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class BetOrderListBody {
  @ApiProperty({ type: [BetOrderBody] })
  items!: BetOrderBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

class BetReceiptLineBody {
  @ApiProperty({ type: String })
  betTypeCode!: string;

  @ApiProperty({ type: String })
  betTypeVersionId!: string;

  @ApiProperty({ type: String })
  canonicalNumber!: string;

  @ApiProperty({ type: String })
  stakeMinor!: string;

  @ApiProperty({
    type: Object,
    description: "Payout accepted at confirmation (opaque configuration value)",
  })
  resolvedPayout!: unknown;
}

class BetReceiptTermsBody {
  @ApiProperty({ type: String })
  productId!: string;

  @ApiProperty({ type: String })
  productVersionId!: string;

  @ApiProperty({ type: String, nullable: true })
  drawReference!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  drawCutoffAt!: string | null;

  @ApiProperty({ enum: ["THB"] })
  currency!: string;

  @ApiProperty({ type: String })
  totalStakeMinor!: string;

  @ApiProperty({ type: String, format: "date-time" })
  acceptedAt!: string;

  @ApiProperty({ type: [BetReceiptLineBody] })
  lines!: BetReceiptLineBody[];

  @ApiProperty({ type: [String] })
  acceptedRestrictions!: string[];
}

class BetReceiptBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  orderId!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: Number })
  orderVersion!: number;

  @ApiProperty({ type: String, description: "SHA-256 over the accepted terms" })
  contentDigest!: string;

  @ApiProperty({ type: BetReceiptTermsBody })
  terms!: BetReceiptTermsBody;

  @ApiProperty({ type: String, format: "date-time" })
  issuedAt!: Date;
}

class BetOrderCommandBody {
  @ApiProperty({ type: Number, description: "Expected Bet Order version" })
  version!: number;

  @ApiProperty({ type: String, required: false })
  reason?: string;
}

@ApiTags("Member Betting Orders")
@Controller("api/v1/member")
@UseGuards(MemberAuthGuard)
export class MemberOrderController {
  constructor(
    @Inject(BettingOrderService)
    private readonly orders: BettingOrderService,
  ) {}

  @Post("quotes/:quoteId/orders")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Create a Bet Order from an authorised Quote",
    description:
      "Creates the Order that accepts a Quote. No money moves at creation; only Confirm has a financial effect.",
  })
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: true,
    description:
      "Scoped Idempotency-Key. Replaying it returns the same Bet Order; the same key with a different Quote conflicts.",
  })
  @ApiOkResponse({ type: BetOrderBody })
  async create(
    @Req() request: MemberAuthenticatedRequest,
    @Param("quoteId") quoteId: string,
  ): Promise<BetOrderBody> {
    try {
      const order = await this.orders.createOrder({
        memberId: request.memberAuth!.memberId,
        quoteId,
        idempotencyKey: request.header(IDEMPOTENCY_HEADER),
      });
      return toOrderBody(order);
    } catch (error) {
      throw mapOrderError(error);
    }
  }

  @Get("orders")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the Member's own Bet Orders (my slips)",
    description:
      "Deterministic keyset pagination over (createdAt DESC, id DESC). Only the requesting Member's Orders are ever returned.",
  })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 20 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({
    name: "state",
    required: false,
    enum: [...BET_ORDER_STATES],
    description: "Optional Bet Order state filter",
  })
  @ApiOkResponse({ type: BetOrderListBody })
  async list(
    @Req() request: MemberAuthenticatedRequest,
    @Query() query: { limit?: string; cursor?: string; state?: string },
  ): Promise<BetOrderListBody> {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "limit must be an integer from 1 to 100",
        details: { field: "limit" },
      });
    }
    const page = await this.orders.listOrders(request.memberAuth!.memberId, {
      limit,
      cursor: query.cursor ? decodeOrderCursor(query.cursor) : null,
      state: query.state ? parseOrderState(query.state) : undefined,
    });
    return {
      items: page.items.map(toOrderBody),
      nextCursor: page.nextCursor ? encodeOrderCursor(page.nextCursor) : null,
    };
  }

  @Get("orders/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read a Member Bet Order by id" })
  @ApiOkResponse({ type: BetOrderBody })
  async get(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<BetOrderBody> {
    try {
      const order = await this.orders.getOrder(request.memberAuth!.memberId, id);
      return toOrderBody(order);
    } catch (error) {
      throw mapOrderError(error);
    }
  }

  @Post("orders/:id/confirm")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Confirm a Bet Order (explicit command)",
    description:
      "Revalidates the Quote and the authoritative Draw cutoff, then requires the durable Wallet & Ledger stake reserve/commit before the Order becomes CONFIRMED. Denials resolve to REJECTED with no money moved.",
  })
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: true,
    description: "Scoped Idempotency-Key for the Confirm command.",
  })
  @ApiBody({ type: BetOrderCommandBody })
  @ApiOkResponse({ type: BetOrderBody })
  async confirm(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<BetOrderBody> {
    const input = parseCommandBody(body);
    try {
      const order = await this.orders.confirmOrder({
        memberId: request.memberAuth!.memberId,
        orderId: id,
        expectedVersion: input.version,
        idempotencyKey: request.header(IDEMPOTENCY_HEADER),
      });
      return toOrderBody(order);
    } catch (error) {
      throw mapOrderError(error);
    }
  }

  @Post("orders/:id/cancel")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Cancel a confirmed Bet Order (explicit command)",
    description:
      "A Member may cancel before the Draw cutoff. The Order becomes CANCELLED only after the refund posting is durable.",
  })
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: true,
    description: "Scoped Idempotency-Key for the Cancel command.",
  })
  @ApiBody({ type: BetOrderCommandBody })
  @ApiOkResponse({ type: BetOrderBody })
  async cancel(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<BetOrderBody> {
    const input = parseCommandBody(body);
    try {
      const order = await this.orders.cancelOrder({
        memberId: request.memberAuth!.memberId,
        orderId: id,
        expectedVersion: input.version,
        idempotencyKey: request.header(IDEMPOTENCY_HEADER),
        reason: input.reason ?? null,
      });
      return toOrderBody(order);
    } catch (error) {
      throw mapOrderError(error);
    }
  }

  @Get("orders/:id/receipt")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read the immutable Bet Receipt of a confirmed Order" })
  @ApiOkResponse({ type: BetReceiptBody })
  async receipt(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<BetReceiptBody> {
    try {
      const receipt = await this.orders.getReceipt(
        request.memberAuth!.memberId,
        id,
      );
      return {
        id: receipt.id,
        orderId: receipt.orderId,
        memberId: receipt.memberId,
        orderVersion: receipt.orderVersion,
        contentDigest: receipt.contentDigest,
        terms: {
          ...receipt.terms,
          lines: receipt.terms.lines.map((line) => ({ ...line })),
          acceptedRestrictions: [...receipt.terms.acceptedRestrictions],
        },
        issuedAt: receipt.issuedAt,
      };
    } catch (error) {
      throw mapOrderError(error);
    }
  }
}

function toOrderBody(order: {
  id: string;
  memberId: string;
  quoteId: string;
  drawId: string;
  productId: string;
  productVersionId: string;
  currency: "THB";
  state: string;
  version: number;
  allowedActions: readonly string[];
  totalStakeMinor: bigint;
  cutoffAt: Date;
  quoteExpiresAt: Date;
  reservationId: string | null;
  stakeTransactionId: string | null;
  refundTransactionId: string | null;
  rejectionReason: string | null;
  cancellationReason: string | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  rejectedAt: Date | null;
  receiptId: string | null;
  lines: readonly {
    betTypeId: string;
    betTypeCode: string;
    betTypeVersionId: string;
    canonicalNumber: string;
    stakeMinor: bigint;
    resolvedPayout: unknown;
    payoutSource: string;
    restrictions: readonly string[];
  }[];
  createdAt: Date;
  updatedAt: Date;
}): BetOrderBody {
  return {
    id: order.id,
    memberId: order.memberId,
    quoteId: order.quoteId,
    drawId: order.drawId,
    productId: order.productId,
    productVersionId: order.productVersionId,
    currency: order.currency,
    state: order.state,
    version: order.version,
    allowedActions: [...order.allowedActions],
    totalStakeMinor: order.totalStakeMinor.toString(),
    cutoffAt: order.cutoffAt,
    quoteExpiresAt: order.quoteExpiresAt,
    reservationId: order.reservationId,
    stakeTransactionId: order.stakeTransactionId,
    refundTransactionId: order.refundTransactionId,
    rejectionReason: order.rejectionReason,
    cancellationReason: order.cancellationReason,
    confirmedAt: order.confirmedAt,
    cancelledAt: order.cancelledAt,
    rejectedAt: order.rejectedAt,
    receiptId: order.receiptId,
    lines: order.lines.map((line) => ({
      betTypeId: line.betTypeId,
      betTypeCode: line.betTypeCode,
      betTypeVersionId: line.betTypeVersionId,
      canonicalNumber: line.canonicalNumber,
      stakeMinor: line.stakeMinor.toString(),
      resolvedPayout: line.resolvedPayout,
      payoutSource: line.payoutSource,
      restrictions: [...line.restrictions],
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function parseCommandBody(value: unknown): z.infer<typeof commandSchema> {
  const parsed = commandSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "INVALID_ORDER_COMMAND",
      message: "Invalid Bet Order command",
      details: { field: parsed.error.issues[0]?.path.join(".") ?? "body" },
      correlationId: currentCorrelationId() ?? "unknown",
    });
  }
  return parsed.data;
}

function parseOrderState(value: string): BetOrderState {
  if (!BET_ORDER_STATES.includes(value as BetOrderState)) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "state must be a valid Bet Order state",
      details: { field: "state" },
    });
  }
  return value as BetOrderState;
}

export function encodeOrderCursor(cursor: BetOrderCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeOrderCursor(value: string): BetOrderCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { createdAt?: unknown; id?: unknown };
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") {
      throw new Error("cursor fields are missing");
    }
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !decoded.id.trim()) {
      throw new Error("cursor fields are invalid");
    }
    return { createdAt, id: decoded.id };
  } catch {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "cursor is invalid",
      details: { field: "cursor" },
    });
  }
}

function mapOrderError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof BettingOrderError) {
    return new HttpException(
      {
        code: error.code,
        message: error.message,
        details: error.details,
        correlationId: currentCorrelationId() ?? randomUUID(),
      },
      error.status,
    );
  }
  if (error instanceof BetOrderCommandError) {
    return new HttpException(
      {
        code: error.code,
        message: error.message,
        details: error.details,
        correlationId: currentCorrelationId() ?? randomUUID(),
      },
      HttpStatus.CONFLICT,
    );
  }
  throw error;
}

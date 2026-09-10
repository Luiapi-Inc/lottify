import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiAcceptedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { z, type ZodType } from "zod";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { WithdrawalService } from "../../../src/contexts/payments/application/withdrawal.service";
import {
  WithdrawalError,
} from "../../../src/contexts/payments/domain/withdrawal";
import {
  toWithdrawalView,
  type WithdrawalCursor,
  type WithdrawalRecord,
} from "../../../src/contexts/payments/domain/withdrawal.repository";
import { IdempotencyService } from "../../../src/platform/idempotency/idempotency.service";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

const IDEMPOTENCY_CONTRACT_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

const createWithdrawalSchema = z.object({
  payoutDestinationId: z.string().trim().min(1).max(100),
  amountMinor: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .transform((value) => BigInt(typeof value === "number" ? value : value)),
  currency: z.literal("THB"),
});

class CreateWithdrawalBody {
  @ApiProperty({ type: String, description: "Opaque Payout Destination identity" })
  payoutDestinationId!: string;

  @ApiProperty({ type: Number, description: "Positive amount in integer minor units" })
  amountMinor!: number;

  @ApiProperty({ enum: ["THB"] })
  currency!: "THB";
}

class WithdrawalBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String })
  payoutDestinationId!: string;

  @ApiProperty({ type: String, description: "Integer minor units" })
  amountMinor!: string;

  @ApiProperty({ type: String, description: "Integer minor units" })
  feeMinor!: string;

  @ApiProperty({ enum: ["THB"] })
  currency!: string;

  @ApiProperty({
    enum: [
      "REQUESTED",
      "RESERVING",
      "REVIEWING",
      "APPROVED",
      "PAYOUT_PROCESSING",
      "PAYOUT_CONFIRMED",
      "FINALIZING",
      "COMPLETED",
      "CANCELLING",
      "CANCELLED",
      "REJECTED",
      "FAILED",
      "RECONCILING",
    ],
  })
  state!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ enum: ["ALLOW", "REVIEW_REQUIRED", "DENY"] })
  eligibilityOutcome!: string;

  @ApiProperty({ type: [String] })
  eligibilityReasonCodes!: readonly string[];

  @ApiProperty({ type: Boolean })
  requiresApproval!: boolean;

  @ApiProperty({ type: String, nullable: true })
  ledgerTransactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  payoutEvidenceRef!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  decisionReason!: string | null;

  @ApiProperty({
    type: Object,
    additionalProperties: false,
    description: "Only commands the caller is currently permitted to issue",
  })
  allowedActions!: { member: readonly string[]; admin: readonly string[] };

  @ApiProperty({ type: [String] })
  eligibilityEvidenceRefs!: readonly string[];

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class WithdrawalListBody {
  @ApiProperty({ type: [WithdrawalBody] })
  items!: readonly WithdrawalBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

@ApiTags("Member Withdrawals")
@Controller("api/v1/member/withdrawals")
@UseGuards(MemberAuthGuard)
export class MemberWithdrawalController {
  constructor(
    @Inject(WithdrawalService)
    private readonly withdrawals: WithdrawalService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Scoped Idempotency-Key. Same key + same payload returns the prior result.",
  })
  @ApiBody({ type: CreateWithdrawalBody })
  @ApiAcceptedResponse({ type: WithdrawalBody })
  async create(
    @Req() request: MemberAuthenticatedRequest,
    @Body() body: CreateWithdrawalBody,
  ): Promise<WithdrawalBody> {
    const input = parseBody(createWithdrawalSchema, body);
    const correlationId = currentCorrelationId() ?? request.memberAuth!.sessionId;
    try {
      const withdrawal = await this.withdrawals.createWithdrawal(
        request.memberAuth!.memberId,
        { ...input, idempotencyKey: requireIdempotencyKey(request) },
        correlationId,
      );
      return toWithdrawalBody(withdrawal);
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the Member's Withdrawals" })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 20 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: WithdrawalListBody })
  async list(
    @Req() request: MemberAuthenticatedRequest,
    @Query() query: { limit?: string; cursor?: string },
  ): Promise<WithdrawalListBody> {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "limit must be an integer from 1 to 100",
        details: { field: "limit" },
      });
    }
    const page = await this.withdrawals.listMemberWithdrawals(
      request.memberAuth!.memberId,
      {
        limit,
        cursor: query.cursor ? decodeWithdrawalCursor(query.cursor) : null,
      },
    );
    return {
      items: page.items.map(toWithdrawalBody),
      nextCursor: page.nextCursor ? encodeWithdrawalCursor(page.nextCursor) : null,
    };
  }

  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read one Withdrawal owned by the Member" })
  @ApiOkResponse({ type: WithdrawalBody })
  async get(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") withdrawalId: string,
  ): Promise<WithdrawalBody> {
    try {
      const withdrawal = await this.withdrawals.getWithdrawal(
        request.memberAuth!.memberId,
        withdrawalId,
      );
      return toWithdrawalBody(withdrawal);
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Scoped Idempotency-Key for the Withdrawal cancel command",
  })
  @ApiOperation({
    summary: "Cancel a Withdrawal before payout; releases the Reservation through Wallet & Ledger",
  })
  @ApiOkResponse({ type: WithdrawalBody })
  async cancel(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") withdrawalId: string,
  ): Promise<WithdrawalBody | Prisma.JsonValue> {
    const key = requireIdempotencyKey(request);
    const member = request.memberAuth!;
    const correlationId = currentCorrelationId() ?? member.sessionId;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ withdrawalId }), "utf8")
      .digest("hex");
    const claim = await this.idempotency.claim({
      scope: `withdrawal:${member.memberId}:${withdrawalId}:cancel`,
      key,
      fingerprint,
      expiresAt: IDEMPOTENCY_CONTRACT_EXPIRY,
    });
    if (claim.kind === "existing") {
      if (claim.fingerprint !== fingerprint) {
        throw new ConflictException({
          code: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency-Key was already used with a different payload",
          details: {},
        });
      }
      if (
        claim.status === "COMPLETED" &&
        claim.responseCode !== null &&
        claim.responseBody !== null
      ) {
        if (claim.responseCode >= 400) {
          throw new HttpException(claim.responseBody as Record<string, unknown>, claim.responseCode);
        }
        return claim.responseBody;
      }
      throw new ConflictException({
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "The idempotent command has not completed",
        details: { status: claim.status },
      });
    }

    try {
      const withdrawal = await this.withdrawals.cancelWithdrawal(
        member.memberId,
        withdrawalId,
        correlationId,
      );
      const body = serializeJson(toWithdrawalBody(withdrawal));
      await this.idempotency.complete(claim.recordId, HttpStatus.OK, body);
      return body as Prisma.JsonValue;
    } catch (error) {
      const mapped = mapWithdrawalError(error);
      const response = mapped.getResponse() as Record<string, unknown>;
      await this.idempotency.complete(
        claim.recordId,
        mapped.getStatus(),
        serializeJson(response),
      );
      throw mapped;
    }
  }
}

export function toWithdrawalBody(record: WithdrawalRecord): WithdrawalBody {
  const view = toWithdrawalView(record);
  return {
    id: view.id,
    memberId: view.memberId,
    payoutDestinationId: view.payoutDestinationId,
    amountMinor: view.amountMinor.toString(),
    feeMinor: view.feeMinor.toString(),
    currency: view.currency,
    state: view.state,
    version: view.version,
    eligibilityOutcome: view.eligibilityOutcome,
    eligibilityReasonCodes: view.eligibilityReasonCodes,
    eligibilityEvidenceRefs: view.eligibilityEvidenceRefs,
    requiresApproval: view.requiresApproval,
    ledgerTransactionId: view.ledgerTransactionId,
    payoutEvidenceRef: view.payoutEvidenceRef,
    failureReason: view.failureReason,
    decisionReason: view.decisionReason,
    allowedActions: {
      member: [...view.allowedActions.member],
      admin: [...view.allowedActions.admin],
    },
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

export function requireIdempotencyKey(request: MemberAuthenticatedRequest): string {
  const key = request.header("idempotency-key")?.trim();
  if (!key) {
    throw new BadRequestException({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required for this withdrawal command",
      details: {},
    });
  }
  return key;
}

function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "INVALID_WITHDRAWAL_REQUEST",
      message: "Invalid withdrawal request",
      details: {},
    });
  }
  return parsed.data;
}

export function encodeWithdrawalCursor(cursor: WithdrawalCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeWithdrawalCursor(value: string): WithdrawalCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
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

export function mapWithdrawalError(error: unknown): HttpException {
  if (!(error instanceof WithdrawalError)) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  const body = { code: error.code, message: error.message, details: {} };
  switch (error.code) {
    case "INVALID":
      return new BadRequestException(body);
    case "NOT_FOUND":
      return new NotFoundException(body);
    case "INSUFFICIENT_FUNDS":
    case "WITHDRAWAL_BLOCKED":
    case "PAYOUT_DESTINATION_NOT_ELIGIBLE":
    case "PAYOUT_PROVIDER_REJECTED":
      return new UnprocessableEntityException(body);
    default:
      return new ConflictException(body);
  }
}

export function serializeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { WithdrawalService } from "../../../src/contexts/payments/application/withdrawal.service";
import {
  WITHDRAWAL_QUEUES,
  WITHDRAWAL_SEVERITIES,
  WITHDRAWAL_STATES,
  type WithdrawalQueue,
  type WithdrawalState,
} from "../../../src/contexts/payments/domain/withdrawal";
import {
  toWithdrawalView,
  type WithdrawalRecord,
} from "../../../src/contexts/payments/domain/withdrawal.repository";
import { currentCorrelationId } from "./correlation";
import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest,
} from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import {
  WithdrawalReviewService,
  type WithdrawalReviewActor,
} from "./withdrawal-review.service";
import {
  decodeWithdrawalCursor,
  encodeWithdrawalCursor,
  toWithdrawalBody,
} from "./member-withdrawal.controller";

class AdminWithdrawalBody {
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

  @ApiProperty({ enum: [...WITHDRAWAL_STATES] })
  state!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ enum: ["ALLOW", "REVIEW_REQUIRED", "DENY"] })
  eligibilityOutcome!: string;

  @ApiProperty({ type: [String] })
  eligibilityReasonCodes!: readonly string[];

  @ApiProperty({ type: [String] })
  eligibilityEvidenceRefs!: readonly string[];

  @ApiProperty({ type: Boolean, description: "True when the Approval queue owns the item" })
  requiresApproval!: boolean;

  @ApiProperty({ enum: [...WITHDRAWAL_SEVERITIES] })
  severity!: string;

  @ApiProperty({ enum: [...WITHDRAWAL_QUEUES], nullable: true })
  queue!: string | null;

  @ApiProperty({
    type: Object,
    additionalProperties: false,
    description: "Currently allowed commands; never inferred from status alone",
  })
  allowedActions!: { member: readonly string[]; admin: readonly string[] };

  @ApiProperty({ type: Number, description: "Recorded reconciliation attempts" })
  reconciliationAttempts!: number;

  @ApiProperty({ type: String, nullable: true })
  providerTransactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  payoutEvidenceRef!: string | null;

  @ApiProperty({ type: String, nullable: true })
  ledgerTransactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  decidedByAdminId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  decisionReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  incomingProviderError!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class AdminWithdrawalListBody {
  @ApiProperty({ type: [AdminWithdrawalBody] })
  items!: readonly AdminWithdrawalBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

class AdminWithdrawalTimelineEntry {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: [...WITHDRAWAL_STATES], nullable: true })
  fromState!: string | null;

  @ApiProperty({ enum: [...WITHDRAWAL_STATES] })
  toState!: string;

  @ApiProperty({ enum: ["MEMBER", "ADMIN", "SYSTEM", "PROVIDER"] })
  actorType!: string;

  @ApiProperty({ type: String, nullable: true })
  actorId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  evidenceRef!: string | null;

  @ApiProperty({ type: String })
  correlationId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
}

class AdminWithdrawalDetailBody {
  @ApiProperty({ type: AdminWithdrawalBody })
  withdrawal!: AdminWithdrawalBody;

  @ApiProperty({ type: [AdminWithdrawalTimelineEntry] })
  timeline!: readonly AdminWithdrawalTimelineEntry[];
}

class WithdrawalCommandBody {
  @ApiProperty({
    type: String,
    example: "Destination and payout evidence verified by review",
  })
  reason!: string;
}

class ApiErrorResponse {
  @ApiProperty({ type: String, example: "WITHDRAWAL_STATE_CONFLICT" })
  code!: string;

  @ApiProperty({ type: String })
  message!: string;

  @ApiProperty({ type: Object, additionalProperties: true })
  details!: Record<string, unknown>;

  @ApiProperty({ type: String })
  correlationId!: string;
}

@ApiTags("Admin Withdrawals")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
@RequireAdminCapabilities("withdrawal.read")
@Controller("api/v1/admin/withdrawals")
export class AdminWithdrawalController {
  constructor(
    @Inject(WithdrawalService)
    private readonly withdrawals: WithdrawalService,
    @Inject(WithdrawalReviewService)
    private readonly review: WithdrawalReviewService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "List the withdrawal review, approval, payout and reconciliation queues with severity and evidence",
  })
  @ApiQuery({ name: "queue", required: false, enum: [...WITHDRAWAL_QUEUES] })
  @ApiQuery({ name: "state", required: false, enum: [...WITHDRAWAL_STATES] })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 50 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: AdminWithdrawalListBody })
  async list(
    @Query()
    query: { queue?: string; state?: string; limit?: string; cursor?: string },
  ): Promise<AdminWithdrawalListBody> {
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "limit must be an integer from 1 to 100",
        details: { field: "limit" },
      });
    }
    const queue = query.queue as WithdrawalQueue | undefined;
    if (queue !== undefined && !WITHDRAWAL_QUEUES.includes(queue)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "queue is not a supported withdrawal queue",
        details: { field: "queue" },
      });
    }
    const state = query.state as WithdrawalState | undefined;
    if (state !== undefined && !WITHDRAWAL_STATES.includes(state)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "state is not a supported withdrawal state",
        details: { field: "state" },
      });
    }

    const page = await this.withdrawals.listWithdrawals({
      limit,
      ...(queue ? { queue } : {}),
      ...(state ? { state } : {}),
      ...(query.cursor ? { cursor: decodeWithdrawalCursor(query.cursor) } : {}),
    });
    return {
      items: page.items.map(toAdminWithdrawalBody),
      nextCursor: page.nextCursor ? encodeWithdrawalCursor(page.nextCursor) : null,
    };
  }

  @Get(":id")
  @ApiOperation({
    summary: "Withdrawal detail with eligibility evidence and the workflow timeline",
  })
  @ApiParam({ name: "id", type: String })
  @ApiOkResponse({ type: AdminWithdrawalDetailBody })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  async getById(@Param("id") withdrawalId: string): Promise<AdminWithdrawalDetailBody> {
    try {
      const withdrawal = await this.withdrawals.getWithdrawalForAdministration(withdrawalId);
      const timeline = await this.withdrawals.listEvents(withdrawalId);
      return {
        withdrawal: toAdminWithdrawalBody(withdrawal),
        timeline: timeline.map((entry) => ({
          id: entry.id,
          fromState: entry.fromState,
          toState: entry.toState,
          actorType: entry.actorType,
          actorId: entry.actorId,
          reason: entry.reason,
          evidenceRef: entry.evidenceRef,
          correlationId: entry.correlationId,
          createdAt: entry.createdAt,
        })),
      };
    } catch {
      throw new HttpException(
        {
          code: "WITHDRAWAL_NOT_FOUND",
          message: "Withdrawal not found",
          details: {},
          correlationId: currentCorrelationId() ?? "",
        },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("withdrawal.review")
  @ApiOperation({ summary: "Approve the withdrawal review and release it for payout" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: WithdrawalCommandBody })
  @ApiOkResponse({ type: AdminWithdrawalBody })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async approve(
    @Param("id") withdrawalId: string,
    @Body() body: WithdrawalCommandBody,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Prisma.JsonValue> {
    const actor = requiredAdmin(request);
    const reason = requireReason(body);
    const result = await this.review.approve({
      withdrawalId,
      actor,
      reason,
      correlationId: correlationIdFor(request),
      idempotencyKey: request.header("idempotency-key"),
    });
    return commandResultOrThrow(result);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("withdrawal.review")
  @ApiOperation({
    summary: "Reject the withdrawal review; the Reservation is released authoritatively",
  })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: WithdrawalCommandBody })
  @ApiOkResponse({ type: AdminWithdrawalBody })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async reject(
    @Param("id") withdrawalId: string,
    @Body() body: WithdrawalCommandBody,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Prisma.JsonValue> {
    const actor = requiredAdmin(request);
    const reason = requireReason(body);
    const result = await this.review.reject({
      withdrawalId,
      actor,
      reason,
      correlationId: correlationIdFor(request),
      idempotencyKey: request.header("idempotency-key"),
    });
    return commandResultOrThrow(result);
  }

  @Post(":id/payout")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("withdrawal.payout")
  @ApiOperation({
    summary:
      "Request the external payout for an approved withdrawal; an unknown outcome enters reconciliation",
  })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: WithdrawalCommandBody })
  @ApiOkResponse({ type: AdminWithdrawalBody })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async payout(
    @Param("id") withdrawalId: string,
    @Body() body: WithdrawalCommandBody,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Prisma.JsonValue> {
    const actor = requiredAdmin(request);
    const result = await this.review.requestPayout({
      withdrawalId,
      actor,
      reason: body?.reason ?? "Payout requested",
      correlationId: correlationIdFor(request),
      idempotencyKey: request.header("idempotency-key"),
    });
    return commandResultOrThrow(result);
  }

  @Post(":id/reconcile")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("withdrawal.payout")
  @ApiOperation({
    summary:
      "Reconcile an in-flight or ambiguous payout by provider reference; never re-initiates payout",
  })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: WithdrawalCommandBody })
  @ApiOkResponse({ type: AdminWithdrawalBody })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async reconcile(
    @Param("id") withdrawalId: string,
    @Body() body: WithdrawalCommandBody,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Prisma.JsonValue> {
    const actor = requiredAdmin(request);
    const result = await this.review.reconcile({
      withdrawalId,
      actor,
      reason: body?.reason ?? "Payout reconciliation",
      correlationId: correlationIdFor(request),
      idempotencyKey: request.header("idempotency-key"),
    });
    return commandResultOrThrow(result);
  }

  @Post(":id/finalize")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("withdrawal.payout")
  @ApiOperation({
    summary:
      "Finalize a confirmed payout: consume the Reservation and post WITHDRAWAL_FINALIZE exactly once",
  })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: WithdrawalCommandBody })
  @ApiOkResponse({ type: AdminWithdrawalBody })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async finalize(
    @Param("id") withdrawalId: string,
    @Body() body: WithdrawalCommandBody,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Prisma.JsonValue> {
    const actor = requiredAdmin(request);
    const result = await this.review.finalize({
      withdrawalId,
      actor,
      reason: body?.reason ?? "Withdrawal finalization",
      correlationId: correlationIdFor(request),
      idempotencyKey: request.header("idempotency-key"),
    });
    return commandResultOrThrow(result);
  }
}

function toAdminWithdrawalBody(record: WithdrawalRecord): AdminWithdrawalBody {
  const view = toWithdrawalView(record);
  const memberBody = toWithdrawalBody(record);
  return {
    ...memberBody,
    severity: view.severity,
    queue: view.queue,
    reconciliationAttempts: record.reconciliationAttempts,
    providerTransactionId: record.providerTransactionId,
    decidedByAdminId: record.decidedByAdminId,
    incomingProviderError: record.incomingProviderError,
  };
}

function requiredAdmin(request: AdminAuthenticatedRequest): WithdrawalReviewActor {
  const admin = request.adminAuth;
  if (!admin) {
    throw new HttpException(
      {
        code: "AUTHENTICATION_REQUIRED",
        message: "Admin authentication required",
        details: {},
        correlationId: currentCorrelationId() ?? "",
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
  return {
    adminId: admin.adminId,
    sessionId: admin.sessionId,
    role: admin.role,
    capabilities: admin.capabilities,
  };
}

function requireReason(body: WithdrawalCommandBody): string {
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "reason is required for this governed withdrawal command",
      details: { field: "reason" },
    });
  }
  return reason;
}

function commandResultOrThrow(result: {
  statusCode: number;
  body: Prisma.JsonValue;
}): Prisma.JsonValue {
  if (result.statusCode >= 400) {
    throw new HttpException(result.body as Record<string, unknown>, result.statusCode);
  }
  return result.body;
}

function correlationIdFor(request: AdminAuthenticatedRequest): string {
  return currentCorrelationId() ?? request.header("x-correlation-id") ?? "";
}

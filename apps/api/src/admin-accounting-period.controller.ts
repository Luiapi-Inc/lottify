import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { AccountingPeriodService } from "../../../src/contexts/wallet-ledger/application/accounting-period.service";
import {
  ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS,
  ACCOUNTING_PERIOD_CANCELLATION_ACTION_CLASS,
  AccountingPeriodApprovalService,
} from "./accounting-period-approval.service";
import { AdminAuthService } from "../../../src/contexts/identity-access/application/admin-auth.service";
import {
  ACCOUNTING_PERIOD_GENERATION_KINDS,
  ACCOUNTING_PERIOD_MODES,
  ACCOUNTING_PERIOD_STATES,
  ACCOUNTING_TIME_ZONE,
  AccountingPeriodRuleError,
  type AccountingPeriodCommandResult,
  type AccountingPeriodView,
} from "../../../src/contexts/wallet-ledger/domain/accounting-period";
import { IdempotencyService } from "../../../src/platform/idempotency/idempotency.service";
import { currentCorrelationId } from "./correlation";
import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest,
} from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";

const IDEMPOTENCY_CONTRACT_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

class AccountingPeriodResponse {
  @ApiProperty({ type: String, description: "Opaque immutable Accounting Period identity" })
  id!: string;

  @ApiProperty({ enum: [...ACCOUNTING_PERIOD_MODES] })
  mode!: AccountingPeriodView["mode"];

  @ApiProperty({ enum: [...ACCOUNTING_PERIOD_GENERATION_KINDS] })
  generationKind!: AccountingPeriodView["generationKind"];

  @ApiProperty({ type: String, format: "date-time" })
  effectiveStart!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveEnd!: Date;

  @ApiProperty({ enum: [ACCOUNTING_TIME_ZONE] })
  accountingTimezone!: typeof ACCOUNTING_TIME_ZONE;

  @ApiProperty({ enum: [...ACCOUNTING_PERIOD_STATES] })
  state!: AccountingPeriodView["state"];

  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Admin actor that created the Custom proposal",
  })
  createdByAdminId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Admin actor that initiated governed SCHEDULED cancellation",
  })
  cancellationRequestedByAdminId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Immutable reason for a pending or completed governed cancellation",
  })
  cancellationReason!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  cancellationRequestedAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;

  @ApiProperty({ type: [String], description: "Currently permitted explicit commands" })
  allowedActions!: readonly string[];
}

class AccountingPeriodPreviewPeriodResponse {
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Persisted Automatic period id when already generated",
  })
  id!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveStart!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveEnd!: Date;

  @ApiProperty({ enum: ["NOMINAL_WEEK"] })
  generationKind!: "NOMINAL_WEEK";
}

class AccountingPeriodResidualFragmentResponse {
  @ApiProperty({ type: String, nullable: true })
  sourcePeriodId!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveStart!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveEnd!: Date;

  @ApiProperty({ enum: ["DERIVED_FRAGMENT"] })
  generationKind!: "DERIVED_FRAGMENT";
}

class AccountingPeriodReplacementPreviewResponse {
  @ApiProperty({ type: [AccountingPeriodPreviewPeriodResponse] })
  affectedAutomaticPeriods!: readonly AccountingPeriodPreviewPeriodResponse[];

  @ApiProperty({ type: [AccountingPeriodResidualFragmentResponse] })
  residualFragments!: readonly AccountingPeriodResidualFragmentResponse[];
}

class AccountingPeriodCommandResponse {
  @ApiProperty({ type: AccountingPeriodResponse })
  period!: AccountingPeriodResponse;

  @ApiProperty({ type: AccountingPeriodReplacementPreviewResponse })
  replacementPreview!: AccountingPeriodReplacementPreviewResponse;
}

class CreateCustomAccountingPeriodBody {
  @ApiProperty({ type: String, format: "date", example: "2026-09-08" })
  startDate!: string;

  @ApiProperty({ type: String, format: "date", example: "2026-09-18" })
  endDate!: string;

  @ApiProperty({
    type: String,
    example: "Align the future close window with an operational cycle",
  })
  reason!: string;
}

class SubmitAccountingPeriodBody {
  @ApiProperty({ type: Number, minimum: 1, example: 1 })
  expectedVersion!: number;
}

class ApproveAccountingPeriodBody {
  @ApiProperty({ type: Number, minimum: 1, example: 2 })
  expectedVersion!: number;
}

class CancelAccountingPeriodBody {
  @ApiProperty({ type: Number, minimum: 1, example: 2 })
  expectedVersion!: number;

  @ApiProperty({
    type: String,
    example: "Operational exception no longer requires the Custom window",
  })
  reason!: string;
}

class AccountingPeriodCancellationResponse {
  @ApiProperty({ type: AccountingPeriodResponse })
  period!: AccountingPeriodResponse;
}

class ApiErrorResponse {
  @ApiProperty({ type: String, example: "VERSION_CONFLICT" })
  code!: string;

  @ApiProperty({ type: String })
  message!: string;

  @ApiProperty({ type: Object, additionalProperties: true })
  details!: Record<string, unknown>;

  @ApiProperty({ type: String })
  correlationId!: string;
}

@ApiTags("Admin Accounting Periods")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
@RequireAdminCapabilities("accounting-period.read")
@Controller("api/v1/admin/accounting-periods")
export class AdminAccountingPeriodController {
  constructor(
    @Inject(AccountingPeriodService)
    private readonly accountingPeriods: AccountingPeriodService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(AdminAuthService)
    private readonly adminAuth: AdminAuthService,
    @Inject(AccountingPeriodApprovalService)
    private readonly approvals: AccountingPeriodApprovalService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List authoritative Accounting Periods" })
  @ApiOkResponse({ type: [AccountingPeriodResponse] })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  list(@Req() request: AdminAuthenticatedRequest): Promise<readonly AccountingPeriodView[]> {
    return this.accountingPeriods.list(viewOptions(request));
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one authoritative Accounting Period" })
  @ApiParam({
    name: "id",
    type: String,
    description: "Opaque immutable Accounting Period identity",
  })
  @ApiOkResponse({ type: AccountingPeriodResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  async getById(
    @Param("id") id: string,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<AccountingPeriodView> {
    try {
      return await this.accountingPeriods.getById(id, viewOptions(request));
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.NOT_FOUND) {
        throw apiError(
          request,
          HttpStatus.NOT_FOUND,
          "ACCOUNTING_PERIOD_NOT_FOUND",
          "Accounting Period not found",
          {},
        );
      }
      throw error;
    }
  }

  @Post("create-custom")
  @RequireAdminCapabilities("accounting-period.create-custom")
  @ApiOperation({
    summary: "Create a governed Custom Accounting Period DRAFT and replacement preview",
  })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateCustomAccountingPeriodBody })
  @ApiCreatedResponse({ type: AccountingPeriodCommandResponse })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async createCustom(
    @Body() body: CreateCustomAccountingPeriodBody,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<AccountingPeriodCommandResult | Prisma.JsonValue> {
    const admin = requiredAdmin(request);
    const parsed = parseCreateCustomBody(body, request);
    return this.executeIdempotent({
      request,
      key: idempotencyKey,
      scope: `admin:${admin.adminId}:accounting-period:create-custom`,
      fingerprintPayload: parsed,
      responseCode: HttpStatus.CREATED,
      execute: () =>
        this.accountingPeriods.createCustom({
          ...parsed,
          createdByAdminId: admin.adminId,
        }),
    });
  }

  @Post(":id/submit")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("accounting-period.submit")
  @ApiOperation({ summary: "Submit a Custom Accounting Period DRAFT for approval" })
  @ApiParam({ name: "id", type: String, description: "Opaque Accounting Period identity" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: SubmitAccountingPeriodBody })
  @ApiOkResponse({ type: AccountingPeriodCommandResponse })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async submit(
    @Param("id") id: string,
    @Body() body: SubmitAccountingPeriodBody,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<AccountingPeriodCommandResult | Prisma.JsonValue> {
    const admin = requiredAdmin(request);
    const parsed = parseSubmitBody(body, request);
    return this.executeIdempotent({
      request,
      key: idempotencyKey,
      scope: `admin:${admin.adminId}:accounting-period:${id}:submit`,
      fingerprintPayload: { id, ...parsed },
      responseCode: HttpStatus.OK,
      execute: () => this.accountingPeriods.submitCustom({ id, ...parsed }),
    });
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("accounting-period.approve")
  @ApiOperation({ summary: "Approve and schedule a pending Custom Accounting Period" })
  @ApiParam({ name: "id", type: String, description: "Opaque Accounting Period identity" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ApproveAccountingPeriodBody })
  @ApiOkResponse({ type: AccountingPeriodCommandResponse })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async approve(
    @Param("id") id: string,
    @Body() body: ApproveAccountingPeriodBody,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Prisma.JsonValue> {
    const admin = requiredAdmin(request);
    const parsed = parseApproveBody(body, request);
    const key = idempotencyKey?.trim();
    if (!key) {
      throw apiError(
        request,
        HttpStatus.BAD_REQUEST,
        "VALIDATION_ERROR",
        "Idempotency-Key header is required",
        { header: "Idempotency-Key" },
      );
    }
    const correlationId = correlationIdFor(request);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ id, ...parsed }), "utf8")
      .digest("hex");
    const claim = await this.idempotency.claim({
      scope: `admin:${admin.adminId}:accounting-period:${id}:approve`,
      key,
      fingerprint,
      expiresAt: IDEMPOTENCY_CONTRACT_EXPIRY,
    });

    if (claim.kind === "existing") {
      if (claim.fingerprint !== fingerprint) {
        throw apiError(
          request,
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different payload",
          {},
        );
      }
      if (
        claim.status === "COMPLETED" &&
        claim.responseCode !== null &&
        claim.responseBody !== null
      ) {
        return approvalResultOrThrow({
          statusCode: claim.responseCode,
          body: claim.responseBody,
        });
      }
      if (claim.status !== "IN_PROGRESS") {
        throw apiError(
          request,
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_IN_PROGRESS",
          "The idempotent command cannot be resumed from its current status",
          { status: claim.status },
        );
      }
    }

    const idempotencyRecordId = claim.recordId;
    let reauthEvidence;
    try {
      reauthEvidence = await this.adminAuth.requireFreshMfa(
        admin,
        ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS,
      );
    } catch {
      const denied = await this.approvals.denyMissingReauth({
        id,
        expectedVersion: parsed.expectedVersion,
        actor: admin,
        correlationId,
        idempotencyRecordId,
        fingerprint,
      });
      return approvalResultOrThrow(denied);
    }

    const result = await this.approvals.approveCustom({
      id,
      expectedVersion: parsed.expectedVersion,
      actor: admin,
      reauthEvidence,
      correlationId,
      idempotencyRecordId,
      fingerprint,
    });
    return approvalResultOrThrow(result);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("accounting-period.cancel")
  @ApiOperation({
    summary: "Cancel or withdraw a pre-OPEN Custom Accounting Period",
  })
  @ApiParam({ name: "id", type: String, description: "Opaque Accounting Period identity" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CancelAccountingPeriodBody })
  @ApiOkResponse({ type: AccountingPeriodCancellationResponse })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiConflictResponse({ type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async cancel(
    @Param("id") id: string,
    @Body() body: CancelAccountingPeriodBody,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Prisma.JsonValue> {
    const admin = requiredAdmin(request);
    const parsed = parseCancelBody(body, request);
    const key = idempotencyKey?.trim();
    if (!key) {
      throw apiError(
        request,
        HttpStatus.BAD_REQUEST,
        "VALIDATION_ERROR",
        "Idempotency-Key header is required",
        { header: "Idempotency-Key" },
      );
    }
    const correlationId = correlationIdFor(request);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ id, ...parsed }), "utf8")
      .digest("hex");
    const claim = await this.idempotency.claim({
      scope: `admin:${admin.adminId}:accounting-period:${id}:cancel`,
      key,
      fingerprint,
      expiresAt: IDEMPOTENCY_CONTRACT_EXPIRY,
    });

    if (claim.kind === "existing") {
      if (claim.fingerprint !== fingerprint) {
        throw apiError(
          request,
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different payload",
          {},
        );
      }
      if (
        claim.status === "COMPLETED" &&
        claim.responseCode !== null &&
        claim.responseBody !== null
      ) {
        return approvalResultOrThrow({
          statusCode: claim.responseCode,
          body: claim.responseBody,
        });
      }
      if (claim.status !== "IN_PROGRESS") {
        throw apiError(
          request,
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_IN_PROGRESS",
          "The idempotent command cannot be resumed from its current status",
          { status: claim.status },
        );
      }
    }

    let currentPeriod: AccountingPeriodView | undefined;
    try {
      currentPeriod = await this.accountingPeriods.getById(id, viewOptions(request));
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.NOT_FOUND) {
        currentPeriod = undefined;
      } else {
        throw error;
      }
    }

    let reauthEvidence;
    if (
      currentPeriod?.state === "SCHEDULED" &&
      currentPeriod.cancellationRequestedByAdminId !== null
    ) {
      try {
        reauthEvidence = await this.adminAuth.requireFreshMfa(
          admin,
          ACCOUNTING_PERIOD_CANCELLATION_ACTION_CLASS,
        );
      } catch {
        reauthEvidence = undefined;
      }
    }

    const result = await this.approvals.cancelCustom({
      id,
      expectedVersion: parsed.expectedVersion,
      reason: parsed.reason,
      actor: admin,
      reauthEvidence,
      correlationId,
      idempotencyRecordId: claim.recordId,
      fingerprint,
    });
    return approvalResultOrThrow(result);
  }

  private async executeIdempotent(input: {
    request: AdminAuthenticatedRequest;
    key: string | undefined;
    scope: string;
    fingerprintPayload: Readonly<Record<string, unknown>>;
    responseCode: number;
    execute: () => Promise<AccountingPeriodCommandResult>;
  }): Promise<AccountingPeriodCommandResult | Prisma.JsonValue> {
    const key = input.key?.trim();
    if (!key) {
      throw apiError(
        input.request,
        HttpStatus.BAD_REQUEST,
        "VALIDATION_ERROR",
        "Idempotency-Key header is required",
        { header: "Idempotency-Key" },
      );
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input.fingerprintPayload), "utf8")
      .digest("hex");
    const claim = await this.idempotency.claim({
      scope: input.scope,
      key,
      fingerprint,
      expiresAt: IDEMPOTENCY_CONTRACT_EXPIRY,
    });

    if (claim.kind === "existing") {
      if (claim.fingerprint !== fingerprint) {
        throw apiError(
          input.request,
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different payload",
          {},
        );
      }
      if (claim.status === "COMPLETED" && claim.responseBody !== null) {
        if (claim.responseCode !== null && claim.responseCode >= 400) {
          throw new HttpException(
            claim.responseBody as Record<string, unknown>,
            claim.responseCode,
          );
        }
        return claim.responseBody;
      }
      throw apiError(
        input.request,
        HttpStatus.CONFLICT,
        "IDEMPOTENCY_IN_PROGRESS",
        "The idempotent command has not completed",
        { status: claim.status },
      );
    }

    try {
      const result = await input.execute();
      const serialized = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      await this.idempotency.complete(claim.recordId, input.responseCode, serialized);
      return result;
    } catch (error) {
      const mapped = mapCommandError(input.request, error);
      if (mapped instanceof HttpException) {
        const response = mapped.getResponse();
        const serialized = JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue;
        await this.idempotency.complete(claim.recordId, mapped.getStatus(), serialized);
        throw mapped;
      }
      await this.idempotency.fail(claim.recordId);
      throw mapped;
    }
  }
}

function canSubmit(request: AdminAuthenticatedRequest): boolean {
  return request.adminAuth?.capabilities.includes("accounting-period.submit") === true;
}

function canApprove(request: AdminAuthenticatedRequest): boolean {
  return request.adminAuth?.capabilities.includes("accounting-period.approve") === true;
}

function canCancel(request: AdminAuthenticatedRequest): boolean {
  return request.adminAuth?.capabilities.includes("accounting-period.cancel") === true;
}

function viewOptions(request: AdminAuthenticatedRequest) {
  const admin = request.adminAuth;
  return {
    canSubmit: canSubmit(request),
    canApprove: canApprove(request),
    canCancel: canCancel(request),
    actorAdminId: admin?.adminId,
    canSelfApprove: admin?.role === "SUPER_ADMIN",
  };
}

function requiredAdmin(request: AdminAuthenticatedRequest) {
  const admin = request.adminAuth;
  if (!admin) {
    throw apiError(
      request,
      HttpStatus.UNAUTHORIZED,
      "AUTHENTICATION_REQUIRED",
      "Admin authentication required",
      {},
    );
  }
  return admin;
}

function parseCreateCustomBody(
  body: CreateCustomAccountingPeriodBody,
  request: AdminAuthenticatedRequest,
): { startDate: string; endDate: string; reason: string } {
  if (
    !body ||
    typeof body.startDate !== "string" ||
    typeof body.endDate !== "string" ||
    typeof body.reason !== "string"
  ) {
    throw apiError(
      request,
      HttpStatus.BAD_REQUEST,
      "VALIDATION_ERROR",
      "startDate, endDate and reason are required",
      {},
    );
  }
  return { startDate: body.startDate, endDate: body.endDate, reason: body.reason };
}

function parseSubmitBody(
  body: SubmitAccountingPeriodBody,
  request: AdminAuthenticatedRequest,
): { expectedVersion: number } {
  if (!body || typeof body.expectedVersion !== "number") {
    throw apiError(
      request,
      HttpStatus.BAD_REQUEST,
      "VALIDATION_ERROR",
      "expectedVersion is required",
      { field: "expectedVersion" },
    );
  }
  return { expectedVersion: body.expectedVersion };
}

function parseApproveBody(
  body: ApproveAccountingPeriodBody,
  request: AdminAuthenticatedRequest,
): { expectedVersion: number } {
  if (!body || typeof body.expectedVersion !== "number") {
    throw apiError(
      request,
      HttpStatus.BAD_REQUEST,
      "VALIDATION_ERROR",
      "expectedVersion is required",
      { field: "expectedVersion" },
    );
  }
  return { expectedVersion: body.expectedVersion };
}

function parseCancelBody(
  body: CancelAccountingPeriodBody,
  request: AdminAuthenticatedRequest,
): { expectedVersion: number; reason: string } {
  if (
    !body ||
    typeof body.expectedVersion !== "number" ||
    typeof body.reason !== "string"
  ) {
    throw apiError(
      request,
      HttpStatus.BAD_REQUEST,
      "VALIDATION_ERROR",
      "expectedVersion and reason are required",
      {},
    );
  }
  return { expectedVersion: body.expectedVersion, reason: body.reason };
}

function mapCommandError(request: AdminAuthenticatedRequest, error: unknown): unknown {
  if (!(error instanceof AccountingPeriodRuleError)) return error;
  if (error.code === "VALIDATION_ERROR") {
    return apiError(request, HttpStatus.BAD_REQUEST, error.code, error.message, error.details);
  }
  if (error.code === "ACCOUNTING_PERIOD_NOT_FOUND") {
    return apiError(request, HttpStatus.NOT_FOUND, error.code, error.message, error.details);
  }
  if (error.code === "ACCOUNTING_PERIOD_SELF_APPROVAL_FORBIDDEN") {
    return apiError(request, HttpStatus.FORBIDDEN, error.code, error.message, error.details);
  }
  if (error.code === "ACCOUNTING_PERIOD_CANCELLATION_FORBIDDEN") {
    return apiError(request, HttpStatus.FORBIDDEN, error.code, error.message, error.details);
  }
  return apiError(request, HttpStatus.CONFLICT, error.code, error.message, error.details);
}

function approvalResultOrThrow(result: {
  statusCode: number;
  body: Prisma.JsonValue;
}): Prisma.JsonValue {
  if (result.statusCode >= 400) {
    throw new HttpException(result.body as Record<string, unknown>, result.statusCode);
  }
  return result.body;
}

function correlationIdFor(request: AdminAuthenticatedRequest): string {
  return currentCorrelationId() ?? request.header("x-correlation-id") ?? randomUUID();
}

function apiError(
  request: AdminAuthenticatedRequest,
  status: number,
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
): HttpException {
  const correlationId = correlationIdFor(request);
  return new HttpException({ code, message, details, correlationId }, status);
}

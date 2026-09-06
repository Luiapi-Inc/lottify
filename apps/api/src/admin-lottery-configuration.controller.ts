import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiProperty, ApiQuery, ApiTags } from "@nestjs/swagger";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AdminAuthService } from "../../../src/contexts/identity-access/application/admin-auth.service";
import {
  LotteryConfigurationRuleError,
  LOTTERY_CONFIGURATION_STATES,
  LotteryConfigurationService,
  type LotteryConfigurationState,
} from "../../../src/contexts/lottery/application/lottery-configuration.service";
import { IdempotencyService } from "../../../src/platform/idempotency/idempotency.service";
import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest,
} from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import { currentCorrelationId } from "./correlation";

export const LOTTERY_CONFIGURATION_APPROVAL_ACTION_CLASS = "lottery-configuration.publish";
const IDEMPOTENCY_CONTRACT_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

class CreateBetTypeBody {
  @ApiProperty({ type: String, example: "TWO_DIGIT" })
  code!: string;
}

class CreateBetTypeVersionBody {
  @ApiProperty({ type: Number, example: 1 })
  version!: number;
  @ApiProperty({ type: String, example: "00" })
  canonicalNumberFormat!: string;
  @ApiProperty({ type: String, example: "^\\d{2}$" })
  validationPattern!: string;
  @ApiProperty({ type: Object, example: { kind: "FIXED", amountMinor: 9000 } })
  defaultPayout!: Record<string, unknown>;
  @ApiProperty({ type: String, example: "100" })
  minStakeMinor!: string;
  @ApiProperty({ type: String, example: "100000" })
  maxStakeMinor!: string;
  @ApiProperty({ type: String, example: "limit-v1" })
  limitPolicyRef!: string;
  @ApiProperty({ type: String, example: "restriction-v1" })
  restrictionPolicyRef!: string;
  @ApiProperty({ type: String, example: "settlement-v1" })
  settlementRuleVersionRef!: string;
  @ApiProperty({ type: String, example: "2099-01-01T00:00:00.000Z" })
  effectiveFrom!: string;
  @ApiProperty({ type: String, required: false, example: "2099-06-01T00:00:00.000Z" })
  effectiveUntil?: string;
  @ApiProperty({ type: String, required: false })
  reason?: string;
}

class CreateProductVersionBody {
  @ApiProperty({ type: Number, example: 1 })
  version!: number;
  @ApiProperty({ type: String, example: "Asia/Bangkok" })
  timezone!: string;
  @ApiProperty({ type: String, example: "schedule-v1" })
  scheduleTemplateRef!: string;
  @ApiProperty({ type: String, example: "result-v1" })
  resultSchemaVersionRef!: string;
  @ApiProperty({ type: String, example: "settlement-v1" })
  settlementRuleVersionRef!: string;
  @ApiProperty({ type: String, example: "payout-v1" })
  defaultPayoutPolicyRef!: string;
  @ApiProperty({ type: String, example: "limit-v1" })
  defaultLimitPolicyRef!: string;
  @ApiProperty({ type: String, example: "restriction-v1" })
  defaultRestrictionPolicyRef!: string;
  @ApiProperty({ type: String, example: "2099-01-01T00:00:00.000Z" })
  effectiveFrom!: string;
  @ApiProperty({ type: String, required: false, example: "2099-06-01T00:00:00.000Z" })
  effectiveUntil?: string;
  @ApiProperty({ type: String, required: false })
  reason?: string;
  @ApiProperty({ type: () => [EnabledBetTypeReferenceBody] })
  enabledBetTypes!: Array<{ betTypeId: string; betTypeVersionId: string }>;
}

class EnabledBetTypeReferenceBody {
  @ApiProperty({ type: String, format: "uuid" })
  betTypeId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  betTypeVersionId!: string;
}

class ExpectedVersionBody {
  @ApiProperty({ type: Number, example: 1 })
  expectedVersion!: number;
}

@ApiTags("admin-lottery-configuration")
@ApiBearerAuth()
@Controller("api/v1/admin/lottery")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminLotteryConfigurationController {
  constructor(
    @Inject(LotteryConfigurationService)
    private readonly configuration: LotteryConfigurationService,
    @Inject(AdminAuthService)
    private readonly adminAuth: AdminAuthService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get("products")
  @RequireAdminCapabilities("lottery-configuration.read")
  @ApiOperation({ summary: "List Lottery Products and configuration version summaries" })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "state", required: false, enum: [...LOTTERY_CONFIGURATION_STATES] })
  async listProducts(
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("state") state: string | undefined,
  ): Promise<unknown> {
    return this.configuration.listProducts({ limit: parseLimit(limit), cursor: cursor?.trim() || undefined, state: parseState(state) });
  }

  @Get("products/:id")
  @RequireAdminCapabilities("lottery-configuration.read")
  @ApiOperation({ summary: "Get a Lottery Product and its configuration versions" })
  @ApiQuery({ name: "state", required: false, enum: [...LOTTERY_CONFIGURATION_STATES] })
  async getProduct(@Param("id") id: string, @Query("state") state: string | undefined): Promise<unknown> {
    return this.configuration.getProduct(id, parseState(state));
  }

  @Get("bet-types")
  @RequireAdminCapabilities("lottery-configuration.read")
  @ApiOperation({ summary: "List Lottery Bet Types and configuration version summaries" })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "state", required: false, enum: [...LOTTERY_CONFIGURATION_STATES] })
  async listBetTypes(
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("state") state: string | undefined,
  ): Promise<unknown> {
    return this.configuration.listBetTypes({ limit: parseLimit(limit), cursor: cursor?.trim() || undefined, state: parseState(state) });
  }

  @Get("bet-types/:id")
  @RequireAdminCapabilities("lottery-configuration.read")
  @ApiOperation({ summary: "Get a Lottery Bet Type and its configuration versions" })
  @ApiQuery({ name: "state", required: false, enum: [...LOTTERY_CONFIGURATION_STATES] })
  async getBetType(@Param("id") id: string, @Query("state") state: string | undefined): Promise<unknown> {
    return this.configuration.getBetType(id, parseState(state));
  }

  @Post("products")
  @RequireAdminCapabilities("lottery-configuration.create")
  @ApiOperation({ summary: "Create a Lottery Product identity" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  async createProduct(
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    return this.executeIdempotent(request, key, `admin:${admin.adminId}:lottery:product:create`, {}, 201, () =>
      this.configuration.createProduct({ actor: admin }),
    );
  }

  @Post("bet-types")
  @RequireAdminCapabilities("lottery-configuration.create")
  @ApiOperation({ summary: "Create a Lottery Bet Type identity" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateBetTypeBody })
  async createBetType(
    @Body() body: CreateBetTypeBody,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const code = requireString(body?.code, "code", request);
    return this.executeIdempotent(request, key, `admin:${admin.adminId}:lottery:bet-type:create`, { code }, 201, () =>
      this.configuration.createBetType({ code, actor: admin }),
    );
  }

  @Post("bet-types/:id/versions")
  @RequireAdminCapabilities("lottery-configuration.create")
  @ApiOperation({ summary: "Create a Lottery Bet Type DRAFT version" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateBetTypeVersionBody })
  async createBetTypeVersion(
    @Param("id") betTypeId: string,
    @Body() body: CreateBetTypeVersionBody,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const parsed = parseBetTypeVersion(body, request);
    return this.executeIdempotent(request, key, `admin:${admin.adminId}:lottery:bet-type:${betTypeId}:version:create`, { betTypeId, ...parsed }, 201, () =>
      this.configuration.createBetTypeVersion({ ...parsed, betTypeId, actor: admin }),
    );
  }

  @Post("products/:id/versions")
  @RequireAdminCapabilities("lottery-configuration.create")
  @ApiOperation({ summary: "Create a Lottery Product DRAFT version" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateProductVersionBody })
  async createProductVersion(
    @Param("id") productId: string,
    @Body() body: CreateProductVersionBody,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const parsed = parseProductVersion(body, request);
    return this.executeIdempotent(request, key, `admin:${admin.adminId}:lottery:product:${productId}:version:create`, { productId, ...parsed }, 201, () =>
      this.configuration.createProductVersion({ ...parsed, productId, actor: admin }),
    );
  }

  @Post("bet-type-versions/:id/submit")
  @RequireAdminCapabilities("lottery-configuration.submit")
  @ApiOperation({ summary: "Submit a Lottery Bet Type version for approval" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ExpectedVersionBody })
  async submitBetTypeVersion(
    @Param("id") id: string,
    @Body() body: ExpectedVersionBody,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    return this.submit("BET_TYPE", id, body, key, request);
  }

  @Post("product-versions/:id/submit")
  @RequireAdminCapabilities("lottery-configuration.submit")
  @ApiOperation({ summary: "Submit a Lottery Product version for approval" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ExpectedVersionBody })
  async submitProductVersion(
    @Param("id") id: string,
    @Body() body: ExpectedVersionBody,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    return this.submit("PRODUCT", id, body, key, request);
  }

  @Post("bet-type-versions/:id/approve")
  @RequireAdminCapabilities("lottery-configuration.approve")
  @ApiOperation({ summary: "Approve and publish a Lottery Bet Type version" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ExpectedVersionBody })
  async approveBetTypeVersion(
    @Param("id") id: string,
    @Body() body: ExpectedVersionBody,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    return this.approve("BET_TYPE", id, body, key, request);
  }

  @Post("product-versions/:id/approve")
  @RequireAdminCapabilities("lottery-configuration.approve")
  @ApiOperation({ summary: "Approve and publish a Lottery Product version" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ExpectedVersionBody })
  async approveProductVersion(
    @Param("id") id: string,
    @Body() body: ExpectedVersionBody,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    return this.approve("PRODUCT", id, body, key, request);
  }

  private async submit(
    kind: "PRODUCT" | "BET_TYPE",
    id: string,
    body: ExpectedVersionBody,
    key: string | undefined,
    request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const expectedVersion = parseExpectedVersion(body, request);
    return this.executeIdempotent(request, key, `admin:${admin.adminId}:lottery:${kind}:${id}:submit`, { kind, id, expectedVersion }, 200, () =>
      this.configuration.submit({ kind, id, expectedRevision: expectedVersion, actor: admin }),
    );
  }

  private async approve(
    kind: "PRODUCT" | "BET_TYPE",
    id: string,
    body: ExpectedVersionBody,
    key: string | undefined,
    request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const expectedVersion = parseExpectedVersion(body, request);
    const reauth = await this.adminAuth.requireFreshMfa(admin, LOTTERY_CONFIGURATION_APPROVAL_ACTION_CLASS);
    return this.executeIdempotent(request, key, `admin:${admin.adminId}:lottery:${kind}:${id}:approve`, { kind, id, expectedVersion }, 200, () =>
      this.configuration.approveAndPublish({ kind, id, expectedRevision: expectedVersion, actor: admin, reauthEvidenceId: reauth.id, correlationId: currentCorrelationId() ?? "unknown" }),
    );
  }

  private async executeIdempotent(
    request: AdminAuthenticatedRequest,
    key: string | undefined,
    scope: string,
    payload: Record<string, unknown>,
    responseCode: number,
    execute: () => Promise<unknown>,
  ): Promise<unknown> {
    if (!key?.trim()) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Idempotency-Key header is required", { header: "Idempotency-Key" });
    const fingerprint = createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
    const claim = await this.idempotency.claim({ scope, key: key.trim(), fingerprint, expiresAt: IDEMPOTENCY_CONTRACT_EXPIRY });
    if (claim.kind === "existing") {
      if (claim.fingerprint !== fingerprint) throw apiError(request, HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different payload", {});
      if (claim.status === "COMPLETED" && claim.responseBody !== null) return claim.responseBody;
      throw apiError(request, HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS", "The idempotent command has not completed", { status: claim.status });
    }
    try {
      const result = await execute();
      await this.idempotency.complete(claim.recordId, responseCode, JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue);
      return result;
    } catch (error) {
      await this.idempotency.fail(claim.recordId);
      if (error instanceof LotteryConfigurationRuleError) {
        const status = error.code === "VERSION_CONFLICT" || error.code.endsWith("CONFLICT") ? HttpStatus.CONFLICT : error.code === "SELF_APPROVAL_FORBIDDEN" ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST;
        throw apiError(request, status, error.code, error.message, error.details);
      }
      throw error;
    }
  }
}

function requiredAdmin(request: AdminAuthenticatedRequest) {
  if (!request.adminAuth) throw apiError(request, HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "Admin authentication required", {});
  return request.adminAuth;
}

function requireString(value: unknown, field: string, request: AdminAuthenticatedRequest): string {
  if (typeof value !== "string" || !value.trim()) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", `${field} is required`, { field });
  return value.trim();
}

function parseExpectedVersion(body: ExpectedVersionBody, request: AdminAuthenticatedRequest): number {
  if (!body || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "expectedVersion must be a positive integer", { field: "expectedVersion" });
  return body.expectedVersion;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HttpException({ code: "VALIDATION_ERROR", message: "limit must be an integer between 1 and 100", details: { field: "limit" }, correlationId: currentCorrelationId() ?? "unknown" }, HttpStatus.BAD_REQUEST);
  }
  return parsed;
}

function parseState(value: string | undefined): LotteryConfigurationState | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if ((LOTTERY_CONFIGURATION_STATES as readonly string[]).includes(value)) return value as LotteryConfigurationState;
  throw new HttpException({ code: "VALIDATION_ERROR", message: "state must be DRAFT, REVIEW, or PUBLISHED", details: { field: "state" }, correlationId: currentCorrelationId() ?? "unknown" }, HttpStatus.BAD_REQUEST);
}

function parseInstant(value: unknown, field: string, request: AdminAuthenticatedRequest): Date {
  if (typeof value !== "string" || !value.trim()) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", `${field} must be an RFC 3339 timestamp`, { field });
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", `${field} must be an RFC 3339 timestamp`, { field });
  return date;
}

function parseAmount(value: unknown, field: string, request: AdminAuthenticatedRequest): bigint {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", `${field} must be a non-negative integer minor-unit string`, { field });
  return BigInt(value);
}

function parseBetTypeVersion(body: CreateBetTypeVersionBody, request: AdminAuthenticatedRequest) {
  return {
    version: body?.version,
    canonicalNumberFormat: requireString(body?.canonicalNumberFormat, "canonicalNumberFormat", request),
    validationPattern: requireString(body?.validationPattern, "validationPattern", request),
    defaultPayout: (body?.defaultPayout ?? {}) as Prisma.InputJsonValue,
    minStakeMinor: parseAmount(body?.minStakeMinor, "minStakeMinor", request),
    maxStakeMinor: parseAmount(body?.maxStakeMinor, "maxStakeMinor", request),
    limitPolicyRef: requireString(body?.limitPolicyRef, "limitPolicyRef", request),
    restrictionPolicyRef: requireString(body?.restrictionPolicyRef, "restrictionPolicyRef", request),
    settlementRuleVersionRef: requireString(body?.settlementRuleVersionRef, "settlementRuleVersionRef", request),
    effectiveFrom: parseInstant(body?.effectiveFrom, "effectiveFrom", request),
    effectiveUntil: body?.effectiveUntil ? parseInstant(body.effectiveUntil, "effectiveUntil", request) : null,
    reason: body?.reason,
  };
}

function parseProductVersion(body: CreateProductVersionBody, request: AdminAuthenticatedRequest) {
  if (!Array.isArray(body?.enabledBetTypes)) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "enabledBetTypes is required", { field: "enabledBetTypes" });
  return {
    version: body?.version,
    timezone: requireString(body?.timezone, "timezone", request),
    scheduleTemplateRef: requireString(body?.scheduleTemplateRef, "scheduleTemplateRef", request),
    resultSchemaVersionRef: requireString(body?.resultSchemaVersionRef, "resultSchemaVersionRef", request),
    settlementRuleVersionRef: requireString(body?.settlementRuleVersionRef, "settlementRuleVersionRef", request),
    defaultPayoutPolicyRef: requireString(body?.defaultPayoutPolicyRef, "defaultPayoutPolicyRef", request),
    defaultLimitPolicyRef: requireString(body?.defaultLimitPolicyRef, "defaultLimitPolicyRef", request),
    defaultRestrictionPolicyRef: requireString(body?.defaultRestrictionPolicyRef, "defaultRestrictionPolicyRef", request),
    effectiveFrom: parseInstant(body?.effectiveFrom, "effectiveFrom", request),
    effectiveUntil: body?.effectiveUntil ? parseInstant(body.effectiveUntil, "effectiveUntil", request) : null,
    reason: body?.reason,
    enabledBetTypes: body.enabledBetTypes.map((reference) => ({
      betTypeId: requireString(reference?.betTypeId, "enabledBetTypes.betTypeId", request),
      betTypeVersionId: requireString(reference?.betTypeVersionId, "enabledBetTypes.betTypeVersionId", request),
    })),
  };
}

function apiError(request: AdminAuthenticatedRequest, status: number, code: string, message: string, details: Record<string, unknown>): HttpException {
  return new HttpException({ code, message, details, correlationId: currentCorrelationId() ?? "unknown" }, status);
}

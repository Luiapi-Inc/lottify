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
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { createHash, randomUUID } from "node:crypto";
import {
  DrawRuleError,
  LotteryDrawService,
} from "../../../src/contexts/lottery/application/lottery-draw.service";
import {
  type DrawLifecycleCommand,
  DRAW_LIFECYCLE_COMMANDS,
  type DrawState,
} from "../../../src/contexts/lottery/domain/draw-lifecycle";
import type { ScheduleOccurrence } from "../../../src/contexts/lottery/domain/schedule-occurrence";
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

class OccurrenceBody {
  @ApiProperty({ type: String })
  occurrenceIdentity!: string;
  @ApiProperty({ type: String, example: "2026-09-10" })
  localDate!: string;
  @ApiProperty({ type: String, format: "date-time" })
  openAt!: string;
  @ApiProperty({ type: String, format: "date-time" })
  cutoffAt!: string;
  @ApiProperty({ type: String, format: "date-time" })
  drawAt!: string;
  @ApiProperty({ enum: ["SCHEDULE_GENERATED", "MANUAL_EXCEPTION"] })
  provenance!: "SCHEDULE_GENERATED" | "MANUAL_EXCEPTION";
}

class GenerateDrawsBody {
  @ApiProperty({ type: () => [OccurrenceBody] })
  baseOccurrences!: OccurrenceBody[];
}

class TransitionBody {
  @ApiProperty({ enum: [...DRAW_LIFECYCLE_COMMANDS] })
  command!: DrawLifecycleCommand;
  @ApiProperty({ type: Number, example: 1 })
  expectedVersion!: number;
}

class OverrideBody {
  @ApiProperty({ type: String })
  reason!: string;
  @ApiProperty({ type: String, format: "date-time", required: false })
  effectiveAt?: string;
  @ApiProperty({ type: Object })
  changes!: Record<string, unknown>;
  @ApiProperty({ type: String })
  approvalEvidenceRef!: string;
  @ApiProperty({ type: String })
  auditEvidenceRef!: string;
}

const IDEMPOTENCY_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

@ApiTags("admin-lottery-draws")
@ApiBearerAuth()
@Controller("api/v1/admin")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminDrawController {
  constructor(
    @Inject(LotteryDrawService)
    private readonly draws: LotteryDrawService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get("draws")
  @RequireAdminCapabilities("lottery-draw.read")
  @ApiOperation({ summary: "List Lottery Draws" })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "productId", required: false, type: String })
  @ApiQuery({ name: "state", required: false, enum: ["DRAFT","SCHEDULED","OPEN","CLOSED","RESULT_PENDING","RESULT_CONFIRMED","SETTLING","SETTLED","CANCELLING","CANCELLED"] })
  async listDraws(
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("productId") productId: string | undefined,
    @Query("state") state: string | undefined,
  ): Promise<unknown> {
    try {
      return await this.draws.listDraws({
        limit: parseLimit(limit),
        cursor: cursor?.trim() || undefined,
        productId: productId?.trim() || undefined,
        states: parseStates(state),
      });
    } catch (error) {
      throw mapDrawError(error);
    }
  }

  @Get("draws/:id")
  @RequireAdminCapabilities("lottery-draw.read")
  @ApiOperation({ summary: "Get a Lottery Draw detail" })
  async getDraw(@Param("id") id: string): Promise<unknown> {
    try {
      return await this.draws.getDraw(id.trim());
    } catch (error) {
      throw mapDrawError(error);
    }
  }

  @Post("products/:productId/draws/generate")
  @RequireAdminCapabilities("lottery-draw.manage")
  @ApiOperation({
    summary: "Idempotent rolling Draw generation from schedule occurrences",
  })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: GenerateDrawsBody })
  async generateDraws(
    @Param("productId") productId: string,
    @Body() body: GenerateDrawsBody,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const productIdValue = productId.trim();
    const baseOccurrences = parseOccurrences(body, productIdValue);
    const idempotencyKey = key?.trim();
    if (!idempotencyKey) {
      throw apiError(request, HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required", { header: "Idempotency-Key" });
    }
    const fingerprint = createHash("sha256")
      .update(canonicalJson(baseOccurrences), "utf8")
      .digest("hex");
    const scope = `admin:${admin.adminId}:draws:generate:${productIdValue}`;
    const claim = await this.idempotency.claim({
      scope,
      key: idempotencyKey,
      fingerprint,
      expiresAt: IDEMPOTENCY_EXPIRY,
    });
    if (claim.kind === "existing") {
      if (claim.fingerprint !== fingerprint) {
        throw apiError(request, HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different payload", {});
      }
      if (claim.status === "COMPLETED" && claim.responseBody !== null) return claim.responseBody;
      throw apiError(request, HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS", "Idempotent Draw generation is already in progress", {});
    }
    try {
      const result = await this.draws.generateDraws({
        productId: productIdValue,
        baseOccurrences,
        actor: admin,
      });
      await this.idempotency.complete(
        claim.recordId,
        HttpStatus.OK,
        result as never,
      );
      return result;
    } catch (error) {
      await this.idempotency.fail(claim.recordId);
      throw mapDrawError(error);
    }
  }

  @Post("draws/:id/transition")
  @RequireAdminCapabilities("lottery-draw.manage")
  @ApiOperation({ summary: "Transition a Draw through its lifecycle state machine" })
  @ApiBody({ type: TransitionBody })
  async transition(
    @Param("id") id: string,
    @Body() body: TransitionBody,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const command = parseCommand(body, request);
    const expectedVersion = parseExpectedVersion(body, request);
    try {
      return await this.draws.transition({
        id: id.trim(),
        command,
        expectedVersion,
        context: { privilegedReopen: true },
        actor: admin,
      });
    } catch (error) {
      throw mapDrawError(error);
    }
  }

  @Post("draws/:id/override")
  @RequireAdminCapabilities("lottery-draw.manage")
  @ApiOperation({ summary: "Apply a governed versioned Draw Override" })
  @ApiBody({ type: OverrideBody })
  async applyOverride(
    @Param("id") id: string,
    @Body() body: OverrideBody,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const reason = requireString(body?.reason, "reason", request);
    const approvalEvidenceRef = requireString(body?.approvalEvidenceRef, "approvalEvidenceRef", request);
    const auditEvidenceRef = requireString(body?.auditEvidenceRef, "auditEvidenceRef", request);
    try {
      return await this.draws.applyDrawOverride({
        drawId: id.trim(),
        reason,
        actor: admin,
        effectiveAt: body?.effectiveAt ? parseInstant(body.effectiveAt, "effectiveAt", request) : undefined,
        changes: (body?.changes ?? {}) as never,
        approvalEvidenceRef,
        auditEvidenceRef,
      });
    } catch (error) {
      throw mapDrawError(error);
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

function parseInstant(value: unknown, field: string, request: AdminAuthenticatedRequest): Date {
  if (typeof value !== "string" || !value.trim()) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", `${field} must be an RFC 3339 timestamp`, { field });
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", `${field} must be an RFC 3339 timestamp`, { field });
  return date;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HttpException({ code: "VALIDATION_ERROR", message: "limit must be an integer between 1 and 100", details: { field: "limit" }, correlationId: currentCorrelationId() ?? "unknown" }, HttpStatus.BAD_REQUEST);
  }
  return parsed;
}

function parseStates(value: string | undefined): DrawState[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const allowed = new Set(["DRAFT","SCHEDULED","OPEN","CLOSED","RESULT_PENDING","RESULT_CONFIRMED","SETTLING","SETTLED","CANCELLING","CANCELLED"]);
  if (!allowed.has(value)) {
    throw new HttpException({ code: "VALIDATION_ERROR", message: "state must be a valid Draw state", details: { field: "state" }, correlationId: currentCorrelationId() ?? "unknown" }, HttpStatus.BAD_REQUEST);
  }
  return [value as DrawState];
}

function parseCommand(body: TransitionBody | undefined, request: AdminAuthenticatedRequest): DrawLifecycleCommand {
  const command = body?.command;
  if (typeof command !== "string" || !(DRAW_LIFECYCLE_COMMANDS as readonly string[]).includes(command)) {
    throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "command must be a valid Draw lifecycle command", { field: "command" });
  }
  return command as DrawLifecycleCommand;
}

function parseExpectedVersion(body: TransitionBody | undefined, request: AdminAuthenticatedRequest): number {
  if (!body || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) {
    throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "expectedVersion must be a positive integer", { field: "expectedVersion" });
  }
  return body.expectedVersion;
}

function parseOccurrences(body: GenerateDrawsBody | undefined, productId: string): ScheduleOccurrence[] {
  if (!body || !Array.isArray(body.baseOccurrences) || body.baseOccurrences.length === 0) {
    throw new HttpException({ code: "VALIDATION_ERROR", message: "baseOccurrences is required", details: { field: "baseOccurrences" }, correlationId: currentCorrelationId() ?? "unknown" }, HttpStatus.BAD_REQUEST);
  }
  return body.baseOccurrences.map((occurrence) => {
    if (!occurrence || typeof occurrence.occurrenceIdentity !== "string" || !occurrence.occurrenceIdentity.trim()
      || typeof occurrence.localDate !== "string"
      || typeof occurrence.openAt !== "string" || typeof occurrence.cutoffAt !== "string" || typeof occurrence.drawAt !== "string"
      || !["SCHEDULE_GENERATED", "MANUAL_EXCEPTION"].includes(occurrence.provenance)) {
      throw new HttpException({ code: "VALIDATION_ERROR", message: "Invalid occurrence entry", details: { productId }, correlationId: currentCorrelationId() ?? "unknown" }, HttpStatus.BAD_REQUEST);
    }
    return {
      occurrenceIdentity: occurrence.occurrenceIdentity.trim(),
      localDate: occurrence.localDate.trim(),
      openAt: new Date(occurrence.openAt),
      cutoffAt: new Date(occurrence.cutoffAt),
      drawAt: new Date(occurrence.drawAt),
      provenance: occurrence.provenance,
    };
  });
}

function apiError(request: AdminAuthenticatedRequest, status: number, code: string, message: string, details: Record<string, unknown>): HttpException {
  return new HttpException({ code, message, details, correlationId: currentCorrelationId() ?? "unknown" }, status);
}

function mapDrawError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof DrawRuleError) {
    return new HttpException(
      { code: error.code, message: error.message, details: error.details, correlationId: currentCorrelationId() ?? "unknown" },
      error.status,
    );
  }
  if (error instanceof Error && error.name === "NotFoundException") throw error;
  throw error;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object" && !Array.isArray(item) && !(item instanceof Date)) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
    }
    if (item instanceof Date) return item.toISOString();
    return item;
  });
}

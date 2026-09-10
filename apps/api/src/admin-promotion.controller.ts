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
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiProperty, ApiQuery, ApiTags } from "@nestjs/swagger";
import { createHash } from "node:crypto";
import { z, type ZodType } from "zod";
import { AdminAuthService } from "../../../src/contexts/identity-access/application/admin-auth.service";
import {
  PROMOTION_CAMPAIGN_PUBLISH_ACTION_CLASS,
  PromotionCampaignService,
  type PromotionCampaignVersionView,
} from "../../../src/contexts/promotion/application/promotion-campaign.service";
import { PROMOTION_CAMPAIGN_STATES } from "../../../src/contexts/promotion/domain/campaign-terms";
import { PromotionRuleError } from "../../../src/contexts/promotion/domain/rule-error";
import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest,
} from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import { currentCorrelationId } from "./correlation";
import { promotionHttpException } from "./promotion-error.mapper";

const IDEMPOTENCY_HEADER = "idempotency-key";

const termsSchema = z.object({
  schemaVersion: z.literal("promotion-terms-v1"),
  rewardType: z.literal("BONUS_CREDIT"),
  rewardAmountMinor: z.string().regex(/^\d+$/),
  currency: z.literal("THB"),
  eligibility: z.object({
    requiredMemberStatus: z.string().trim().min(1).nullable(),
    excludedMemberIds: z.array(z.string().trim().min(1)).max(1000),
  }),
  scope: z.object({
    eligibleProductIds: z.array(z.string().trim().min(1)).max(1000),
    eligibleBetTypeCodes: z.array(z.string().trim().min(1)).max(1000),
    contributionBps: z.number().int().min(0).max(10_000),
    minPayoutRef: z.string().trim().min(1).nullable(),
  }),
  turnoverMultiplierBps: z.number().int().min(0),
  fundingSource: z.string().trim().min(1),
  winningsDestination: z.enum(["BONUS", "CASH", "PROPORTIONAL"]),
  proportionalWinningsBps: z.number().int().min(1).max(10_000).nullable(),
  expiryDaysAfterGrant: z.number().int().min(1).max(3650),
  stacking: z.object({
    mode: z.enum(["EXCLUSIVE", "STACKABLE"]),
    priority: z.number().int(),
    compatibilityGroup: z.string().trim().min(1).nullable(),
  }),
  antiAbusePolicyRef: z.string().trim().min(1),
  policyVersion: z.string().trim().min(1),
});

const createVersionSchema = z.object({
  campaignCode: z.string().trim().min(1).max(100),
  version: z.number().int().min(1),
  terms: termsSchema,
  effectiveFrom: z.string().trim().min(1),
  effectiveUntil: z.string().trim().min(1).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

const expectedVersionSchema = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500).optional(),
});

const previewSchema = z.object({
  memberId: z.string().trim().min(1).max(100),
});

class CreatePromotionVersionBody {
  @ApiProperty({ type: String, example: "WELCOME-2026" })
  campaignCode!: string;

  @ApiProperty({ type: Number, example: 1 })
  version!: number;

  @ApiProperty({ type: Object, description: "Versioned Campaign terms" })
  terms!: Record<string, unknown>;

  @ApiProperty({ type: String, example: "2026-10-01T00:00:00.000Z" })
  effectiveFrom!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  effectiveUntil?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  reason?: string | null;
}

class ExpectedVersionBody {
  @ApiProperty({ type: Number, example: 1 })
  expectedVersion!: number;

  @ApiProperty({ type: String, required: false })
  reason?: string;
}

class PreviewMemberBody {
  @ApiProperty({ type: String, format: "uuid" })
  memberId!: string;
}

@ApiTags("admin-promotions")
@ApiBearerAuth()
@Controller("api/v1/admin/promotions")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminPromotionController {
  constructor(
    @Inject(PromotionCampaignService)
    private readonly campaigns: PromotionCampaignService,
    @Inject(AdminAuthService)
    private readonly adminAuth: AdminAuthService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireAdminCapabilities("promotion.manage")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiOperation({ summary: "Create a DRAFT Promotion Campaign version" })
  async createVersion(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: CreatePromotionVersionBody,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const input = parseBody(createVersionSchema, body, "Invalid Promotion Campaign version request");
    return this.executeIdempotent(request, key, `admin:${admin.adminId}:promotion:create`, input, 201, async () => {
      const version = await this.campaigns.createDraftVersion({
        campaignCode: input.campaignCode,
        version: input.version,
        terms: input.terms,
        effectiveFrom: parseInstant(input.effectiveFrom, "effectiveFrom", request),
        effectiveUntil: input.effectiveUntil
          ? parseInstant(input.effectiveUntil, "effectiveUntil", request)
          : null,
        reason: input.reason ?? null,
        actor: { adminId: admin.adminId, sessionId: admin.sessionId, role: admin.role },
        correlationId: correlationId(request),
      });
      return toVersionBody(version);
    });
  }

  @Get()
  @RequireAdminCapabilities("promotion.read")
  @ApiOperation({ summary: "List Promotion Campaign versions" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "state", required: false, enum: [...PROMOTION_CAMPAIGN_STATES] })
  async list(
    @Req() request: AdminAuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("state") state?: string,
  ): Promise<unknown> {
    try {
      return await this.campaigns.listVersions({
        limit: parseLimit(limit, request),
        cursor: cursor?.trim() || undefined,
        state: parseState(state, request),
      });
    } catch (error) {
      throw toHttp(error, request);
    }
  }

  @Get(":id")
  @RequireAdminCapabilities("promotion.read")
  @ApiOperation({ summary: "Read a Promotion Campaign version" })
  async get(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") versionId: string,
  ): Promise<unknown> {
    try {
      return await this.campaigns.getVersion(versionId);
    } catch (error) {
      throw toHttp(error, request);
    }
  }

  @Post(":id/validate")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("promotion.manage")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiOperation({ summary: "Validate a DRAFT Promotion Campaign version" })
  async validate(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") versionId: string,
    @Body() body: ExpectedVersionBody,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const input = parseBody(expectedVersionSchema, body, "expectedVersion is required");
    return this.executeIdempotent(
      request,
      key,
      `admin:${admin.adminId}:promotion:${versionId}:validate`,
      input,
      200,
      async () =>
        toVersionBody(
          await this.campaigns.validateVersion({
            versionId,
            expectedRevision: input.expectedVersion,
            correlationId: correlationId(request),
          }),
        ),
    );
  }

  @Post(":id/preview")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("promotion.read")
  @ApiOperation({ summary: "Preview the eligibility decision for one Member" })
  async preview(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") versionId: string,
    @Body() body: PreviewMemberBody,
  ): Promise<unknown> {
    const input = parseBody(previewSchema, body, "memberId is required");
    try {
      return await this.campaigns.previewEligibility({
        versionId,
        memberId: input.memberId,
        now: new Date(),
      });
    } catch (error) {
      throw toHttp(error, request);
    }
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("promotion.approve")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiOperation({
    summary: "Approve and publish a validated Promotion Campaign version (fresh MFA required)",
  })
  async approve(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") versionId: string,
    @Body() body: ExpectedVersionBody,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const input = parseBody(expectedVersionSchema, body, "expectedVersion is required");
    const reason = input.reason ?? "Approve and publish Promotion Campaign version";
    const reauth = await this.adminAuth.requireFreshMfa(admin, PROMOTION_CAMPAIGN_PUBLISH_ACTION_CLASS);
    return this.executeIdempotent(
      request,
      key,
      `admin:${admin.adminId}:promotion:${versionId}:approve`,
      input,
      200,
      async () =>
        toVersionBody(
          await this.campaigns.approveAndPublish({
            versionId,
            expectedRevision: input.expectedVersion,
            actor: { adminId: admin.adminId, sessionId: admin.sessionId, role: admin.role },
            reauthEvidenceId: reauth.id,
            reason,
            correlationId: correlationId(request),
          }),
        ),
    );
  }

  @Post(":id/retire")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("promotion.manage")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiOperation({ summary: "Retire a published Promotion Campaign version" })
  async retire(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") versionId: string,
    @Body() body: ExpectedVersionBody,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const input = parseBody(expectedVersionSchema, body, "expectedVersion is required");
    return this.executeIdempotent(
      request,
      key,
      `admin:${admin.adminId}:promotion:${versionId}:retire`,
      input,
      200,
      async () =>
        toVersionBody(
          await this.campaigns.retireVersion({
            versionId,
            expectedRevision: input.expectedVersion,
            actor: { adminId: admin.adminId, sessionId: admin.sessionId, role: admin.role },
            reason: input.reason ?? "Retire Promotion Campaign version",
          }),
        ),
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
    if (!key?.trim()) {
      throw apiError(request, HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required", {});
    }
    const fingerprint = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
    try {
      return await this.campaigns.executeCommand(
        { scope, key: key.trim(), fingerprint, responseCode },
        execute,
      );
    } catch (error) {
      throw toHttp(error, request);
    }
  }
}

export function toVersionBody(view: PromotionCampaignVersionView): Record<string, unknown> {
  return {
    id: view.id,
    campaignId: view.campaignId,
    campaignCode: view.campaignCode,
    version: view.version,
    revision: view.revision,
    state: view.state,
    terms: view.terms,
    termsDigest: view.termsDigest,
    effectiveFrom: view.effectiveFrom,
    effectiveUntil: view.effectiveUntil,
    reason: view.reason,
    publishedAt: view.publishedAt,
    approvalEvidenceRef: view.approvalEvidenceRef,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function requiredAdmin(request: AdminAuthenticatedRequest) {
  if (!request.adminAuth) {
    throw apiError(request, HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "Admin authentication required", {});
  }
  return request.adminAuth;
}

function correlationId(request: AdminAuthenticatedRequest): string {
  return currentCorrelationId() ?? request.adminAuth?.sessionId ?? "unknown";
}

function parseBody<T>(schema: ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpException(
      { code: "VALIDATION_ERROR", message, details: {}, correlationId: currentCorrelationId() ?? "unknown" },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed.data;
}

function parseInstant(value: string, field: string, request: AdminAuthenticatedRequest): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", `${field} must be an RFC 3339 timestamp`, { field });
  }
  return date;
}

function parseLimit(value: string | undefined, request: AdminAuthenticatedRequest): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "limit must be an integer between 1 and 100", { field: "limit" });
  }
  return parsed;
}

function parseState(value: string | undefined, request: AdminAuthenticatedRequest): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if ((PROMOTION_CAMPAIGN_STATES as readonly string[]).includes(value)) return value;
  throw apiError(request, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "state must be DRAFT, VALIDATED, PUBLISHED or RETIRED", { field: "state" });
}

function toHttp(error: unknown, request: AdminAuthenticatedRequest): unknown {
  if (error instanceof PromotionRuleError) return promotionHttpException(error);
  if (error instanceof HttpException) return error;
  void request;
  return error;
}

function apiError(
  request: AdminAuthenticatedRequest,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown>,
): HttpException {
  void request;
  return new HttpException(
    { code, message, details, correlationId: currentCorrelationId() ?? "unknown" },
    status,
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item as Record<string, unknown>)
          .sort()
          .map((key) => [key, (item as Record<string, unknown>)[key]]),
      );
    }
    return item;
  });
}

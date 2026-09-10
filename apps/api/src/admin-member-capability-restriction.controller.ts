import {
  Body,
  Controller,
  Delete,
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
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CapabilityRestrictionAdminService,
  type CapabilityRestrictionView,
} from "../../../src/contexts/member/application/capability-restriction-admin.service";
import { MEMBER_CAPABILITIES, type MemberCapability } from "../../../src/contexts/member/domain/capability-restriction";
import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest,
} from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import { currentCorrelationId } from "./correlation";
import { toOnboardingHttp } from "./onboarding-error.mapper";

const IDEMPOTENCY_HEADER = "idempotency-key";

const setRestrictionSchema = z
  .object({
    memberId: z.string().trim().min(1),
    capability: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(500),
    effectiveFrom: z.string().trim().min(1),
    effectiveUntil: z.string().trim().min(1).nullable().optional(),
    actorOrPolicyRef: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

class SetRestrictionBody {
  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ enum: [...MEMBER_CAPABILITIES] })
  capability!: string;

  @ApiProperty({ type: String, description: "Why the capability is restricted" })
  reason!: string;

  @ApiProperty({ type: String, example: "2026-10-01T00:00:00.000Z" })
  effectiveFrom!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  effectiveUntil?: string | null;

  @ApiProperty({
    type: String,
    required: false,
    description: "Actor or governing-policy reference (defaults to the acting Admin id)",
  })
  actorOrPolicyRef?: string;
}

class CapabilityRestrictionBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({
    enum: ["BET_BLOCKED", "WITHDRAWAL_BLOCKED", "DEPOSIT_BLOCKED", "LOGIN_BLOCKED", "PROMOTION_BLOCKED"],
  })
  type!: string;

  @ApiProperty({ type: String })
  source!: string;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveFrom!: Date;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  effectiveUntil!: Date | null;

  @ApiProperty({ type: String })
  actorOrPolicyRef!: string;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
}

class ClearRestrictionBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: Boolean })
  removed!: boolean;
}

@ApiTags("admin-member-capability-restrictions")
@ApiBearerAuth()
@Controller("api/v1/admin/member-capability-restrictions")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminMemberCapabilityRestrictionController {
  constructor(
    @Inject(CapabilityRestrictionAdminService)
    private readonly restrictions: CapabilityRestrictionAdminService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireAdminCapabilities("member-readiness.manage")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiBody({ type: SetRestrictionBody })
  @ApiCreatedResponse({ type: CapabilityRestrictionBody })
  @ApiOperation({
    summary: "Apply an independent per-capability restriction to a Member",
    description:
      "Sets one independent control (BET_BLOCKED etc.) with source, reason, effective period and an actor-or-policy reference. Governed by the member-readiness.manage capability and audited; never replaces the Member's account status.",
  })
  async setRestriction(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<CapabilityRestrictionBody> {
    const admin = requiredAdmin(request);
    const input = parseBody(setRestrictionSchema, body, "Invalid capability restriction request");
    if (!key?.trim()) throw idempotencyRequired();
    const fingerprint = createHash("sha256")
      .update(canonicalJson(input), "utf8")
      .digest("hex");
    try {
      const result = await this.restrictions.executeCommand(
        {
          scope: `admin:${admin.adminId}:member-capability-restriction:set:${input.memberId}`,
          key: key.trim(),
          fingerprint,
          responseCode: 201,
        },
        () =>
          this.restrictions.setRestriction({
            memberId: input.memberId,
            capability: input.capability as MemberCapability,
            reason: input.reason,
            effectiveFrom: parseInstant(input.effectiveFrom, "effectiveFrom"),
            effectiveUntil: input.effectiveUntil
              ? parseInstant(input.effectiveUntil, "effectiveUntil")
              : null,
            actorOrPolicyRef: input.actorOrPolicyRef ?? `admin:${admin.adminId}`,
            actor: { adminId: admin.adminId, sessionId: admin.sessionId, role: admin.role },
            correlationId: currentCorrelationId() ?? admin.sessionId,
          }),
      );
      return toRestrictionBody(result as unknown as CapabilityRestrictionView);
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("member-readiness.manage")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiOkResponse({ type: ClearRestrictionBody })
  @ApiOperation({
    summary: "Remove a capability restriction an Admin set",
    description:
      "Clears a normal Admin-set restriction and audits the removal. A self-exclusion restriction cannot be removed through this normal Admin path.",
  })
  async clearRestriction(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") restrictionId: string,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<ClearRestrictionBody> {
    const admin = requiredAdmin(request);
    if (!key?.trim()) throw idempotencyRequired();
    const fingerprint = createHash("sha256")
      .update(canonicalJson({ restrictionId }), "utf8")
      .digest("hex");
    try {
      const result = await this.restrictions.executeCommand(
        {
          scope: `admin:${admin.adminId}:member-capability-restriction:clear:${restrictionId}`,
          key: key.trim(),
          fingerprint,
          responseCode: 200,
        },
        () =>
          this.restrictions.clearRestriction({
            restrictionId,
            actor: { adminId: admin.adminId, sessionId: admin.sessionId, role: admin.role },
            reason: "Clear capability restriction",
            correlationId: currentCorrelationId() ?? admin.sessionId,
          }),
      );
      return result as unknown as ClearRestrictionBody;
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }
}

export function toRestrictionBody(view: CapabilityRestrictionView): CapabilityRestrictionBody {
  return {
    id: view.id,
    memberId: view.memberId,
    type: view.type,
    source: view.source,
    reason: view.reason,
    effectiveFrom: view.effectiveFrom,
    effectiveUntil: view.effectiveUntil,
    actorOrPolicyRef: view.actorOrPolicyRef,
    createdAt: view.createdAt,
  };
}

function requiredAdmin(request: AdminAuthenticatedRequest) {
  if (!request.adminAuth) {
    throw new HttpException(
      { code: "AUTHENTICATION_REQUIRED", message: "Admin authentication required", details: {}, correlationId: currentCorrelationId() ?? "unknown" },
      HttpStatus.UNAUTHORIZED,
    );
  }
  return request.adminAuth;
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpException(
      {
        code: "VALIDATION_ERROR",
        message,
        details: { field: parsed.error.issues[0]?.path.join(".") ?? "body" },
        correlationId: currentCorrelationId() ?? "unknown",
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed.data;
}

function parseInstant(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new HttpException(
      {
        code: "VALIDATION_ERROR",
        message: `${field} must be an RFC 3339 timestamp`,
        details: { field },
        correlationId: currentCorrelationId() ?? "unknown",
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return date;
}

function idempotencyRequired(): HttpException {
  return new HttpException(
    {
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required",
      details: {},
      correlationId: currentCorrelationId() ?? "unknown",
    },
    HttpStatus.BAD_REQUEST,
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
